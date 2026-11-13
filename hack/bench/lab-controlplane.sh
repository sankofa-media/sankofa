#!/bin/sh
# A throwaway control plane inside the builder for CronJob herd measurements:
# etcd, kube-apiserver and kube-controller-manager (patched or stock), the
# stock kube-scheduler, no nodes. Everything listens on 127.0.0.1 only.
# Usage: lab-controlplane.sh up BIN_DIR [GATES] | down
# BIN_DIR holds kube-apiserver, kube-controller-manager, kube-scheduler, etcd.
set -eu
LAB=${LAB:-/work/lab}
case ${1:-} in
down)
  for p in "$LAB"/*.pid; do [ -f "$p" ] && kill "$(cat "$p")" 2>/dev/null || true; done
  exit ;;
up) BIN=${2:?bin dir}; GATES=${3:-} ;;
*) echo "usage: $0 up BIN_DIR [GATES] | down" >&2; exit 1 ;;
esac
mkdir -p "$LAB/pki" "$LAB/logs"
cd "$LAB"
[ -f pki/sa.key ] || openssl genrsa -out pki/sa.key 2048 2>/dev/null
[ -f pki/sa.pub ] || openssl rsa -in pki/sa.key -pubout -out pki/sa.pub 2>/dev/null
TOKEN=$(cat token 2>/dev/null || (head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n' | tee token))
echo "$TOKEN,lab-admin,lab-admin,system:masters" > pki/tokens.csv
cat > kubeconfig <<KC
apiVersion: v1
kind: Config
clusters: [{name: lab, cluster: {server: "https://127.0.0.1:16443", insecure-skip-tls-verify: true}}]
users: [{name: lab, user: {token: "$TOKEN"}}]
contexts: [{name: lab, context: {cluster: lab, user: lab}}]
current-context: lab
KC
gate() { [ -n "$GATES" ] && echo "--feature-gates=$GATES" || true; }
start() { name=$1; shift; nice -n 10 "$@" > "logs/$name.log" 2>&1 & echo $! > "$name.pid"; }
rm -rf etcd-data
start etcd "$BIN/etcd" --data-dir=etcd-data --listen-client-urls=http://127.0.0.1:12379 \
  --advertise-client-urls=http://127.0.0.1:12379 --listen-peer-urls=http://127.0.0.1:12380 \
  --listen-metrics-urls=http://127.0.0.1:12381 --quota-backend-bytes=4294967296
sleep 3
start apiserver "$BIN/kube-apiserver" --etcd-servers=http://127.0.0.1:12379 --bind-address=127.0.0.1 \
  --secure-port=16443 --cert-dir="$LAB/pki" --token-auth-file=pki/tokens.csv --authorization-mode=RBAC \
  --service-account-issuer=https://lab.invalid --service-account-key-file=pki/sa.pub \
  --service-account-signing-key-file=pki/sa.key --service-cluster-ip-range=10.250.0.0/16 \
  --enable-admission-plugins=NamespaceLifecycle,ServiceAccount,DefaultTolerationSeconds $(gate)
i=0; until "$BIN/kubectl" --kubeconfig kubeconfig --context lab get --raw /readyz >/dev/null 2>&1; do i=$((i+1)); [ $i -lt 60 ] || { tail logs/apiserver.log; exit 1; }; sleep 1; done
start controller-manager "$BIN/kube-controller-manager" --kubeconfig=kubeconfig \
  --authentication-kubeconfig=kubeconfig --authorization-kubeconfig=kubeconfig \
  --authorization-always-allow-paths=/metrics,/healthz --bind-address=127.0.0.1 --secure-port=10357 \
  --controllers=cronjob-controller,job-controller,serviceaccount-controller,garbage-collector-controller,namespace-controller \
  --leader-elect=false $(gate)
start scheduler "$BIN/kube-scheduler" --kubeconfig=kubeconfig --authentication-kubeconfig=kubeconfig \
  --authorization-kubeconfig=kubeconfig --authorization-always-allow-paths=/metrics,/healthz \
  --bind-address=127.0.0.1 --secure-port=10359 --leader-elect=false
echo "lab up: KUBECONFIG=$LAB/kubeconfig context lab"
