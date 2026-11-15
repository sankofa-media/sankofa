#!/bin/sh
# Build the museum data from the content repository:
#   web/public/data/cards.json     (sankofa content export)
#   web/public/data/chapters.json  (chapter Markdown -> JSON)
#   web/public/data/countries.json (cards by present-day country)
#   web/public/data/listen.json    (recordings to listen to)
#   web/public/data/names.json     (every card's names, content/aliases.yaml)
#   web/public/data/factoids.json  (checked factoids only, content/factoids)
#   web/public/data/features*.json (special projects, content/features)
#   web/public/media/              (content/media)
# Content comes from content/ when it has chapters; otherwise from the
# placeholder set in web/fixtures/. Override with SANKOFA_CONTENT=<dir>.
set -eu
web=$(cd "$(dirname "$0")/.." && pwd)
root=$(cd "$web/.." && pwd)
cd "$root"

src=${SANKOFA_CONTENT:-}
if [ -z "$src" ]; then
  if ls content/chapters/*.md >/dev/null 2>&1; then src=content; else src=web/fixtures; fi
fi
echo "content: $src"

mkdir -p web/public/data web/public/media
cards="$src/cards"
# Roots come from <content>/roots next to the cards. Until the real collection
# has any artist, export the placeholder artists in web/fixtures/roots instead.
if ! ls "$src/roots"/*.yaml >/dev/null 2>&1 && [ "$src" != web/fixtures ]; then
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  ln -s "$root/$src/cards" "$tmp/cards"
  ln -s "$web/fixtures/roots" "$tmp/roots"
  cards="$tmp/cards"
  echo "roots: placeholders from web/fixtures/roots"
fi
go run ./cmd/sankofa content export "$cards" -o web/public/data/cards.json
# Short verified facts: only status "checked", validated against the cards;
# an empty list when the content has none.
go run ./cmd/sankofa content factoids "$src/factoids" --cards "$cards" -o web/public/data/factoids.json
# Present-day countries of the card places (content/countries.yaml).
node "$web/scripts/build-countries.ts" web/public/data/cards.json "$src/countries.yaml" web/public/data/countries.json
node "$web/scripts/build-chapters.ts" "$src/chapters" web/public/data/chapters.json
# Official recordings to listen to (content/listen.yaml); empty when absent.
node "$web/scripts/build-listen.ts" "$src/listen.yaml" web/public/data/listen.json
if [ -d "$src/media" ]; then
  cp -R "$src/media/." web/public/media/
fi
echo "media: $(ls web/public/media | wc -l | tr -d ' ') files"
node "$web/scripts/build-media.ts" web/public/media web/public/data/media.json
# Documents, working objects, how we checked, the guide and the dedication.
node "$web/scripts/build-mechanics.ts" "$src" web/public/data
# Special projects: scenes, bilingual text and their rivers, validated.
node "$web/scripts/build-features.ts" "$src" web/public/data
# The dictionary's names, for linking mentions of cards in the museum's own
# text, and the report of mentions still unlinked (dist/link-gaps.txt).
node "$web/scripts/build-names.ts" "$src" web/public/data web/index.html dist/link-gaps.txt
# The public, read-only visitor kubeconfig (hack/stand/visitor-kubeconfig.sh),
# offered in the engine room when the stand has produced one.
if [ -f dist/visitor.kubeconfig ]; then
  cp dist/visitor.kubeconfig web/public/visitor.kubeconfig
  # Readable by the unprivileged web server (the source is 0600).
  chmod 0644 web/public/visitor.kubeconfig
  echo "visitor kubeconfig: included"
fi
