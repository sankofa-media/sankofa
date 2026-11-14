# Griot: a time machine for a Kubernetes cluster

Griot records the spec history of every object in a cluster and keeps it
after the object is deleted. You can read an object or a whole namespace as it
was at any moment, compare two moments, and restore. Griot is part of Sankofa,
but it runs on any cluster without the museum (`charts/griot`).

This page covers what Griot does, how it compares with the tools operators
already use, how to run it, and what it costs, measured on a stand.

## What it records

- **Every resource the API serves.** The exceptions are noise that the cluster
  derives itself: Events, Endpoints, EndpointSlices, Leases and metrics. New CRDs
  are picked up every two minutes. `--namespaces`, `--exclude-namespaces` and
  `--exclude-resources` narrow the scope. Griot lists each resource page by
  page and then watches it; it keeps no copy of the objects, only a content
  hash per object, so its memory follows the number of objects (about 1 KB
  each), not their size.
- **One record per change.** A record holds the full normalized object:
  `status`, `managedFields` and `resourceVersion` removed, the body compressed
  with zstd. It also keeps the field manager of the last write (who did it),
  the time of the change and the time Griot wrote the record. Updates that only
  touch status are deduplicated by content hash and do not create records.
- **Births, changes and deaths.** A delete leaves a tombstone holding the last
  state. Deletes that happen while no recorder is running are found on the next
  start: the first full list is compared with the memory, and anything missing
  is recorded as dead.
- **Never Secret values.** `data`, `stringData` and the
  `last-applied-configuration` annotation (which `kubectl apply` fills with
  the whole Secret) are redacted before anything is stored. The values only
  pass through Griot while an event is decoded. As a consequence,
  Griot cannot restore a Secret. It says so and leaves Secrets out of restores.
- **Reads follow RBAC.** The memory is served as the aggregated API
  `history.sankofa.kuberoot.dev/v1alpha1` (`timelines`, `clustertimelines`).
  Each read is checked with a SubjectAccessReview for `get` on the *original*
  object, so whoever cannot read a Deployment cannot read its history either.

## Commands

```bash
sankofa tell deployment/web                       # life story: born, changed (field manager, and user with audit), died
sankofa diff deployment/web --from 2h             # unified diff between two moments (--to defaults to now)
sankofa diff namespace/shop --from 2026-11-12T10:00:00Z --to 2026-11-12T11:00:00Z [--details]
                                                  # which objects were created / changed / deleted
sankofa fetch deployment/web --at 30m             # restore one object as it was
sankofa fetch namespace/shop --at 2h              # ordered manifests on stdout, report on stderr
sankofa fetch namespace/shop --at 2h --out-dir ./shop   # one file per object, numbered in creation order
sankofa fetch namespace/shop --at 2h --apply      # server-side dry run of everything, then apply
sankofa obituaries -A                             # recently deleted objects
kubectl get --raw '/apis/history.sankofa.kuberoot.dev/v1alpha1/namespaces/shop/timelines?at=2026-11-12T10:00:00Z'
```

A namespace restore:

- **Order.** Manifests come in Helm's install order: Namespace, quotas,
  ServiceAccounts, ConfigMaps, PVCs, RBAC, Services, workloads, Ingresses;
  custom resources go last.
- **What it skips.** Objects owned by a controller (ReplicaSets, Pods, Jobs
  of CronJobs and so on) are left to that controller. Also skipped: Secrets
  (no values), and what the cluster creates by itself (`kube-root-ca.crt`, the
  `default` ServiceAccount, token Secrets).
- **Helm and GitOps.** Objects managed by Helm (`meta.helm.sh/*`), Argo CD
  (`argocd.argoproj.io/tracking-id` or `argocd.argoproj.io/instance`) or Flux
  (`kustomize.toolkit.fluxcd.io/*`, `helm.toolkit.fluxcd.io/*`) are reported
  as "restore through the owner" and left out. `--force` includes them.
  Single-object `fetch` refuses them unless `--force`.
