#!/usr/bin/env bash
# Roll out the angel image CI published for the checked-out commit (cmd/angel
# with a static ffmpeg on distroless, ghcr_image in env.sh) together with
# whisper.cpp. Nothing is built here: push the commit to main and wait for the
# Images workflow first.
set -euo pipefail
cd "$(dirname "$0")/../.."
source hack/stand/env.sh
export PATH="$HOME/go/bin:$PATH"
WHISPER_IMAGE=${WHISPER_IMAGE:-ghcr.io/ggml-org/whisper.cpp:main}
mkdir -p dist
img=$(ghcr_image angel)
# whisper.cpp is pulled from its official registry, pinned to the digest the
# tag points at right now.
whisper="${WHISPER_IMAGE%%:*}@$(crane digest "$WHISPER_IMAGE")"
sed -e "s#ANGEL_IMAGE#$img#" -e "s#WHISPER_IMAGE#$whisper#" \
  -e "s#MUSEUM_HOST#${MUSEUM_HOST:-museum.sankofa.workshop.aenix.io}#g" -e "s#PUBLIC_HOST#${PUBLIC_HOST:-sankofa.black}#g" \
  deploy/angel.yaml > dist/angel.yaml
km apply -f dist/angel.yaml >/dev/null
km -n sankofa-museum rollout status deploy/angel --timeout=180s
# The first start downloads the model (about 490 MB).
km -n sankofa-museum rollout status deploy/whisper --timeout=900s
echo "$img" >&2
host=${PUBLIC_HOST:-sankofa.black}
for _ in $(seq 1 20); do
  curl -sfk "https://$host/api/angel/healthz" >/dev/null && { echo "angel answers on $host"; exit 0; }
  sleep 3
done
echo "angel does not answer on https://$host/api/angel/healthz" >&2
exit 1
