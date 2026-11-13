# KEP-NNNN: CronJob schedule spread

<!-- Draft. Not submitted to kubernetes/enhancements. Follows the KEP template
     at https://github.com/kubernetes/enhancements/tree/master/keps/NNNN-kep-template -->

<!-- toc -->
- [Release Signoff Checklist](#release-signoff-checklist)
- [Summary](#summary)
- [Motivation](#motivation)
  - [Goals](#goals)
  - [Non-Goals](#non-goals)
- [Proposal](#proposal)
  - [User Stories](#user-stories)
  - [Notes/Constraints/Caveats](#notesconstraintscaveats)
  - [Risks and Mitigations](#risks-and-mitigations)
- [Design Details](#design-details)
  - [API](#api)
  - [Offset derivation](#offset-derivation)
  - [Controller behaviour](#controller-behaviour)
  - [Interaction with other CronJob fields](#interaction-with-other-cronjob-fields)
  - [Validation](#validation)
  - [Cluster-wide defaults](#cluster-wide-defaults)
  - [Test Plan](#test-plan)
  - [Graduation Criteria](#graduation-criteria)
  - [Upgrade / Downgrade Strategy](#upgrade--downgrade-strategy)
  - [Version Skew Strategy](#version-skew-strategy)
- [Production Readiness Review Questionnaire](#production-readiness-review-questionnaire)
- [Implementation History](#implementation-history)
- [Drawbacks](#drawbacks)
- [Alternatives](#alternatives)
- [Prior art](#prior-art)
<!-- /toc -->

## Release Signoff Checklist

- [ ] (R) Enhancement issue in release milestone, which links to KEP dir in [kubernetes/enhancements]
- [ ] (R) KEP approvers have approved the KEP status as `implementable`
- [ ] (R) Design details are appropriately documented
- [ ] (R) Test plan is in place, giving consideration to SIG Architecture and SIG Testing input
  - [ ] e2e Tests for all Beta API Operations (endpoints)
  - [ ] (R) Ensure GA e2e tests meet requirements for [Conformance Tests](https://github.com/kubernetes/community/blob/master/contributors/devel/sig-architecture/conformance-tests.md)
  - [ ] (R) Minimum Two Week Window for GA e2e tests to prove flake free
- [ ] (R) Graduation criteria is in place
- [ ] (R) Production readiness review completed
- [ ] (R) Production readiness review approved
- [ ] "Implementation History" section is up-to-date for milestone
- [ ] User-facing documentation has been created in [kubernetes/website], for publication to [kubernetes.io]
- [ ] Supporting documentation

## Summary

CronJobs that share a schedule start at the same instant. A cluster with
hundreds of `0 * * * *` CronJobs creates hundreds of Jobs and Pods in the first
seconds of every hour, while the rest of the hour is idle. This KEP adds an
optional field, `spec.scheduleSpread.maxDelaySeconds`, that translates every
activation of a CronJob's schedule by a fixed offset in
`[0, maxDelaySeconds)`. The offset is a pure function of the CronJob's UID, so
it is identical across controller restarts, leader changes and upgrades. The
change is opt-in, off by default and confined to the CronJob controller's
computation of scheduled times.

## Motivation

The CronJob controller fires every CronJob exactly on its schedule. People
write a handful of schedules by habit (`0 * * * *`, `*/5 * * * *`,
`0 0 * * *`), Helm charts and operators generate CronJobs with fixed defaults,
and multi-tenant clusters multiply both. The result is a periodic thundering
herd:

- the CronJob controller has to create N Jobs and update N CronJob statuses at
  once; its client-side rate limit turns this into an uncontrolled, unfair
  queue — measured on a v1.35 cluster, 800 CronJobs at `40 * * * *` produced
  Jobs over 94 seconds, the median Job 46 seconds late
  ([evidence](evidence.md));
- the Job controller, the scheduler and the kubelets then receive N Pods within
  the same window; image pulls, sandbox creation and the workloads themselves
  (backups, report generation, cache warmers, calls to shared external APIs)
  all coincide;
- capacity has to be sized for the peak minute, or the late Jobs miss
  `startingDeadlineSeconds`.

Users ask for this repeatedly
([kubernetes/kubernetes#91652](https://github.com/kubernetes/kubernetes/issues/91652),
open since 2020;
[kubernetes/community#2440](https://github.com/kubernetes/community/issues/2440)).
The CronJob GA KEP ([KEP-19](https://github.com/kubernetes/enhancements/tree/master/keps/sig-apps/19-Graduate-CronJob-to-Stable))
already listed "Support Jitter for cronjobs" (`.spec.jitter`) as a future
improvement that was not required for GA and was never implemented. The
workarounds in use today each have a cost:

- `sleep $(shuf ...)` at the start of the container holds a Pod, its resources
  and on pay-per-Pod platforms its bill for the duration of the sleep, and the
  Pod is scheduled under the cluster conditions of the herd, not of the moment
  it actually works;
- hand-picking minutes requires coordination across teams and does not survive
  charts and generators; templating the minute from a hash in Helm
  (`adler32sum`) is per-chart and invisible to anyone reading `spec.schedule`;
- a mutating admission webhook that rewrites `spec.schedule` (the approach the
  Sankofa distribution uses, see [Alternatives](#alternatives)) works at
  minute granularity, changes the user's declared schedule, and has to keep
  global state to avoid collisions.

### Goals

- Let a CronJob declare that its runs may start up to `maxDelaySeconds` after
  the schedule matches, so that CronJobs sharing a schedule start at different,
  evenly distributed times.
- Make the actual start time deterministic and stable: the same CronJob runs at
  the same offset every period, across kube-controller-manager restarts,
  leader election and upgrades, and the offset can be computed by clients.
- Keep every existing scheduling rule meaningful: `startingDeadlineSeconds`,
  `concurrencyPolicy`, `suspend`, `timeZone`, missed-schedule handling,
  `status.lastScheduleTime`, Job naming and the
  `batch.kubernetes.io/cronjob-scheduled-timestamp` annotation.
- Allow cluster administrators to apply a spread to CronJobs that do not set
  one, without a webhook server.

### Non-Goals

- Limiting the number of concurrently running Jobs across CronJobs
  ([kubernetes/kubernetes#138569](https://github.com/kubernetes/kubernetes/issues/138569));
  this is complementary and better served by quota or Kueue.
- A random offset that changes on every run (systemd `RandomizedDelaySec`
  without `FixedRandomDelay`). It can be added later as a mode of the same
  struct; see [Alternatives](#alternatives).
- Extending the cron grammar (`H`, `H(0-29)`, `R`) of `spec.schedule`.
- Choosing offsets that avoid collisions with other CronJobs (packing). That
  requires global state; a uniform hash is sufficient at the scales where the
  herd matters (see [Offset derivation](#offset-derivation)).
- Changing the default behaviour of existing CronJobs.

## Proposal

Add `spec.scheduleSpread` to `batch/v1` CronJob:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: hourly-report
spec:
  schedule: "0 * * * *"
  scheduleSpread:
    maxDelaySeconds: 3600   # run at some stable second within the hour
  jobTemplate: ...
```

With the field set, the controller treats the schedule as translated in time
by `offset = FNV-1a64(metadata.uid) mod maxDelaySeconds` seconds. The CronJob
above runs once an hour, every hour at the same minute and second, for example
at `:23:17`. Another CronJob with the same schedule runs at an independent,
uniformly distributed second of the hour.

### User Stories

#### Story 1: platform team with many tenants

A platform hosts 400 namespaces. Tenants deploy charts that ship hourly and
daily CronJobs with `0 * * * *` and `0 0 * * *`. Every hour the control plane
and the nodes see a burst of several hundred Pods, and capacity is sized for
it. The platform team installs a MutatingAdmissionPolicy that sets
`scheduleSpread.maxDelaySeconds: 600` on CronJobs whose schedule minute field is
a literal, unless the CronJob carries an opt-out label. The burst becomes a
ten-minute ramp; nothing in the tenants' manifests changes.

#### Story 2: a fleet hitting one external service

The same backup CronJob (`0 3 * * *`) runs in 200 clusters and uploads to one
object store, which throttles at 03:00. Because the offset is derived from the
UID, each cluster's copy of the CronJob gets a different offset;
`maxDelaySeconds: 7200` spreads the uploads over two hours. With a
name-derived offset, all 200 copies would still start together.

#### Story 3: an application owner who needs predictability

A team wants its report "some time in the first quarter hour, but always at the
same time, so that dashboards line up". It sets `maxDelaySeconds: 900`. The
team reads the resulting time from `kubectl describe cronjob`, which computes
the offset from the UID, and from `status.lastScheduleTime`.

### Notes/Constraints/Caveats

- A constant offset is a *translation* of the schedule. Translation keeps the
  order of activations and every interval between them, which is why the rest
  of the controller needs no change: it simply sees a different schedule.
- `maxDelaySeconds` may exceed the schedule's period. A `*/5 * * * *` CronJob
  with `maxDelaySeconds: 3600` still runs every five minutes, at a stable
  offset modulo five minutes plus whole periods; the effective phase is
  `offset mod period`. Validation therefore does not compare the two, but the
  API server returns a warning when `maxDelaySeconds` is larger than the
  smallest interval of the schedule (see [Validation](#validation)).
- `@every <duration>` schedules are relative to the previous run (or to the
  CronJob's creation), so they are already phase-shifted by creation time and a
  translation does not move them. The field has no effect on them; the API
  server returns a warning when both are set.
- The offset is in whole seconds. Minute-granularity spreading (as `H` or the
  webhook alternative produce) leaves a burst at second `:00` of every minute;
  see the measurements in [evidence.md](evidence.md).

### Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Users are surprised that a job declared for `0 * * * *` runs at `:23`. | Opt-in field; `kubectl describe` shows the offset; the scheduled-timestamp annotation and `lastScheduleTime` show the actual (translated) time. |
| Recreating a CronJob (new UID) moves its offset. | Documented. GitOps tools update in place; recreation already resets `lastScheduleTime` and history. |
| The hash becomes part of the API contract. | The algorithm (FNV-1a, 64-bit, over the UID bytes, modulo `maxDelaySeconds`) is specified in the field documentation and never changes for this field. A different algorithm would be a different field or mode. |
| Enabling the field on an existing CronJob produces an extra run in the current period (the translated time of the current period may still lie ahead). | Same behaviour as editing `spec.schedule` today; documented. |
| Abuse: a tenant uses a large offset to run at a time it otherwise could not. | It cannot do anything it could not do by writing that time into `spec.schedule`. |

## Design Details

### API

```go
// CronJobSpec describes how the job execution will look like and when it will actually run.
type CronJobSpec struct {
	// ... existing fields ...

	// scheduleSpread delays every run of this CronJob by a stable, per-CronJob
	// offset, so that many CronJobs sharing the same schedule do not all start
	// at the same instant. The offset is a whole number of seconds in
	// [0, scheduleSpread.maxDelaySeconds), derived from a hash of the CronJob's
	// UID; it does not change across controller restarts or updates to the
	// CronJob. All other scheduling rules (startingDeadlineSeconds,
	// concurrencyPolicy, suspend, status.lastScheduleTime) apply to the delayed
	// times. This field is alpha-level and is only honored by servers that enable
	// the CronJobScheduleSpread feature.
	// +featureGate=CronJobScheduleSpread
	// +optional
	ScheduleSpread *CronJobScheduleSpread `json:"scheduleSpread,omitempty" protobuf:"bytes,9,opt,name=scheduleSpread"`
}

// CronJobScheduleSpread describes how the runs of a CronJob are spread in time.
type CronJobScheduleSpread struct {
	// maxDelaySeconds is the exclusive upper bound, in seconds, of the offset
	// added to every scheduled time of the CronJob. It must be between 1 and
	// 86400 (one day).
	// +required
	MaxDelaySeconds int32 `json:"maxDelaySeconds" protobuf:"varint,1,opt,name=maxDelaySeconds"`
}
```

The field is a pointer to a struct so that it serializes to nothing when
unset and leaves room for a later `mode` (for example a per-run random offset)
without a second top-level field. The field is added to `batch/v1beta1` as
well, as `timeZone` was, because the internal type is shared.

### Offset derivation

```
offset = FNV-1a-64(bytes(metadata.uid)) mod maxDelaySeconds   (seconds)
```

- **Why the UID.** It is immutable, present on every persisted object, and
  differs between clusters, so identical manifests deployed to a fleet spread
  across the fleet (story 2). namespace/name (Jenkins hashes the job name;
  Sankofa's webhook hashes namespace/name) keeps the offset across
  delete/recreate but makes every cluster's copy collide. Mixing in a cluster
  identifier would solve the fleet case but is not available to clients.
- **Why not the nominal time.** Temporal hashes (seed, nominal time), so the
  offset differs per run. A per-run offset breaks the translation property:
  intervals between runs change, and two consecutive runs can reorder when the
  offset exceeds the period. A constant offset keeps the controller's
  arithmetic unchanged.
- **Why not packing.** Avoiding collisions (as Sankofa's webhook does) depends
  on creation order and on other objects, so it cannot be recomputed after a
  restart without persisting it. With N CronJobs over D seconds, a uniform hash
  gives on average N/D starts per second; for N=2000 and D=3600 that is 0.56
  per second, and the unit test asserts that no minute receives more than three
  times its share.

### Controller behaviour

The controller already works through `cron.Schedule.Next`. The reference
implementation wraps the parsed schedule:

```go
type spreadSchedule struct {
	schedule cron.Schedule
	offset   time.Duration
}

func (s spreadSchedule) Next(t time.Time) time.Time {
	next := s.schedule.Next(t.Add(-s.offset))
	if next.IsZero() { // the schedule never fires
		return next
	}
	return next.Add(s.offset)
}
```

`syncCronJob` and `updateCronJob` apply the wrapper after parsing
(`withScheduleSpread`). `updateCronJob` also requeues when `scheduleSpread`
changes, as it does today for `schedule` and `timeZone`. Every derived value
uses the translated time:

| Value | With spread |
| --- | --- |
| Requeue time | next translated activation + 100 ms |
| `status.lastScheduleTime` | translated time of the run |
| Job name suffix (`getJobName`, minutes since epoch) | from the translated time; still unique per run because runs are at least one minute apart |
| `batch.kubernetes.io/cronjob-scheduled-timestamp` | translated time |
| `cronjob_controller_job_creation_skew_duration_seconds` | measured from the translated time, so the intentional offset is not counted as lag |

Recording the translated time keeps restarts idempotent: after a restart, the
controller recomputes the same translated activations from
`lastScheduleTime`, and an already created Job has the same deterministic
name.

### Interaction with other CronJob fields

- **timeZone.** The underlying schedule is evaluated in the time zone (the
  controller prepends `TZ=`), then the instant is translated. A `0 3 * * *`
  CronJob in `America/New_York` with offset 23m17s runs at 03:23:17 local time
  in both EST and EDT. Activations skipped or repeated by DST transitions are
  skipped or repeated identically, shifted by the offset.
- **startingDeadlineSeconds.** Measured from the translated time, exactly as
  it is measured from the nominal time today; there is no interaction to
  validate. A run is missed only if the controller cannot start it within the
  deadline after its translated time.
- **concurrencyPolicy.** Unchanged; `Forbid` and `Replace` act at the translated
  time. Because the translation preserves intervals, a Job that previously had
  the full period to finish still has it.
- **Missed schedules.** `mostRecentScheduleTime` counts translated activations
  between `lastScheduleTime` (or creation) and now; the >100 missed-runs
  warning keeps its meaning.
- **suspend.** Unchanged. On resume, missed translated activations are handled
  as today.
- **Changing `scheduleSpread` or the UID.** Equivalent to editing the schedule:
  the next run is the next translated activation after `lastScheduleTime`.
  Turning the field on mid-period can yield one extra run in that period; turning
  it off can skip none, because the next nominal time after a translated
  `lastScheduleTime` is in the next period.
- **Proposed `status.nextScheduleTime`**
  ([enhancements#6281](https://github.com/kubernetes/enhancements/issues/6281)).
  It must report the translated time; the two KEPs should share the helper.

### Validation

- `maxDelaySeconds` must be in `[1, 86400]`. Validation does not depend on the
  feature gate; when the gate is off, the registry strategy drops the field on
  create and on updates of objects that do not already use it (the pattern
  requested in the `timeZone` review).
- Warning (not error) when `maxDelaySeconds` exceeds the smallest interval of
  the schedule, because the effective phase then wraps modulo the period.
- No restriction against `TZ=`/`CRON_TZ=` in `spec.schedule`: the translation
  is applied after parsing either form.

### Cluster-wide defaults

An admin who wants a default can use a MutatingAdmissionPolicy instead of a
webhook server:

```yaml
apiVersion: admissionregistration.k8s.io/v1beta1
kind: MutatingAdmissionPolicy
metadata:
  name: cronjob-default-spread
spec:
  matchConstraints:
    resourceRules:
    - apiGroups: ["batch"]
      apiVersions: ["v1"]
      operations: ["CREATE"]
      resources: ["cronjobs"]
  matchConditions:
  - name: no-explicit-spread
    expression: "!has(object.spec.scheduleSpread) && !('cronjob.example.com/no-spread' in object.metadata.labels)"
  failurePolicy: Ignore
  reinvocationPolicy: Never
  mutations:
  - patchType: ApplyConfiguration
    applyConfiguration:
      expression: >
        Object{spec: Object.spec{scheduleSpread: Object.spec.scheduleSpread{maxDelaySeconds: 600}}}
```

A kube-controller-manager flag for a default spread was considered and
rejected: it would make a CronJob's behaviour depend on controller
configuration invisible in the object, and different control planes of one
fleet would disagree.

### Test Plan

[x] I/we understand the owners of the involved components may require updates to
existing tests to make this code solid enough prior to committing the changes necessary
to implement this enhancement.

##### Prerequisite testing updates

None.

##### Unit tests

- `k8s.io/kubernetes/pkg/controller/cronjob`: offset determinism, range,
  whole-second granularity and distribution over 2000 UIDs; `spreadSchedule.Next`
  for hourly, daily across midnight, `@every`, `TZ=` and never-firing schedules;
  `mostRecentScheduleTime`/`nextScheduleTime` with `startingDeadlineSeconds`
  measured from the translated time; `syncCronJob` creating the Job at the
  translated time with the translated name, annotation and `lastScheduleTime`,
  and ignoring the field when the gate is off.
- `k8s.io/kubernetes/pkg/apis/batch/validation`: bounds of `maxDelaySeconds`.
- `k8s.io/kubernetes/pkg/registry/batch/cronjob`: drop-disabled-fields on create
  and update with the gate on and off.

The reference patch in this repository contains these tests
(`patches/kubernetes/v1.37.2/`); coverage numbers to be filled from the
upstream PR.

##### Integration tests

- `test/integration/cronjob`: with a fake clock, 200 CronJobs with the same
  schedule and `maxDelaySeconds: 600` produce Jobs whose creation times match
  the computed offsets; restarting the controller between two periods creates
  no duplicate Jobs; toggling the gate off reverts to nominal times.

##### e2e tests

- `test/e2e/apps/cronjob.go`: a CronJob `* * * * *` with
  `maxDelaySeconds: 30` creates Jobs whose scheduled-timestamp annotation has a
  seconds component equal to the offset computed from its UID. Promoted to
  Conformance at GA.

### Graduation Criteria

#### Alpha

- Feature gate `CronJobScheduleSpread` (kube-apiserver and
  kube-controller-manager), disabled by default.
- API field, validation, strategy, controller and unit/integration tests.
- `kubectl describe cronjob` shows the spread and the computed offset.

#### Beta

- Gate enabled by default.
- e2e tests; `nextScheduleTime` (if merged) reports translated time.
- At least two releases of alpha feedback, including a large-cluster report
  (≥1000 CronJobs) from a downstream distribution or provider.
- Decide whether `mode` (per-run random) is needed; if yes, add it as alpha
  under the same struct.

#### GA

- Conformance test.
- No open issues about offset stability.

### Upgrade / Downgrade Strategy

- **Upgrade:** nothing changes until a CronJob sets the field.
- **Downgrade:** an older API server keeps the field in storage but does not
  serve or validate it; an older controller ignores it and CronJobs run at
  nominal times again. `lastScheduleTime` holds a translated time; the next
  nominal activation after it is in the next period, so no run is duplicated.
  Re-upgrading resumes the same offsets because the UID did not change.

### Version Skew Strategy

- **New API server, old controller:** the field is persisted but ignored; runs
  are at nominal times. This is the expected state while kube-controller-manager
  lags behind kube-apiserver during an upgrade.
- **Old API server, new controller:** the field cannot be set (dropped), so the
  controller sees no spread.
- Both components must have the gate enabled for the feature to take effect.

## Production Readiness Review Questionnaire

### Feature Enablement and Rollback

###### How can this feature be enabled / disabled in a live cluster?

- [x] Feature gate
  - Feature gate name: `CronJobScheduleSpread`
  - Components depending on the feature gate: kube-apiserver,
    kube-controller-manager

###### Does enabling the feature change any default behavior?

No. Only CronJobs that set `spec.scheduleSpread` change.

###### Can the feature be disabled once it has been enabled (i.e. can we roll back the enablement)?

Yes. With the gate disabled in kube-controller-manager, the field is ignored
and runs return to nominal times. With the gate disabled in kube-apiserver, the
field is kept on objects that already have it and cannot be added to new ones.

###### What happens if we reenable the feature if it was previously rolled back?

The same offsets apply again (UID-derived). At most one extra run occurs in the
period of re-enablement, as when editing a schedule.

###### Are there any tests for feature enablement/disablement?

Yes: strategy unit tests for drop-disabled-fields, and a controller unit test
with the gate disabled. An integration test toggles the gate between periods.

### Rollout, Upgrade and Rollback Planning

###### How can a rollout or rollback fail? Can it impact already running workloads?

Running Jobs are not affected. A rollback moves future runs of spread CronJobs
back to nominal times, recreating the herd the feature removed.

###### What specific metrics should inform a rollback?

`cronjob_controller_job_creation_skew_duration_seconds` rising for spread
CronJobs (the controller fails to start runs at their translated time);
`MissSchedule` events on spread CronJobs.

###### Were upgrade and rollback tested? Was the upgrade->downgrade->upgrade path tested?

To be done for beta. The reference patch was run on a downstream distribution
(see [evidence.md](evidence.md)).

###### Is the rollout accompanied by any deprecations and/or removals of features, APIs, fields of API types, flags, etc.?

No.

### Monitoring Requirements

###### How can an operator determine if the feature is in use by workloads?

`kubectl get cronjobs -A -o jsonpath='{..scheduleSpread}'`; a new
`cronjob_controller_spread_cronjobs` gauge is proposed for beta.

###### How can someone using this feature know that it is working for their instance?

- [x] API .status
  - `status.lastScheduleTime` and the Job annotation
    `batch.kubernetes.io/cronjob-scheduled-timestamp` carry the translated time.
- [x] Other: `kubectl describe cronjob` prints `Schedule Spread: 3600s (offset 23m17s)`.

###### What are the reasonable SLOs (Service Level Objectives) for the enhancement?

Unchanged from CronJob: a Job is created within a few seconds of its (translated)
scheduled time, as reported by the job creation skew histogram.

###### What are the SLIs (Service Level Indicators) an operator can use to determine the health of the service?

- [x] Metrics
  - Metric name: `cronjob_controller_job_creation_skew_duration_seconds`
  - Components exposing the metric: kube-controller-manager

###### Are there any missing metrics that would be useful to have to improve observability of this feature?

A gauge of CronJobs with a spread, for adoption tracking.

### Dependencies

###### Does this feature depend on any specific services running in the cluster?

No.

### Scalability

###### Will enabling / using this feature result in any new API calls?

No. It removes none either; it moves the same calls from one instant to a
window.

###### Will enabling / using this feature result in introducing new API types?

No, one new struct embedded in CronJobSpec.

###### Will enabling / using this feature result in any new calls to the cloud provider?

No.

###### Will enabling / using this feature result in increasing size or count of the existing API objects?

CronJob grows by about 20 bytes when the field is set.

###### Will enabling / using this feature result in increasing time taken by any operations covered by existing SLIs/SLOs?

No. It reduces peak API latency during schedule boundaries; see
[evidence.md](evidence.md).

###### Will enabling / using this feature result in non-negligible increase of resource usage (CPU, RAM, disk, IO, ...) in any components?

No. One FNV hash per CronJob sync.

###### Can enabling / using this feature result in resource exhaustion of some node resources (PIDs, sockets, inodes, etc.)?

No.

### Troubleshooting

###### How does this feature react if the API server and/or etcd is unavailable?

As today: Jobs are created when the API is available again, subject to
`startingDeadlineSeconds` measured from the translated time.

###### What are other known failure modes?

- A CronJob created close to its nominal time runs in the current period if its
  translated time is still ahead (expected, documented).
- Detection: Job creation times and `lastScheduleTime`.

###### What steps should be taken if SLOs are not being met to determine the problem?

Compare the scheduled-timestamp annotation with the Job creation time; a large
gap points to controller throughput, not to the spread.

## Implementation History

- 2026-11-13: draft and reference implementation against v1.37.2 in the
  Sankofa distribution (not submitted).

## Drawbacks

- One more field on a stable API, whose hash algorithm becomes a permanent
  contract.
- The declared `schedule` no longer tells the whole story; readers must look at
  `scheduleSpread` too. This is the same trade-off `timeZone` made.
- Delete/recreate changes the offset.

## Alternatives

### `H` in `spec.schedule` (Jenkins syntax)

Jenkins resolves `H` from a hash of the job name
([Jenkins docs](https://www.jenkins.io/doc/book/pipeline/syntax/#cron-syntax)).
For Kubernetes this would require a fork of robfig/cron, which has had no
commit since 2021 and has left `H` support unmerged
([robfig/cron#309](https://github.com/robfig/cron/issues/309),
[#531](https://github.com/robfig/cron/pull/531)); every tool that parses
`spec.schedule` (kubectl, linters, dashboards, GitOps diffing) would reject or
misread it; SIG Apps already removed non-standard schedule syntax
(`TZ=`/`CRON_TZ=` in
[kubernetes/kubernetes#116252](https://github.com/kubernetes/kubernetes/pull/116252))
in favour of a field. `H` also only spreads to minute granularity.

### Mutating admission webhook (what Sankofa ships today)

Sankofa's Polyrhythm webhook rewrites `H` in the minute field to a concrete
minute chosen by FNV hash of namespace/name and moved forward to a minute not
yet used by CronJobs with the same remaining fields, and records the written
schedule in an annotation. It needs no core change, but:

- it lists every CronJob in the cluster on each CronJob create/update to find
  free minutes, which grows quadratically with the number of CronJobs;
- the chosen minute depends on creation order and is not reproducible;
- it only spreads across minutes, leaving a burst at second `:00` of each
  minute (measured in [evidence.md](evidence.md));
- with `failurePolicy: Ignore`, a webhook outage makes `H` schedules fail
  validation; with `Fail`, it blocks all CronJob writes;
- the stored `spec.schedule` differs from the manifest, so GitOps tools see
  permanent drift unless they ignore the field.

### `.spec.jitter` as a percentage of the interval (KEP-19 sketch)

KEP-19 proposed `jitter = (next - now) * spec.jitter / 100`, capped at 50%.
That depends on `now`, so the offset changes with controller restarts and
resyncs, and it makes the offset of irregular schedules vary per run. A
duration bound with a UID-derived offset is deterministic and simpler to
reason about.

### Random offset per run (systemd `RandomizedDelaySec`, cronie `RANDOM_DELAY`)

Not reproducible across restarts without persisting the drawn value; changes
intervals between runs. Can be added later as `mode: PerRun` if users need it,
with the chosen time persisted in status.

### Controller rate limiting / a global concurrency cap

The CronJob controller's client rate limit already serializes the herd, but
unfairly (the measured median Job was 46 s late, the last 94 s) and without
predictability. A cap across CronJobs addresses resource usage of running
Jobs, not the creation burst; it is complementary (see #138569).

### Do it in the ecosystem

This was the 2018 answer to time zones
([kubernetes/kubernetes#47202](https://github.com/kubernetes/kubernetes/issues/47202#issuecomment-360820586)),
which later became KEP-3140. No out-of-tree CronJob spreading controller has
gained adoption in six years of #91652; the only alternatives in use are
`sleep`, Helm hashing and webhooks like Sankofa's, each with the costs listed in
[Motivation](#motivation). Spreading has to happen where the scheduled time is
computed, which is the CronJob controller.

## Prior art

- systemd timers: `RandomizedDelaySec=` (v229), `FixedRandomDelay=` (v247,
  stable delay from machine ID, user and unit name), `RandomizedOffsetSec=`
  (v258, stable offset for `OnCalendar=` timers — the closest analogue to this
  KEP). <https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html>
- Jenkins `H`: hash of the job's full name; `H(0-29)`, `H/15`.
  <https://www.jenkins.io/doc/book/pipeline/syntax/#cron-syntax>
- Temporal Schedules: `ScheduleSpec.jitter`, deterministic per (seed, nominal
  time), capped at the gap to the next action. <https://docs.temporal.io/schedule>
- AWS EventBridge Scheduler flexible time windows.
  <https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-schedule-flexible-time-windows.html>
- GitHub Actions documents delays at the start of every hour and asks users to
  pick other minutes.
  <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows>
- Flux reconcile interval jitter, on by default
  ([fluxcd/flux2#4120](https://github.com/fluxcd/flux2/issues/4120)).
- Nomad `periodic`, Google Cloud Scheduler: no jitter.
- Argo Workflows: open request for `H`-style spreading
  ([argoproj/argo-workflows#16603](https://github.com/argoproj/argo-workflows/issues/16603)).
- KEP-3140 (CronJob `timeZone`, alpha 1.24, beta 1.25, GA 1.27) is the precedent
  for adding an optional pointer field to `CronJobSpec` behind a gate in both
  kube-apiserver and kube-controller-manager.
  <https://github.com/kubernetes/enhancements/tree/master/keps/sig-apps/3140-TimeZone-support-in-CronJob>
