#!/usr/bin/env bash
# Build the museum (data + site), pack it onto nginx-unprivileged without a
# Docker daemon, push it to the stand and roll it out.
set -euo pipefail
cd "$(dirname "$0")/../.."
source hack/stand/env.sh
(cd web && sh scripts/build-data.sh >/dev/null && npx vite build >/dev/null)
# Two layers: the pictures (large, rarely changed) and the site. Each tar is
# byte-for-byte reproducible (fixed times, owners, sorted names), so an
# unchanged picture layer keeps its digest and is never pushed again.
rm -rf dist/museum-media dist/museum-site dist/museum-*.tar dist/museum.tar
mkdir -p dist/museum-media/usr/share/nginx/html dist/museum-site/usr/share/nginx/html dist/museum-site/etc/nginx/conf.d
cp -R web/dist/media dist/museum-media/usr/share/nginx/html/
rsync -a --exclude /media web/dist/ dist/museum-site/usr/share/nginx/html/
cp web/nginx.conf dist/museum-site/etc/nginx/conf.d/default.conf
for l in media site; do
  (cd "dist/museum-$l" && chmod -R a+rX . && find . -exec touch -h -t 202601010000 {} + &&
    find . -mindepth 1 | LC_ALL=C sort | COPYFILE_DISABLE=1 tar --uid 0 --gid 0 --uname root --gname root --no-recursion -cf "../museum-$l.tar" -T -)
done
"$HOME/go/bin/crane" append --platform linux/amd64 -b nginxinc/nginx-unprivileged:1.29-alpine \
  -f dist/museum-media.tar -f dist/museum-site.tar -t sankofa/museum:dev -o dist/museum.tar >/dev/null
img=$(hack/stand/push.sh museum dist/museum.tar | tail -1)
[[ $img == localhost:5000/* ]] || { echo "push failed" >&2; exit 1; }
sed -e "s#MUSEUM_IMAGE#$img#" -e "s#MUSEUM_HOST#${MUSEUM_HOST:-museum.sankofa.workshop.aenix.io}#g" -e "s#PUBLIC_HOST#${PUBLIC_HOST:-sankofa.black}#g" deploy/museum.yaml > dist/museum.yaml
km apply -f dist/museum.yaml >/dev/null
km -n sankofa-museum rollout status deploy/museum --timeout=180s
echo "$img" >&2
# Prove the public museum now serves this very build.
want=$(ls web/dist/assets/index-*.js | xargs -n1 basename)
for _ in $(seq 1 20); do
  got=$(curl -sk "https://${MUSEUM_HOST:-museum.sankofa.workshop.aenix.io}/" | grep -o 'assets/index-[^"]*\.js' | head -1 | xargs -n1 basename 2>/dev/null || true)
  [[ $got == "$want" ]] && { echo "served build $got"; exit 0; }
  sleep 3
done
echo "the museum still serves $got, not $want" >&2
exit 1
