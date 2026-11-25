#!/usr/bin/env bash
# Roll out the Griot image CI published for the checked-out commit
# (ghcr_image in env.sh). Nothing is built here: push the commit to main and
# wait for the Images workflow first.
set -euo pipefail
cd "$(dirname "$0")/../.."
source hack/stand/env.sh
img=$(ghcr_image griot)
mkdir -p dist
sed "s#GRIOT_IMAGE#$img#" deploy/griot.yaml > dist/griot.yaml
km apply -f deploy/crds/ >/dev/null
km apply -f dist/griot.yaml >/dev/null
km apply -f deploy/webhooks.yaml >/dev/null
km -n sankofa-system rollout status deploy/griot --timeout=180s
km wait --for=condition=Available apiservice/v1alpha1.history.sankofa.kuberoot.dev --timeout=120s >/dev/null
echo "$img"
