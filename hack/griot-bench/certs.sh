#!/usr/bin/env bash
# Certificates of the throwaway benchmark control plane: a cluster CA, the
# apiserver serving certificate, an admin client, the service account key and
# the front proxy (aggregation) CA and client. Written to $1, never to the
# repository; nothing here protects anything beyond the benchmark.
set -euo pipefail
d=${1:?output dir}
mkdir -p "$d"; cd "$d"
ca() { openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=$2" -keyout "$1.key" -out "$1.crt" 2>/dev/null; }
leaf() { # name ca subj ext
  openssl req -newkey rsa:2048 -nodes -subj "$3" -keyout "$1.key" -out "$1.csr" 2>/dev/null
  printf '%s\n' "$4" > "$1.ext"
  openssl x509 -req -in "$1.csr" -CA "$2.crt" -CAkey "$2.key" -CAcreateserial -days 30 -extfile "$1.ext" -out "$1.crt" 2>/dev/null
}
ca ca bench-ca
ca front-proxy-ca bench-front-proxy-ca
leaf apiserver ca "/CN=kube-apiserver" "subjectAltName=DNS:vapi,DNS:vapi.griot-bench,DNS:vapi.griot-bench.svc,DNS:localhost,IP:127.0.0.1,IP:10.96.0.1
extendedKeyUsage=serverAuth"
leaf admin ca "/O=system:masters/CN=bench-admin" "extendedKeyUsage=clientAuth"
leaf front-proxy-client front-proxy-ca "/CN=front-proxy-client" "extendedKeyUsage=clientAuth"
openssl genrsa -out sa.key 2048 2>/dev/null
openssl rsa -in sa.key -pubout -out sa.pub 2>/dev/null
cat > kubeconfig <<KC
apiVersion: v1
kind: Config
clusters: [{name: bench, cluster: {server: https://vapi.griot-bench.svc:6443, certificate-authority-data: $(base64 < ca.crt | tr -d '\n')}}]
users: [{name: admin, user: {client-certificate-data: $(base64 < admin.crt | tr -d '\n'), client-key-data: $(base64 < admin.key | tr -d '\n')}}]
contexts: [{name: bench, context: {cluster: bench, user: admin}}]
current-context: bench
KC
sed 's#https://vapi.griot-bench.svc:6443#https://localhost:6443#' kubeconfig > kubeconfig.local
rm -f ./*.csr ./*.ext ./*.srl