- **Fields the server fills in are stripped.** uid, resourceVersion,
  creationTimestamp, generation, ownerReferences, finalizers, status, Service
  cluster IPs, a PVC's bound volume, a Job's generated selector, the
  ServiceAccount token list, and the revision and binding annotations.
- **Dry run before apply.** `--apply` first runs a server-side dry run
  (`dryRun=All`, server-side apply) of every manifest. Applying starts only if
  all of them pass. If the namespace itself is missing, it is created first,
  because nothing inside it can be dry-run before it exists.

## Prior art: what to use when

Griot is not a backup tool and not an audit log. Here is how it compares with
the tools operators already have.

### Velero

**How it works.** Velero writes backups on a schedule: the API objects of a
cluster or of selected namespaces, plus volume data through CSI snapshots or
file-system copies with Kopia or Restic. The backups go to object storage.
Restores follow a fixed priority order of kinds and skip objects that already
exist. Resource modifiers can patch objects on the way in.

**Better than Griot.**
- It handles volume data, which Griot never touches.
- It survives the loss of the whole cluster, because the backups live
  elsewhere.
- It can migrate a workload between clusters.
- It is mature and widely deployed.

**Griot does what Velero cannot.**
- Any moment between two backups, not only the moments a backup ran.
- History inside one object, and diffs between moments.
- Changes that were made and reverted between backups. Velero never sees
  them.
- Reads of that history through the Kubernetes API, under the reader's own
  RBAC.
- Velero's tarballs contain Secret values. Griot never has them.

**Use both.** Velero for disaster recovery and data. Griot for "what did
this look like at 14:05, and who changed it".

### Kubernetes audit logs

**How it works.** The API server logs requests: who, which verb, which
object, from where, and whether it was allowed. At the `Request` and
`RequestResponse` levels the log also holds the bodies. The log goes to a
file or a webhook, and retention is up to you.

**Better than Griot.**
- Identity: the user, the groups, the source IP, the user agent.
- Denied requests, and reads as well as writes.
- It is the accepted source for compliance.

**What it lacks.**
- It records requests, not states. A PATCH body is a patch, not the object.
- Defaults and mutating admission show up only at `RequestResponse`.
- Rebuilding an object at time T means replaying every logged write since
  the object was created, all of them at `RequestResponse`. A single dropped
  event breaks the chain.
- At `Request` level and above, Secret values end up in the log.

Griot records resulting states directly. As "who", it shows only the field
manager of the last write, not the authenticated user. If you need the
person, correlate with the audit log by time and object.

### Argo CD and Flux

**How they work.**
- Argo CD keeps a short list of syncs per Application: Git revision and
  parameters, bounded by `revisionHistoryLimit`. It can roll back to one of
  them, but not while automated sync is on.
- Flux keeps no history of its own beyond Git. helm-controller keeps Helm
  release revisions (`maxHistory`, 5 by default).

**Better than Griot.** The intended state is reviewed and authored in Git,
and a rollback returns to a reviewed revision. If everything you run comes
from Git, restore through Git.

**What they cannot do.**
- Anything outside GitOps.
- Objects that controllers create, rather than Git.
- Manual edits that self-heal later overwrote. Argo CD reverts the drift but
  keeps no record of the drifted state.
- What was actually live after defaults and mutation.

Griot records all of these. Where it sees Helm, Argo CD or Flux markers on
an object, it refuses to restore that object and points to the owner
instead.

### Per-object history tools

- **`kubectl rollout history`, `kubectl-revisions` (timebertt),
  `kubectl-history` (wd).** They read the ReplicaSets and
  ControllerRevisions still in the cluster. That covers Deployments,
  StatefulSets and DaemonSets only, and only pod template changes, as deep as
  `revisionHistoryLimit` (10 by default). Nothing survives the workload's
  deletion. They need no installation and are authoritative for what they
  cover.
- **kubewatch and Robusta.** kubewatch sends change notifications to Slack
  or webhooks and stores nothing. Robusta playbooks can send diffs or commit
  changed resources to a Git repository (`git_change_audit`). That gives
  history in Git, with no point-in-time API that follows RBAC and no restore.
