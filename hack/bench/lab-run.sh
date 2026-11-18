#!/bin/sh
# Runs one CronJob herd arm on a fresh lab control plane (lab-controlplane.sh).
# Usage: lab-run.sh ARM N WINDOW_MIN [create options...]
# The schedule minute is three minutes after the CronJobs exist.
set -eu
ARM=$1 N=$2 WINDOW=$3; shift 3
HERE=$(cd "$(dirname "$0")" && pwd)
LAB=${LAB:-/work/lab}
OUT=$LAB/results/$ARM
mkdir -p "$OUT"
sh "$HERE/lab-controlplane.sh" down
sh "$HERE/lab-controlplane.sh" up "$LAB/bin" CronJobScheduleSpread=true
export PATH="$LAB/bin:$PATH"
B="python3 $HERE/cronjob_herd.py --kubeconfig $LAB/kubeconfig --context lab"
kubectl --kubeconfig "$LAB/kubeconfig" --context lab create namespace polyrhythm-bench
until kubectl --kubeconfig "$LAB/kubeconfig" --context lab -n polyrhythm-bench get serviceaccount default >/dev/null 2>&1; do sleep 1; done
start=$(date +%s)
M=$(( ( (start / 60) + 3 + 1 ) % 60 ))
$B sample --out "$OUT/samples.jsonl" --interval 2 --duration $(( (WINDOW + 7) * 60 )) \
  --extra etcd=http://127.0.0.1:12381/metrics --extra kcm=https://127.0.0.1:10357/metrics \
  --extra sched=https://127.0.0.1:10359/metrics &
SAMPLER=$!
$B create --n "$N" --schedule "$M * * * *" --arm "$ARM" --chunk 100 "$@" > "$OUT/create.json"
echo "{\"arm\":\"$ARM\",\"minute\":$M,\"start\":$start}" > "$OUT/run.json"
wait $SAMPLER
$B collect --out "$OUT/objects.json"
sh "$HERE/lab-controlplane.sh" down
