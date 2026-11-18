#!/usr/bin/env bash
# Build the angel service (cmd/angel) with a static ffmpeg on distroless,
# without a Docker daemon, push it to the stand and roll it out together with
# whisper.cpp. Same path as museum.sh: crane append, push.sh, sed, km apply.
set -euo pipefail
cd "$(dirname "$0")/../.."
source hack/stand/env.sh
export PATH="$HOME/go/bin:$PATH"
BASE_IMAGE=${BASE_IMAGE:-gcr.io/distroless/static-debian12:nonroot}
FFMPEG_IMAGE=${FFMPEG_IMAGE:-mwader/static-ffmpeg:9.0.2}
WHISPER_IMAGE=${WHISPER_IMAGE:-ghcr.io/ggml-org/whisper.cpp:main}

rm -rf dist/angel-bin dist/angel-ffmpeg dist/angel-*.tar dist/angel.tar
mkdir -p dist/angel-bin/usr/local/bin dist/angel-ffmpeg/usr/local/bin
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags='-s -w' -o dist/angel-bin/usr/local/bin/angel ./cmd/angel
# A fully static ffmpeg (with libmp3lame) taken out of its image: it runs on
# distroless/static, which has no shell and no libc to speak of.
crane export --platform linux/amd64 "$FFMPEG_IMAGE" - | tar -x -C dist/angel-ffmpeg/usr/local/bin ffmpeg
# Reproducible layers (fixed times, owners, sorted names): an unchanged ffmpeg
# keeps its digest and is never pushed again.
for l in ffmpeg bin; do
  (cd "dist/angel-$l" && chmod -R a+rX . && find . -exec touch -h -t 202601010000 {} + &&
    find . -mindepth 1 | LC_ALL=C sort | COPYFILE_DISABLE=1 tar --uid 0 --gid 0 --uname root --gname root --no-recursion -cf "../angel-$l.tar" -T -)
done
crane append --platform linux/amd64 -b "$BASE_IMAGE" \
  -f dist/angel-ffmpeg.tar -f dist/angel-bin.tar -t sankofa/angel:dev -o dist/angel.tar >/dev/null
img=$(hack/stand/push.sh angel dist/angel.tar | tail -1)
[[ $img == localhost:5000/* ]] || { echo "push failed" >&2; exit 1; }
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
