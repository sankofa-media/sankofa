# shellcheck shell=bash
# Source me: km is kubectl for the museum cluster of the stand.
MUSEUM_KUBECONFIG=${MUSEUM_KUBECONFIG:-$HOME/.sankofa-stand/museum.kubeconfig}
MUSEUM_CONTEXT=${MUSEUM_CONTEXT:-kubernetes-super-admin@kubernetes-museum}
km() { kubectl --kubeconfig "$MUSEUM_KUBECONFIG" --context "$MUSEUM_CONTEXT" "$@"; }

# The stand runs the images CI publishes (.github/workflows/images.yml) on
# every push to main, pinned by digest. ghcr_image <name> prints
#   ghcr.io/sankofa-media/sankofa/<name>@sha256:...
# for the image of the checked-out commit (tag sha-<first 7 hex digits>, as
# docker/metadata-action names it, even where git would need more). IMAGE_TAG
# picks another tag, e.g. IMAGE_TAG=latest or IMAGE_TAG=sha-2b3c21a.
IMAGE_REPO=${IMAGE_REPO:-ghcr.io/sankofa-media/sankofa}
ghcr_image() {
  local name=$1 tag ref digest
  tag=${IMAGE_TAG:-sha-$(git rev-parse HEAD | cut -c1-7)}
  ref=$IMAGE_REPO/$name:$tag
  if [ -z "${IMAGE_TAG:-}" ] && [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "note: uncommitted changes are not deployed; the stand gets $ref" >&2
  fi
  if ! digest=$("${CRANE:-$HOME/go/bin/crane}" digest "$ref" 2>/dev/null); then
    echo "no image $ref: push the commit to main and wait for the Images workflow" >&2
    return 1
  fi
  echo "$IMAGE_REPO/$name@$digest"
}
