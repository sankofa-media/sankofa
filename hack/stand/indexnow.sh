#!/usr/bin/env bash
# Tell IndexNow search engines (Bing, Yandex and others) which pages changed:
# every page whose sitemap <lastmod> differs from the sitemap served before
# the deploy, or that is new. Usage: indexnow.sh <old-sitemap.xml> <host>
set -euo pipefail
old=$1 host=$2
key_file=$(cd "$(dirname "$0")/../../web/public" && ls | grep -E '^[0-9a-f]{32}\.txt$' | head -1)
[ -n "$key_file" ] || { echo "indexnow: no key file in web/public" >&2; exit 0; }
key=${key_file%.txt}
pairs() { tr '<' '\n' | sed -n 's#^loc>\(.*\)#L \1#p; s#^lastmod>\(.*\)#M \1#p' | awk '$1=="L"{if(u)print u, m; u=$2; m=""} $1=="M"{m=$2} END{if(u)print u, m}'; }
new=$(mktemp)
trap 'rm -f "$new"' EXIT
curl -fsS "https://$host/sitemap.xml" -o "$new"
urls=$(comm -13 <(pairs <"$old" | sort) <(pairs <"$new" | sort) | cut -d' ' -f1 | sort -u)
n=$(printf '%s' "$urls" | grep -c . || true)
[ "$n" -gt 0 ] || { echo "indexnow: nothing changed" >&2; exit 0; }
body=$(printf '%s\n' "$urls" | head -10000 | jq -R . | jq -s --arg h "$host" --arg k "$key" '{host:$h,key:$k,keyLocation:"https://\($h)/\($k).txt",urlList:.}')
code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json; charset=utf-8' -d "$body" https://api.indexnow.org/indexnow)
echo "indexnow: $n changed page(s) sent, HTTP $code" >&2
