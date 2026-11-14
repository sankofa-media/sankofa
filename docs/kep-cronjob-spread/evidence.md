# Evidence: the CronJob herd and its spread

Measurements behind the [CronJob schedule spread](README.md) proposal, taken
on 2026-11-13. Object dumps and per-arm reports are in [`data/`](data/) (`data/reports/*.json`); tools are in
[`hack/bench/`](../../hack/bench/).

## Setups

| Setup | Control plane | Store | Nodes | What it can show |
| --- | --- | --- | --- | --- |
| **Museum** | Hosted Kubernetes v1.35.6 (Cozystack tenant cluster serving the public Sankofa museum) | etcd (hosted) | 2 × 2 vCPU | Real cluster: stock controller, Sankofa's Polyrhythm webhook |
| **Lab** | kube-apiserver and kube-controller-manager v1.37.2 **with the reference patch** (`CronJobScheduleSpread=true`), stock kube-scheduler v1.37.2, etcd v3.7.3, all on loopback in the Sankofa builder pod (4 CPU limit) | etcd (local, replicated PVC) | none | Same binaries for all arms; etcd, controller-manager and scheduler metrics |

Controller-manager settings are upstream defaults in both setups (client QPS
20, burst 30, 5 concurrent CronJob syncs). The lab runs only the controllers
involved (`cronjob`, `job`, `serviceaccount`, `garbage-collector`,
`namespace`).

## Method

- 1000 CronJobs in a dedicated namespace (`polyrhythm-bench`), each with
  `concurrencyPolicy: Forbid` and a Job template whose Pod requests 1m CPU and
  has a `nodeSelector` that matches no node. Every run therefore creates one
  Job and one Pod and exercises the CronJob controller, the Job controller, the
  API server, storage and one scheduling attempt per Pod, without placing Pods
  on the museum's nodes or triggering its cluster autoscaler. The museum was
  serving visitors throughout.
- Arms:
  - **herd** — every CronJob has the same schedule `M * * * *`;
  - **minute spread** — the minute is moved by a hash of namespace/name inside a
    window. In the museum this is Sankofa's Polyrhythm webhook (`H/10 * * * *`,
    a minute in each ten-minute block); in the lab the same minute choice is
    written directly (`--hash-minutes 10`), without a webhook;
  - **second spread** (lab only, needs the patch) — the herd schedule with
    `spec.scheduleSpread.maxDelaySeconds: 600`, the same ten-minute window as the
    minute spread.
- `cronjob_herd.py sample` scraped kube-apiserver `/metrics` (lab: every 2 s,
  plus etcd, controller-manager and scheduler metrics; museum: every 5 s) for
  the whole run. `collect` dumped Job and Pod creation times and the
  `batch.kubernetes.io/cronjob-scheduled-timestamp` annotation; `report`
  computes, for the window around the scheduled time:
  - Jobs/Pods per second and per minute (server-side creation timestamps, 1 s
    resolution);
  - **Job creation lag** = Job creation − its scheduled time (for the second
    spread, the translated time);
  - peak request rates per verb and resource, API storage writes, POST p99
    latency and API server CPU from counter deltas between samples.
- Each lab arm starts from an empty etcd and a fresh control plane.

Workstation-driven sampling of the museum lost two windows when the
workstation slept; those runs keep only object timestamps (which are
server-side and complete). The museum's metric runs were then driven from the
builder.

## Results

### Lab: the same control plane, three arms (1000 CronJobs)

| | Herd: one schedule | Minute spread: hash of namespace/name, 10-minute window | **`scheduleSpread.maxDelaySeconds: 600`** |
| --- | --- | --- | --- |
| Seconds in which Jobs were created | 119 | 108 | 497 |
| Peak Jobs per second / per minute | 21 / 513 | 21 / 104 | 7 / 105 |
| Jobs created in the first 10 s of a minute | — | 95% | 17% (uniform: 17%) |
| Job creation lag vs. scheduled time, p50 / p99 / max | 58 s / 117 s / 118 s | 4 s / 10 s / 10 s | 0 s / 0 s / 0 s |
| `cronjob_controller_job_creation_skew_duration_seconds`, p50 / p99 | 57 s / 127 s | 3.4 s / 15 s | 0.5 s / 1.0 s |
| CronJob controller work queue, peak depth | 999 | 104 | 0 |
| etcd puts, total / peak per second | 10 099 / 80.5 | 10 199 / 89.0 | 10 199 / 44.0 |
| etcd WAL fsyncs, peak per second | 64.5 | 66.0 | 24.5 |
| kube-apiserver CPU, peak cores (2 s samples) | 0.37 | 0.36 | 0.23 |
| POST jobs / pods p99 latency | 24 ms / 24 ms | 24 ms / 24 ms | 25 ms / 25 ms |

Lag for the spread arm is measured from the translated time (the Job's
`cronjob-scheduled-timestamp` annotation), as the controller metric is.

### Museum: hosted v1.35.6, stock controller (1000 CronJobs)

