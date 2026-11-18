#!/usr/bin/env bash
# Helpers for the Griot benchmark on the stand. Source it:
#   source hack/griot-bench/run.sh
#   bench create --namespaces 20          # runs griot-bench in a pod, waits, prints its log
#   bench_bg update --rate 400 --duration 10m   # same, without waiting (pod name printed)
#   vk get ns                             # kubectl against the benchmark control plane
# Needs BENCH_IMAGE (digest from hack/stand/push.sh griot-bench ./hack/griot-bench)
# and BENCH_CERTS (output dir of certs.sh).
source "$(git rev-parse --show-toplevel)/hack/stand/env.sh"
BN=griot-bench

_bench_pod() {
  local name=$1; shift
  local args; args=$(printf '"%s",' "$@"); args="[${args%,}]"
  km -n $BN apply --validate=false -f - >/dev/null <<YAML
apiVersion: v1
kind: Pod
metadata: {name: $name, namespace: $BN, labels: {app: bench-run}}
spec:
  restartPolicy: Never
  containers:
    - name: bench
      image: $BENCH_IMAGE
      args: $args
      env:
        - {name: KUBECONFIG, value: /pki/kubeconfig}
        - name: PGPASSWORD
          valueFrom: {secretKeyRef: {name: griot-postgres, key: password}}
        - {name: GRIOT_DSN, value: "postgres://griot@postgres.griot-bench.svc:5432/griot?sslmode=disable"}
      volumeMounts: [{name: pki, mountPath: /pki}]
      resources: {requests: {cpu: 50m, memory: 128Mi}, limits: {memory: 1Gi}}
  volumes: [{name: pki, secret: {secretName: vapi-pki}}]
YAML
}

bench_bg() { local n="bench-$1-$(date +%H%M%S)"; _bench_pod "$n" "$@"; echo "$n"; }

bench() {
  local n; n=$(bench_bg "$@")
  km -n $BN wait --for=jsonpath='{.status.phase}'=Succeeded "pod/$n" --timeout=3h >/dev/null 2>&1 || true
  km -n $BN logs "$n"
}

# kubectl for the benchmark control plane, through a port-forward.
vk() {
  if ! curl -sk https://localhost:16443/livez >/dev/null 2>&1; then
    km -n $BN port-forward svc/vapi 16443:6443 >/dev/null 2>&1 &
    sleep 3
  fi
  kubectl --kubeconfig "$BENCH_CERTS/kubeconfig.local" --server https://localhost:16443 --context bench "$@"
}

# Push an image tarball (ko build --push=false --tarball=...) to the registry
# of every node from inside the stand: a laptop port-forward is too fragile
# for large uploads. Prints the digest reference.
push_in_stand() {
  local name=$1 tar=$2 ref=""
  km -n $BN get pod crane >/dev/null 2>&1 || {
    km -n $BN run crane --image=gcr.io/go-containerregistry/crane:debug --restart=Never --command -- sleep 86400 >/dev/null
    km -n $BN wait --for=condition=Ready pod/crane --timeout=120s >/dev/null
  }
  km -n $BN cp "$tar" "crane:/tmp/$name.tar" >/dev/null
  for ip in $(km -n sankofa-registry get pods -l app=registry -o jsonpath='{.items[*].status.podIP}'); do
    ref=$(km -n $BN exec crane -- crane push --insecure "/tmp/$name.tar" "$ip:5000/sankofa/$name:dev" 2>/dev/null)
  done
  echo "localhost:5000/sankofa/$name@${ref##*@}"
}
