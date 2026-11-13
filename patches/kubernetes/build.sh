#!/bin/sh
# Builds patched Kubernetes control-plane binaries for the Sankofa node image.
# Runs in the builder (hack/kuberoot.sh kube ARCH), never on a workstation.
# Usage: patches/kubernetes/build.sh <version> <arch>
set -eu
VERSION=${1:?version, e.g. v1.37.2}
ARCH=${2:?arch}
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=${KUBE_SRC:-/work/src/kubernetes-$VERSION-sankofa}
OUT=${KUBE_OUT:-/work/out/$ARCH/sankofa/kubernetes}
ls "$HERE/$VERSION"/*.patch >/dev/null
rm -rf "$SRC"
git clone -q --depth 1 --branch "$VERSION" https://github.com/kubernetes/kubernetes "$SRC"
cd "$SRC"
git -c user.name=sankofa -c user.email=sankofa@invalid am -q "$HERE/$VERSION"/*.patch
unset GOFLAGS
mkdir -p "$OUT"
for c in kube-apiserver kube-controller-manager; do
  CGO_ENABLED=0 GOOS=linux GOARCH="$ARCH" go build -p "${JOBS:-2}" -trimpath \
    -ldflags "-s -w -X k8s.io/component-base/version.gitVersion=$VERSION+sankofa -X k8s.io/component-base/version.gitTreeState=clean" \
    -o "$OUT/$c" "./cmd/$c"
done
ls "$HERE/$VERSION"/*.patch | xargs -n1 basename > "$OUT/PATCHES"
