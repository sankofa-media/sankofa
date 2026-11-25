#!/usr/bin/env bash
# Roll out the museum image CI published for the checked-out commit
# (ghcr_image in env.sh). Nothing is built here: push the commit to main and
# wait for the Images workflow first.
set -euo pipefail
cd "$(dirname "$0")/../.."
source hack/stand/env.sh
mkdir -p dist
img=$(ghcr_image museum)
host=${MUSEUM_HOST:-museum.sankofa.workshop.aenix.io}
public=${PUBLIC_HOST:-sankofa.black}
# The published image serves static content only; the stand adds the cluster
# integration (/pulse from Griot) as nginx config, a ConfigMap placed right
# after the namespace so the new pods find it when they start.
km -n sankofa-museum create configmap museum-nginx --from-file=pulse.conf=web/nginx-pulse.conf \
  --dry-run=client -o yaml > dist/museum-nginx.yaml
sed -e "s#MUSEUM_IMAGE#$img#" -e "s#MUSEUM_HOST#$host#g" -e "s#PUBLIC_HOST#$public#g" deploy/museum.yaml |
  awk -v cm=dist/museum-nginx.yaml '/^---$/ && !done { print; while ((getline l < cm) > 0) print l; done = 1 } { print }' > dist/museum.yaml
# The sitemap before this deploy, so IndexNow hears only about pages that changed.
curl -fsS "https://$public/sitemap.xml" -o dist/sitemap.before.xml 2>/dev/null || : >dist/sitemap.before.xml
before=$(curl -sk "https://$host/" | grep -o 'assets/index-[^"]*\.js' | head -1 || true)
km apply -f dist/museum.yaml >/dev/null
km -n sankofa-museum rollout status deploy/museum --timeout=180s
echo "$img" >&2
# After the rollout only pods of this image are left; prove the public museum
# answers with a build.
for _ in $(seq 1 20); do
  got=$(curl -sfk "https://$host/" | grep -o 'assets/index-[^"]*\.js' | head -1 || true)
  if [ -n "$got" ]; then
    if [ "$got" = "$before" ]; then echo "served build $got (unchanged)"; else echo "served build $got (was ${before:-none})"; fi
    hack/stand/indexnow.sh dist/sitemap.before.xml "$public" || true
    exit 0
  fi
  sleep 3
done
echo "the museum does not serve its index on https://$host/" >&2
exit 1