- **Komodor and Datadog Change Tracking (SaaS).** They show timelines of
  changes linked to alerts and incidents, with a polished UI. The data leaves
  the cluster, there is no Kubernetes-native API, and neither offers a
  declarative restore as of time T. Datadog covers selected kinds such as
  Deployments.
- **kubeprovenance (CloudARK).** The closest in design: an aggregated API
  server with `versions`, `spechistory` and `diff` endpoints. It rebuilds
  history from audit logs, so it inherits their gaps. It has no restore and
  looks dormant.
- **Kubernetes History Inspector (Google).** Offline visualization of logs
  (built for GKE and Cloud Logging), not a continuous recorder.
- **etcd itself** keeps old revisions only until the API server compacts
  them, every 5 minutes by default (`--etcd-compaction-interval`). That is
  minutes of history, with no way to read it by time.

### Griot's own limits

- **It shares the cluster's fate.** With SQLite on a PVC, losing the cluster
  loses the memory. PostgreSQL outside the cluster fixes that for the
  history, not for volume data.
- **Watch-based, not transactional.** Griot sees what the watch delivers. If
  a watch reconnects with a relist, intermediate states in between are merged
  into one change. The time of a change comes from `managedFields`, at
  one-second resolution.
- **"Who" is the field manager by default** (`kubectl-client-side-apply`,
  `helm`, `kube-controller-manager`), not the authenticated user. Deaths
  carry no manager at all, because a watch does not say who deleted. With
  the audit webhook (below), Griot names users, on a best-effort match.
- **No Secret restore,** by design.
- **Memory follows the number of objects:** about 1 KB per object for the
  content hash, the reference and the map around them.

## Running it

| | SQLite | PostgreSQL |
|---|---|---|
| Replicas | exactly 1 (the chart refuses more) | 2+; one leader records, all serve reads |
| Failover | pod restart on a RWO volume | lease handover; a new leader warms its cache from the store |
| Survives losing the cluster | no | yes, if the database lives outside it |
| Space reclaimed by retention | `VACUUM` weekly by default (`--vacuum-every`); it rewrites the file, blocks writes while it runs and needs free disk as large as the store | autovacuum, tuned by Griot on its table; space is reused, not returned to the file system; never `VACUUM FULL` in normal operation |

```bash
# SQLite, one replica
helm install griot charts/griot -n griot --create-namespace \
  --set image.repository=<registry>/griot --set image.digest=sha256:...

# PostgreSQL, three replicas
kubectl -n griot create secret generic griot-postgres --from-literal=dsn='postgres://griot:...@db:5432/griot?sslmode=require'
helm install griot charts/griot -n griot --set store.type=postgres \
  --set store.postgres.existingSecret=griot-postgres --set replicas=3
```

Retention (`retention.*`, or the `--retention`, `--max-versions`,
`--tombstone-ttl` and `--compact` flags) runs on the recording replica every
`retention.every`:

- `maxAge` forgets changes older than the given age.
- `maxVersions` caps the number of records per object.
- `tombstoneTTL` forgets deleted objects entirely after the given time.
- `compact: "24h:1h,168h:24h"` keeps every change for a day, then the newest
  change per hour for a week, then the newest per day.

Births, deaths and the latest state of every object survive compaction,
`maxAge` and `maxVersions`. Only `tombstoneTTL` removes an object completely.

`/metrics` (port 9090) exposes events, records written, batches, write
errors, queue length, last batch lag, store size, records forgotten by
retention, the last vacuum, and whether the replica is the leader.

### PostgreSQL maintenance

Retention deletes many rows scattered through the table. On start, Griot sets
these storage parameters on its `records` table, so autovacuum runs after 2%
of dead rows instead of PostgreSQL's default 20%:

```sql
ALTER TABLE records SET (autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01, autovacuum_vacuum_cost_limit = 1000);
```

Plain (auto)vacuum makes the space reusable for new records but does not
shrink files. That is the steady state you want: the table stops growing
once retention removes as much as the cluster writes. `VACUUM FULL` (or
`pg_repack`) does return the space, but it takes an exclusive lock that
stops recording while it runs. Use it only as a one-off, for example after
tightening a retention policy. Server-wide, keep autovacuum on (the
default) and give it enough `autovacuum_work_mem` for the table size.

