#!/usr/bin/env bash
# The audit policy and webhook configuration of the benchmark control plane,
# as the Secret vapi-audit. Run before applying vapi.yaml. Needs BENCH_CERTS.
set -euo pipefail
cd "$(dirname "$0")/../.."
source hack/griot-bench/run.sh
d=$(mktemp -d)
cat > "$d/policy.yaml" <<'YAML'
apiVersion: audit.k8s.io/v1
kind: Policy
omitStages: [RequestReceived]
rules:
  - level: None
    verbs: [get, list, watch]
  - level: None
    resources: [{group: coordination.k8s.io, resources: [leases]}, {group: "", resources: [events]}]
  - level: Metadata
YAML
cat > "$d/webhook.kubeconfig" <<YAML
apiVersion: v1
kind: Config
clusters: [{name: griot, cluster: {server: "https://griot-pg.griot-bench.svc:9444/audit", certificate-authority-data: $(base64 < "$BENCH_CERTS/ca.crt" | tr -d '\n')}}]
users: [{name: apiserver, user: {client-certificate-data: $(base64 < "$BENCH_CERTS/admin.crt" | tr -d '\n'), client-key-data: $(base64 < "$BENCH_CERTS/admin.key" | tr -d '\n')}}]
contexts: [{name: griot, context: {cluster: griot, user: apiserver}}]
current-context: griot
YAML
km -n griot-bench create secret generic vapi-audit --from-file="$d/policy.yaml" --from-file="$d/webhook.kubeconfig" --dry-run=client -o yaml | km apply -f -
rm -r "$d"
