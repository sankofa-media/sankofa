# Patches to upstream components

Sankofa carries a small number of patches to Kubernetes itself. Each one is a
reference implementation of a proposal drafted in `docs/`, kept here until (and
unless) the change lands upstream. Patches are plain `git format-patch` output
against the release tag that kuberoot pins in `build/components.env`
(`K8S_VERSION`).

| Directory | Patch | Proposal |
| --- | --- | --- |
| `kubernetes/v1.37.2/` | `0001-batch-add-CronJob-spec.scheduleSpread-behind-CronJob.patch`: API field, feature gate, validation, registry strategy and generated code | [CronJob schedule spread](../docs/kep-cronjob-spread/README.md) |
| `kubernetes/v1.37.2/` | `0002-cronjob-translate-the-schedule-by-the-scheduleSpread.patch`: controller and its tests | same |

## How the distribution applies them

kuberoot downloads the official Kubernetes binaries into the node image
(`scripts/build-rootfs.sh`). Sankofa replaces two of them:

1. `hack/kuberoot.sh kube amd64` copies this repository into the builder and
   runs `patches/kubernetes/build.sh <K8S_VERSION> amd64` there. The script
   clones the release tag, applies every patch of that version with `git am`
   and builds `kube-apiserver` and `kube-controller-manager` into
   `/work/out/amd64/sankofa/kubernetes/`. The binaries report
   `<K8S_VERSION>+sankofa`; build metadata does not change version-skew
   comparisons with the stock kubelet.
2. `hack/kuberoot.sh build amd64` (and `media`/`bundle`) runs kuberoot's image
   build with `distros/sankofa/extras.sh`. When patched binaries are present,
   extras.sh installs them over the official ones **and** adds
   `--feature-gates=CronJobScheduleSpread=true` to both components in the
   baked profile. The binaries and the gate are installed together, so a stock
   binary never receives a gate it does not know. Without a `kube` step the
   image is built from stock binaries exactly as before.
3. Nodes receive the new image through the signed update path in
   `docs/kuberoot.md` ("Signed updates and persistence").

The feature gate is declared with `Version: 1.37` in the patch so that it can
be enabled on a 1.37 binary. Upstream, an alpha gate would be introduced in
the next minor release.

## Tests

Run in the builder, inside the patched tree:

```sh
go test ./pkg/controller/cronjob/ ./pkg/apis/batch/... ./pkg/registry/batch/cronjob/...
(cd staging/src/k8s.io/api && go test . -run //HEAD)
go test ./pkg/api/testing/
```

The reference patch implements the API, validation, strategy and controller
parts of the proposal. The API warning for `@every` schedules and for spreads
larger than the schedule's interval, and the `kubectl describe` output, are
described in the proposal but not part of the patch.

## Updating to a new Kubernetes version

Create `kubernetes/<new version>/`, apply the old patches to the new tag, fix
conflicts, regenerate code with
`hack/update-codegen.sh protobuf deepcopy defaults validation conversions openapi applyconfigs swagger prerelease`
and the API compatibility fixtures with
`UPDATE_COMPATIBILITY_FIXTURE_DATA=true go test k8s.io/api -run //HEAD`,
then export with `git format-patch <tag>..`.
