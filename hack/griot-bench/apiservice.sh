#!/usr/bin/env bash
# Register the PostgreSQL Griot as history.sankofa.kuberoot.dev in the
# benchmark control plane. The aggregator routes to Endpoints (vapi runs with
# --enable-aggregator-routing), which point at the Service of griot-pg in the
# hosting cluster. Needs BENCH_CERTS.
set -euo pipefail
cd "$(dirname "$0")/../.."
source hack/griot-bench/run.sh
ip=$(km -n griot-bench get svc griot-pg -o jsonpath='{.spec.clusterIP}')
vk apply -f - <<YAML
apiVersion: v1
kind: Namespace
metadata: {name: griot-bench}
---
apiVersion: v1
kind: Service
metadata: {name: griot-pg, namespace: griot-bench}
spec: {ports: [{name: https, port: 443, targetPort: 443}]}
---
apiVersion: v1
kind: Endpoints
metadata: {name: griot-pg, namespace: griot-bench}
subsets: [{addresses: [{ip: $ip}], ports: [{name: https, port: 443}]}]
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata: {name: griot-pg-1, namespace: griot-bench, labels: {kubernetes.io/service-name: griot-pg}}
addressType: IPv4
endpoints: [{addresses: [$ip], conditions: {ready: true}}]
ports: [{name: https, port: 443, protocol: TCP}]
---
apiVersion: apiregistration.k8s.io/v1
kind: APIService
metadata: {name: v1alpha1.history.sankofa.kuberoot.dev}
spec:
  group: history.sankofa.kuberoot.dev
  version: v1alpha1
  groupPriorityMinimum: 1000
  versionPriority: 15
  service: {name: griot-pg, namespace: griot-bench, port: 443}
  caBundle: $(base64 < "$BENCH_CERTS/ca.crt" | tr -d '\n')
YAML
