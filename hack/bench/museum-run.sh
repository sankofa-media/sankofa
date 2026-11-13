#!/bin/sh
# Museum measurements driven from the builder (the workstation may sleep).
# Usage: museum-run.sh base-again HHMM | hook
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
LAB=${LAB:-/work/lab}
OUT=$LAB/results/museum
mkdir -p "$OUT"
export PATH="$LAB/bin:$PATH"
KC="--kubeconfig $LAB/museum.kubeconfig --context kubernetes-super-admin@kubernetes-museum"
B="python3 $HERE/cronjob_herd.py $KC"
k() { kubectl $KC -n polyrhythm-bench "$@"; }
case $1 in
base-again)
  until [ "$(date -u +%H%M)" -ge "$2" ]; do sleep 10; done
  $B sample --out "$OUT/base.samples.jsonl" --interval 5 --duration 900
  $B collect --out "$OUT/base.objects.json"
  ;;
hook)
  k delete cronjobs --all --wait=true >/dev/null
  until [ "$(k get jobs,pods --no-headers 2>/dev/null | wc -l)" = 0 ]; do sleep 5; done
  $B sample --out "$OUT/hook.samples.jsonl" --interval 5 --duration 2100 &
  S=$!
  date -u +%s > "$OUT/hook.create-start"
  $B create --n 1000 --schedule "H/10 * * * *" --arm hook --chunk 50 > "$OUT/hook.create.json"
  date -u +%s > "$OUT/hook.create-end"
  wait $S
  $B collect --out "$OUT/hook.objects.json"
  ;;
esac