### Who did it: audit correlation

Griot can receive the API server's audit events and name the user behind
each moment:

```yaml
# kube-apiserver flags
--audit-policy-file=/etc/kubernetes/audit-policy.yaml
--audit-webhook-config-file=/etc/kubernetes/griot-audit.kubeconfig   # server: https://griot.<ns>.svc:9444/audit
# audit-policy.yaml: Metadata level is enough
rules:
  - {level: None, verbs: [get, list, watch]}
  - level: Metadata
```

```bash
helm upgrade griot charts/griot --set audit.enabled=true --set audit.clientCASecret=griot-audit-ca
```

- **Authentication.** Griot accepts audit events only from a client
  certificate signed by `audit.clientCASecret` (`--audit-client-ca`),
  because whoever can post there can put names into the memory.
- **What it keeps.** Successful mutating requests on objects, not on their
  status, about 200 bytes each: time, object, verb, user and audit ID.
  Their retention follows `retention.maxAge`.
- **How it matches.** Each moment gets the nearest request on the same
  object with a matching verb within ±10 s:
  - a birth matches a create, or a patch or update (server-side apply
    creates with a patch);
  - a change matches a patch or update;
  - a death matches a delete, or a `deletecollection` of its resource in its
    namespace (how the namespace controller deletes).
- **How it shows.** Impersonation shows as
  `alice (as, by admin)`. `sankofa tell` prints the user after the field
  manager.
