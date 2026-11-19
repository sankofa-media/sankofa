#!/usr/bin/env bash
# Build the museum (data + site), pack it onto nginx-unprivileged without a
# Docker daemon, push it to the stand and roll it out.
set -euo pipefail
cd "$(dirname "$0")/../.."
source hack/stand/env.sh
# One deploy at a time: two pushes through the same registry tunnel stall each other.
# The lock lives beside the stand credentials, not in the checkout, so it also
# holds deploys started from other worktrees. A lock whose owner died is taken over.
LOCK=${MUSEUM_DEPLOY_LOCK:-$HOME/.sankofa-stand/museum-deploy.lock}
mkdir -p "$(dirname "$LOCK")" dist
if ! mkdir "$LOCK" 2>/dev/null; then
  sleep 1 # the owner may not have written its pid yet
  owner=$(cat "$LOCK/pid" 2>/dev/null || true)
  if [ -n "$owner" ] && kill -0 "$owner" 2>/dev/null; then
    echo "another museum deploy is running (pid $owner, $(cat "$LOCK/dir" 2>/dev/null)); wait for it" >&2
    exit 1
  fi
  echo "taking over a stale deploy lock (pid ${owner:-unknown} is gone)" >&2
fi
echo $$ >"$LOCK/pid"
pwd >"$LOCK/dir"
trap 'rm -f "$LOCK/pid" "$LOCK/dir"; rmdir "$LOCK" 2>/dev/null || true' EXIT
(cd web && sh scripts/build-data.sh >/dev/null && npx vite build >/dev/null)
# The pictures go in three layers (card pictures, cabinet things, longread art)
# and the site in a fourth. A picture layer is byte-for-byte reproducible (fixed
# times, owners, sorted names), so an unchanged one keeps its digest and is never
# pushed again: new cabinet things re-send only the cabinet layer. The site layer
# keeps real file times: nginx builds ETag and Last-Modified from them, and a
# fixed time made browsers keep an old index.html of the same size.
rm -rf dist/museum-* dist/museum.tar
layers=(cards cabinet features site)
for l in "${layers[@]}"; do mkdir -p "dist/museum-$l/usr/share/nginx/html/media"; done
(cd web/dist/media && find . -type f | sed 's#^\./##') | while IFS= read -r f; do
  case "$f" in
    features/*) l=features ;;
    cab-* | */cab-*) l=cabinet ;;
    *) l=cards ;;
  esac
  mkdir -p "dist/museum-$l/usr/share/nginx/html/media/$(dirname "$f")"
  cp -p "web/dist/media/$f" "dist/museum-$l/usr/share/nginx/html/media/$f"
done
mkdir -p dist/museum-site/etc/nginx/conf.d
rm -rf dist/museum-site/usr/share/nginx/html/media
rsync -a --exclude /media web/dist/ dist/museum-site/usr/share/nginx/html/
cp web/nginx.conf dist/museum-site/etc/nginx/conf.d/default.conf
tars=()
for l in "${layers[@]}"; do
  (cd "dist/museum-$l" && chmod -R a+rX . && { [ "$l" = site ] || find . -exec touch -h -t 202601010000 {} +; } &&
    find . -mindepth 1 | LC_ALL=C sort | COPYFILE_DISABLE=1 tar --uid 0 --gid 0 --uname root --gname root --no-recursion -cf "../museum-$l.tar" -T -)
  tars+=(-f "dist/museum-$l.tar")
done
"$HOME/go/bin/crane" append --platform linux/amd64 -b nginxinc/nginx-unprivileged:1.29-alpine \
  "${tars[@]}" -t sankofa/museum:dev -o dist/museum.tar >/dev/null
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