| | Herd: `50 * * * *` | Polyrhythm webhook: `H/10 * * * *` |
| --- | --- | --- |
| Seconds in which Jobs were created | 119 | 95 (over a 10-minute block) |
| Peak Jobs per second / per minute | 20 / 513 | 22 / 234 |
| Jobs created in the first 10 s of a minute | — | 84% |
| Job creation lag, p50 / p99 / max | 58 s / 117 s / 118 s | 4 s / 25 s / 26 s |
| API storage writes (apiserver → etcd), peak per second | 65.8 | 73.0 |
| kube-apiserver CPU, peak cores (5 s samples) | 0.36 | 0.37 |
| POST jobs / pods p99 latency | 19 ms / 19 ms | 24 ms / 24 ms |
| Creating the 1000 CronJobs: duration | 198.5 s | 198.5 s |
| … `LIST cronjobs` requests during creation | 2 | 1000 (one per admission) |
| … kube-apiserver CPU during creation | 23.4 CPU-s | 38.6 CPU-s (+65%) |

The webhook arm put 234 CronJobs on offset 0 and 81–90 on each other offset:
the webhook compared taken minutes on 0..59 while `H/10` keeps only the
offset, so collisions wrapped onto offset 0. This is fixed in this branch
(`fix(admission): choose H/step beats among the step offsets`); the museum ran
the version before the fix.

An earlier museum run (800 CronJobs at `40 * * * *`, objects only,
`data/museum-run1.objects.json`) showed the same shape: Jobs over 94 s, median
lag 46 s.

### Not measured

- **Node CPU.** Pods were deliberately unschedulable, so that a thousand
  Pods would not land on the two nodes serving the public museum or trigger
  its autoscaler. The node-side herd (sandbox creation, image pulls, the
  workloads themselves) is therefore not in these numbers; it scales with the
  Pods-per-second rows above.
- **Scheduler queue.** With no matching nodes each Pod gets one scheduling
  attempt immediately (first attempt at 0 s for every Pod in every arm) and
  waits in the unschedulable queue; the scheduler's active queue never built
  up at these rates, so it does not distinguish the arms.
- **The patched controller on the kuberoot stand.** The stand is shared with
  the distribution's conformance work; the patch was exercised on the lab
  control plane instead, with the same v1.37.2 binaries the image would carry
  (`hack/kuberoot.sh kube` + `build`/`bundle` + signed upgrade is the path to
  put it on the stand).


## What the numbers say

1. **The herd is converted into lateness, not into an API outage.** With
   default controller-manager settings, the CronJob controller's client rate
   limit (20 QPS, two writes per run: create Job, update CronJob status) caps
   Job creation at about 8.5 per second. 1000 CronJobs on one schedule
   therefore take two minutes to start; the median Job is a minute late and
   the last one two minutes late, on both the hosted v1.35 cluster and the
   v1.37 lab. The CronJob work queue holds all 999 waiting CronJobs. Which
   CronJob runs late is decided by queue order, not by anything the user
   controls, and `startingDeadlineSeconds` below two minutes would turn
   lateness into missed runs. API latency stays low (p99 ≈ 20–25 ms), because
   the rate limit protects the API server.
2. **Storage and API server CPU see the peak, not the total.** The total work
   is the same in every arm (≈10 000 etcd puts, ≈1000 of each request type). A
   second-granular spread halves the peak etcd put rate (80.5 → 44 per second),
   cuts the peak WAL fsync rate by 62% (64.5 → 24.5) and the API server's peak
   CPU by 38% (0.37 → 0.23 cores), and empties the controller's queue.
3. **A second-granular, deterministic offset removes the lateness.** With
   `maxDelaySeconds: 600`, Jobs started in 497 distinct seconds, at most 7 in
   one second, each at its translated time (lag 0 s, controller skew p99
   1 s). The share of Jobs in the first ten seconds of a minute (17%) is the
   uniform share, i.e. there is no residual burst at second :00.
4. **Minute-granular spreading leaves a burst at every minute boundary.** Both
   the webhook on the museum and the hash-of-minute arm in the lab start every
   CronJob of a minute at second :00: 84% (museum) and 95% (lab) of Jobs were
   created in the first ten seconds of their minute. The per-minute peak drops
   five-fold, but the per-second peaks of Jobs (21–22/s), etcd puts (89/s) and
   API server CPU (0.36 cores) are the herd's: each minute is a smaller herd,
   still paced by the controller's rate limit (lag up to 10 s in the lab, 26 s
   on the museum).
5. **The webhook has its own cost.** Rewriting `H` at admission time listed
   every CronJob in the cluster once per CronJob created: 1000 LIST requests
   for 1000 creations and 65% more API server CPU during creation, growing
   quadratically with the number of CronJobs. Its collision avoidance also
   needs global, order-dependent state, and had a bias bug for `H/step`
   (fixed in this branch). The controller-side field needs no list, no state
   and no webhook.


## Reproduce

```sh
# Lab (in the builder, after hack/kuberoot.sh kube amd64 or with any v1.37 binaries)
hack/bench/lab-run.sh base   1000 3
hack/bench/lab-run.sh minute 1000 10 --hash-minutes 10
hack/bench/lab-run.sh spread 1000 10 --spread 600
python3 hack/bench/cronjob_herd.py --kubeconfig x --context x report \
  --samples /work/lab/results/spread/samples.jsonl --objects /work/lab/results/spread/objects.json \
  --window START END --interval 2

# A real cluster (explicit kubeconfig and context; own namespace)
python3 hack/bench/cronjob_herd.py --kubeconfig K --context C create --n 1000 --schedule "50 * * * *" --arm base
python3 hack/bench/cronjob_herd.py --kubeconfig K --context C sample --out base.samples.jsonl --interval 5 --duration 900
python3 hack/bench/cronjob_herd.py --kubeconfig K --context C collect --out base.objects.json
```