- **Limits.**
  - The match is best effort. Two users writing the same object in the
    same second can be swapped.
  - Events the API server's batching dropped leave a moment without a
    name, never with a wrong one.
  - Without the webhook (managed control planes often don't allow it),
    moments carry only the field manager.
  - Reading audit log files is not implemented.


## Measurements

Two rounds: the first build (phase 1, 13 November) and the current one
(phase 2, 14 November). The tables of the first round are kept for
comparison; the current build's numbers are in [Phase 2](#phase-2-the-current-build).

Everything below was measured on the Sankofa stand on 13–14 November 2026,
not on a laptop. Some of these numbers show where the design runs out;
they are listed under "What the numbers say" at the end.

### Method

- **Where it ran.** On the stand's museum cluster: two worker VMs with
  2 vCPU and 8 GiB each, Talos, and the default replicated storage class.
  The churn must not reach the museum's own Griot, so it went into a
  throwaway control plane in one namespace (`hack/griot-bench/vapi.yaml`):
  etcd 3.6.9, kube-apiserver and kube-controller-manager v1.35.9, no
  scheduler and no nodes, so Pods stay Pending.
- **Two recorders.** Both Griots recorded that API at the same time, with
  their reads registered through the aggregator (`apiservice.sh`):
  - `griot-pg`: PostgreSQL 17 (`postgres.yaml`), two replicas with leader
    election.
  - `griot-sqlite`: one replica. Its database sat on the node's disk
    (emptyDir), because a second hot-plugged volume never attached on the
    stand.
- **Load.** `hack/griot-bench` runs as pods next to them:
  - `create`: 20 namespaces × (4,500 ConfigMaps + 250 Deployments). With the
    controller manager's ReplicaSets and Pods that comes to about 105,000
    objects.
  - `update`: random merge patches of ConfigMaps. Every 50th patch rolls a
    Deployment, which creates a new ReplicaSet and Pod.
- **Lag (`probe`).** A probe writes a nanosecond timestamp into its own
  ConfigMap once a second. It then polls Griot's API every 25 ms until that
  state is served. Lag is end to end: watch delivery, queue, batch
  commit, read.
- **Query latency (`query`).** Measured against one replica, with the
  front-proxy client certificate, as the aggregator calls it. Each figure
  includes the SubjectAccessReview and JSON encoding. The aggregator's own
  hop is not included.
- **Other sources.** Throughput, queue and batch lag come from Griot's
  `/metrics`. CPU and memory come from `kubectl top`. Sizes come from
  `pg_total_relation_size('records')` and from SQLite's used pages
  (`page_count − freelist_count`).

```bash
hack/griot-bench/certs.sh <dir>          # throwaway PKI and kubeconfig, outside the repository
source hack/griot-bench/run.sh           # km, vk, bench, bench_bg, push_in_stand
km apply -f hack/griot-bench/vapi.yaml -f hack/griot-bench/postgres.yaml
# images: ko build --push=false --tarball=...; push_in_stand griot-tm dist/griot-tm.tar
sed "s#BENCH_IMAGE#$BI#; s#IMAGE#$GI#" hack/griot-bench/griot.yaml | km apply -f -
hack/griot-bench/apiservice.sh
bench create --namespaces 20 --configmaps 4500 --deployments 250
bench_bg probe --griot https://griot-pg.griot-bench.svc:443 --duration 17m
bench update --rate 400 --duration 15m --deploy-every 50
bench query --griot https://griot-pg.griot-bench.svc:443 --n 40
bench retain --store postgres --tiers 10m:1m,1h:10m
bench delete --namespaces 2; bench cleanup
```

### Results

**Writing**

| What | PostgreSQL (2 replicas) | SQLite (1 replica) |
|---|---|---|
| Creating 105k objects in 2m07s (the API's pace, ~800/s) | kept pace at 800–950 records/s; queue ≤ 1.8k; batch lag ≤ 2.4 s | — (started later, see the next row) |
| Recording 105k objects that already exist (first full list) | — | ~60 s; peak 5,500 records/s |
| Steady churn: 297,848 patches in 15 min (~330/s) plus 5,956 rollouts | 356 records/s on average; queue ≤ 109; batch lag ≤ 0.84 s | 356 records/s; queue ≤ 468; batch lag ≤ 0.92 s |
| Mass deletion (21 namespaces, ~96k objects) | 101,717 death records within 142 s, at the pace of the namespace controller | — |

**Lag behind the API**

| What | PostgreSQL | SQLite |
|---|---|---|
| Under ~380 changes/s | p50 125 ms, p95 229 ms, p99 275 ms, max 319 ms (n=420, 0 misses) | p50 175 ms, p95 507 ms, p99 1.03 s (n=715); measured before the authorization fix below, so polling added up to 200 ms |
| Leader killed under ~300 changes/s | lease taken over in 3 s; 124k heads warmed in 2.3 s; 47 Pod deaths from the gap found by the sweep 12 s after the kill; probe max 16.6 s, p99 1.23 s, 0 misses | n/a |
| All recorders down while 5,994 objects were deleted | on start: leader in 3 s, every death recorded 12 s later | n/a |

**Size**

| What | PostgreSQL | SQLite |
|---|---|---|
| Size per 1,000 changes (full snapshots, zstd) | ~0.85 MB (bodies ~380 B per record; the rest is row overhead and four indexes) | ~0.78 MB |
| After create (110k records) | 98 MB | 86 MB |
| After the churn (~435k records) | 377 MB | 342 MB |

**Compaction**

| What | PostgreSQL | SQLite |
|---|---|---|
| Tiers `10m:1m,1h:10m` | 678,929 → 455,828 records (−33%) in 4.1 s; `VACUUM FULL` 9.4 s; 572 MB → 376 MB (−34%) | tiers `10m:1m,20m:5m`: 433,640 → 385,833 records (−11%) in 5.7 s; used size 342 → 339 MB |

The two backends were compacted with different tiers at different moments,
so their percentages are not comparable. SQLite barely shrank because the
deleted rows were spread over half-empty pages; it needs a `VACUUM`, which
Griot does not run.

**Reads** (one replica; namespace operations cover ~5.5–6k objects)

| Query | before the fix | PostgreSQL, 437k records | PostgreSQL, 679k records | PostgreSQL after compaction |
|---|---|---|---|---|
| Life of a ConfigMap | 200 ms | 2 / 5 ms | 2 / 3 ms | 2 / 4 ms |
| Life of an object with 965 versions | 200 ms | 9 / 16 ms | 7 / 15 ms | (4 versions left) 1 ms |
| At, one object | 200 ms | 2 / 4 ms | 2 / 2 ms | 2 / 3 ms |
| Namespace at T | 1.0–1.3 s | 208–219 ms | 436–819 ms | 194–247 ms |
| Namespace diff (two moments) | 2.1–2.7 s | 549 / 588 ms | 915 ms / 1.05 s | 606 / 868 ms |
| Restore plan for a namespace | 1.0–1.4 s | 260 ms | 322 / 640 ms | 258 ms |
| Obituaries (100) | 4 s | 3 / 4 ms | 2 / 4 ms | 2 / 5 ms |

Figures are p50 / p95.

**Resources**

| Process | PostgreSQL | SQLite |
|---|---|---|
| Griot recording ~110k live objects | leader 1.0–1.1 GiB, follower 20 MiB; CPU 0.2–0.7 core during lists and churn | 1.0–1.1 GiB; 0.23 core |
| Other components | PostgreSQL 0.4–0.46 GiB, under 0.06 core | — |
| For scale | the benchmark API server itself used 1.6–1.9 GiB | |

### What the first round showed

These findings are from the first round. Where the current build changed
the picture, the bullet says so.

- **The authorization fix.** The first read latencies sat at 200 ms because
  every read created a SubjectAccessReview through a client limited to 5
  requests per second. Reviews are now cached for 10 s per caller and
  object, and the client allows 100 requests per second. That took single
  reads to 2–9 ms.
- **The failover fix.** A rolling update left the lease held by a dead pod
  for about 20 s, because the process exited without releasing it or
  flushing its last batch. Fixed; with the fix, takeover took 3 s.
- **Throughput is not the limit.** Both backends kept pace with what this
  API server produced (~950 changes/s), and a cold SQLite recorder caught
  up at 5,500 records/s.
- **Memory was the limit:** about 10 KB per live object, held in the
  informer cache. The current build does not keep that cache.
- **Namespace reads slowed down with history:** they read every record up
  to the moment. The current build reads validity intervals instead.

### Phase 2: the current build

**What changed in the method**

- **Same harness, same load.** 20 namespaces × (4,500 ConfigMaps + 250
  Deployments), about 105k objects. Two 15-minute rounds of ~300–400
  patches/s with rollouts brought the history to 726k records.
- **The stand had three workers this time.** The autoscaler had added a
  node.
- **SQLite on a real volume.** A third volume in the cluster never
  attaches on the stand: with either storage class, the underlying claim
  stays pending. So SQLite shared PostgreSQL's volume, in its own directory
  and on the same node.
- **Audit events.** The benchmark API server sent its audit events to
  `griot-pg` during the whole run.
- **Store-level reads.** `griot-bench nsat` compares the old namespace scan
  with the interval read on the same store and checks that both return the
  same objects.

**Memory and CPU** (~105–127k live objects)

| | first round | current |
|---|---|---|
| PostgreSQL leader | 1.0–1.1 GiB | 82–136 MiB under churn, 187 MiB peak while 105k objects were created |
| PostgreSQL follower | 20 MiB | 20–73 MiB |
| SQLite | 1.0–1.1 GiB | 84–129 MiB, 176 MiB peak during vacuum and reads |
| CPU, recording | 0.2–0.7 core | 0.15–0.28 core; 0.7 core during a takeover's full list |

**Writing and lag**

| What | PostgreSQL | SQLite (on a volume) |
|---|---|---|
| Creating 105k objects in 2m32s | kept pace, peak ~710 records/s, queue < 30 | kept pace, peak ~680/s |
| Churn: 286,143 patches in 15 min | 379 records/s on average, queue ≤ 685, batch lag ≤ 1 s | 379/s, queue ≤ 949 |
| Lag behind the API under that churn | p50 191 ms, p95 471 ms, p99 919 ms, max 1.4 s (n=956, 0 misses) | p50 229 ms, p95 774 ms, p99 1.38 s, max 2.1 s |
| Leader killed under ~400 changes/s | new leader warmed 119k heads in 6 s; deaths from the gap recorded 10 s after taking over | n/a |
| Audit events | 412k events, 87 MB (~210 B each) | n/a |

Lag is higher than the first round's 125 / 229 / 275 ms. Two likely
causes: every batch now also closes the intervals of the states it
replaces, and the stand had a third node and other work. They are not
separated here.

**Namespace at T**

Store level, p50 for one namespace (5.3–6k objects), the old scan versus
the interval read, on the same data:

| History | Moment | PostgreSQL: scan → intervals | SQLite: scan → intervals |
|---|---|---|---|
| 424k records | early / middle / late / now | 81 / 89 / 102 / 100 → 57 / 63 / 64 / 62 ms | 68 / 111 / 145 / 141 → 62 / 74 / 71 / 76 ms |
| 726k records | early / middle / late / now | 228 / 482 / 708 / 913 → 68 / 66 / 73 / 69 ms | 79 / 155 / 213 / 194 → 64 / 76 / 81 / 73 ms |

The interval read stays at 55–80 ms as the history grows. The scan grows
with it, about 9× slower for "now" on PostgreSQL. Both reads returned the
same objects on intact intervals. A mismatch showed up once, after an
interrupted compaction; that is a bug, described under
[What the current round found](#what-the-current-round-found).

**Through the API at 726k records** (p50 / p95; one replica)

| Query | PostgreSQL | SQLite |
|---|---|---|
| Life of an object (newest page of moments, no bodies) | 4 / 8 ms | 2 / 3 ms |
| Life of an object with >1,000 versions (page of 500) | 14 / 34 ms | 19 / 25 ms |
| At, one object | 4 / 6 ms | 2 / 2 ms |
| Namespace at T, ~6k objects with bodies | 302–390 ms | 206–207 ms |
| Namespace diff | 578 / 594 ms | 589 / 598 ms |
| Restore plan | 265 ms | 261 ms |
| Obituaries (100) | 2 / 13 ms | 45 / 63 ms |

Most of "namespace at T" through the API goes to encoding about 6k objects
as JSON; the database part is the ~70 ms above. Pages
(`?limit=500&continue=`) bound each response. `sankofa fetch` and
`sankofa diff` page through.

**Compaction and space**

| What | PostgreSQL | SQLite |
|---|---|---|
| Tiers `10m:1m,30m:10m` on 726k records | −25% records (see the bug below) | −25% records (725,700 → 544,844) in 24.6 s; `VACUUM` 10.5 s: 590 MB → 439 MB |
| Tiers `10m:5m,30m:30m` (fixed build) | −143,746 records in 29.6 s, one transaction | |
| Tiers `5m:5m,15m:60m` | −94,490 records in 16.2 s | |
| Plain `VACUUM ANALYZE` | 4–5 s; size unchanged (681 MB), space reused for new records | n/a |

### What the current round found

- **Memory is no longer the limit.** Without the informer cache, Griot holds
  a content hash and a reference per object: about 1 KB each, roughly a
  tenth of the first round. That is ~130 MiB for 110k objects, and would
  be ~1 GiB for a million.
- **Namespace reads no longer depend on the history.**
- **Two retention bugs, found and fixed on the stand:**
  - A compaction `DELETE … NOT IN (ids to keep)` ran for more than 3
    minutes on 542k records. PostgreSQL stops hashing a `NOT IN` set once
    it outgrows `work_mem` and falls back to a quadratic plan. Compaction
    now deletes by a window function, and the age and tombstone rules check
    for a newer record with an index lookup.
  - After that cancelled compaction, about 130 objects were missing from
    namespace reads in the compacted range. The first tier had committed
    without its interval repair. Compaction and the repair now commit
    together, and `RepairIntervals` fixes stores damaged before (here 4,305
    intervals in 5 s).
- **Locking during compaction.** Compaction runs as one transaction of
  15–30 s at this size. On SQLite, the recorder's writes wait for it; with
  one connection they queue, and a write times out after 30 s. Run it often
  (the default is hourly) so each run stays small.
- **Failover loses granularity, not states.** While a new leader warms up
  and lists (about 10 s here), intermediate states are lost; final states
  and deaths are caught on takeover.
- **Not measured separately:** the aggregator's own hop.
