#!/usr/bin/env python3
"""Measure the CronJob thundering herd on a cluster.

Subcommands (all kubectl calls take --kubeconfig/--context explicitly):
  create   N CronJobs in one namespace, all with the same schedule
  sample   scrape kube-apiserver /metrics every INTERVAL seconds into JSONL
  collect  dump Job/Pod timestamps of the namespace into JSON
  suspend  suspend every CronJob of the namespace
  report   summarise one arm from its samples and objects

Job pods carry a nodeSelector that matches no node by default (--unschedulable),
so a run loads the control plane (API server, storage, controllers, scheduler)
without placing pods on nodes or triggering a cluster autoscaler.
"""
import argparse, json, re, ssl, subprocess, sys, time, urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone


def kubectl(a, *args, data=None, check=True):
    cmd = ["kubectl", "--kubeconfig", a.kubeconfig, "--context", a.context, *args]
    r = subprocess.run(cmd, input=data, capture_output=True, text=True)
    if check and r.returncode:
        sys.exit(f"{' '.join(cmd)}: {r.stderr}")
    return r


def fnv32a(data):
    h = 0x811C9DC5
    for b in data.encode():
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return h


def cronjob(a, i):
    name = f"{a.arm}-{i:04d}"
    schedule = a.schedule
    if a.hash_minutes:
        # What a minute-granular spread (Jenkins H, Sankofa's webhook) produces:
        # the minute moves by a hash of namespace/name within a window.
        minute, rest = schedule.split(" ", 1)
        schedule = f"{(int(minute) + fnv32a(f'{a.namespace}/{name}') % a.hash_minutes) % 60} {rest}"
    spec = {
        "schedule": schedule,
        "concurrencyPolicy": "Forbid",
        "successfulJobsHistoryLimit": 1,
        "failedJobsHistoryLimit": 1,
        "jobTemplate": {"spec": {
            "backoffLimit": 0,
            "template": {"metadata": {"labels": {"bench": a.arm}}, "spec": {
                "restartPolicy": "Never",
                "terminationGracePeriodSeconds": 0,
                "containers": [{"name": "beat", "image": a.image, "command": ["true"],
                                "resources": {"requests": {"cpu": "1m", "memory": "8Mi"}}}],
            }},
        }},
    }
    if a.unschedulable:
        spec["jobTemplate"]["spec"]["template"]["spec"]["nodeSelector"] = {"bench.sankofa.kuberoot.dev/none": "true"}
    if a.spread:
        spec["scheduleSpread"] = {"maxDelaySeconds": a.spread}
    return {"apiVersion": "batch/v1", "kind": "CronJob",
            "metadata": {"name": name, "namespace": a.namespace, "labels": {"bench": a.arm}},
            "spec": spec}


def create(a):
    t0, failed = time.time(), 0
    for start in range(0, a.n, a.chunk):
        items = [cronjob(a, i) for i in range(start, min(a.n, start + a.chunk))]
        r = kubectl(a, "create", "-f", "-", data=json.dumps({"apiVersion": "v1", "kind": "List", "items": items}), check=False)
        failed += r.stderr.count("Error")
        if r.stderr:
            print(r.stderr.strip()[:300], file=sys.stderr)
        if a.rate:
            time.sleep(max(0, (start + a.chunk) / a.rate - (time.time() - t0)))
    print(json.dumps({"created": a.n - failed, "failed": failed, "seconds": round(time.time() - t0, 1)}))


KEEP = re.compile(r'^(apiserver_request_total|apiserver_request_duration_seconds_(bucket|count|sum)'
                  r'|etcd_request_duration_seconds_count|apiserver_current_inflight_requests'
                  r'|apiserver_flowcontrol_current_inqueue_requests|apiserver_flowcontrol_current_executing_requests'
                  r'|apiserver_storage_objects|process_cpu_seconds_total)\b')
RES = ('resource="jobs"', 'resource="pods"', 'resource="cronjobs"', 'resource="events"', 'resource="pods/binding"')


EXTRA = re.compile(r'^(etcd_mvcc_(put|delete|txn)_total|etcd_disk_wal_fsync_duration_seconds_count'
                   r'|etcd_server_proposals_committed_total|process_cpu_seconds_total'
                   r'|cronjob_controller_job_creation_skew_duration_seconds_(bucket|count|sum)'
                   r'|workqueue_depth\{name="(cronjob|job|job_orphan_pod)"'
                   r'|scheduler_pending_pods|scheduler_schedule_attempts_total)')


def scrape(url):
    ctx = ssl.create_default_context()
    ctx.check_hostname, ctx.verify_mode = False, ssl.CERT_NONE
    try:
        return urllib.request.urlopen(url, timeout=10, context=ctx).read().decode()
    except Exception:
        return ""


def sample(a):
    end = time.time() + a.duration
    with open(a.out, "a") as f:
        while time.time() < end:
            t = time.time()
            r = kubectl(a, "get", "--raw", "/metrics", check=False)
            series = {}
            for line in r.stdout.splitlines():
                if not KEEP.match(line):
                    continue
                name, _, val = line.rpartition(" ")
                if name.startswith(("apiserver_request_total", "apiserver_request_duration")) and not any(x in name for x in RES):
                    continue
                if name.startswith("apiserver_storage_objects") and not any(x in name for x in ('="jobs.batch"', '="pods"', '="cronjobs.batch"', '="events"')):
                    continue
                series[name] = float(val)
            for spec in a.extra:
                tag, _, url = spec.partition("=")
                for line in scrape(url).splitlines():
                    if EXTRA.match(line):
                        name, _, val = line.rpartition(" ")
                        series[f"{tag}:{name}"] = float(val)
            f.write(json.dumps({"t": t, "s": series}) + "\n")
            f.flush()
            time.sleep(max(0, a.interval - (time.time() - t)))


def collect(a):
    out = {}
    for kind in ("jobs", "pods", "cronjobs"):
        r = kubectl(a, "-n", a.namespace, "get", kind, "-o", "json")
        out[kind] = [{
            "name": o["metadata"]["name"],
            "created": o["metadata"]["creationTimestamp"],
            "schedule": o.get("spec", {}).get("schedule"),
            "scheduled": o["metadata"].get("annotations", {}).get("batch.kubernetes.io/cronjob-scheduled-timestamp"),
            "lastSchedule": o.get("status", {}).get("lastScheduleTime"),
            "podScheduled": next((c["lastTransitionTime"] for c in o.get("status", {}).get("conditions", []) if c["type"] == "PodScheduled"), None),
        } for o in json.loads(r.stdout)["items"]]
    json.dump(out, open(a.out, "w"))


def suspend(a):
    r = kubectl(a, "-n", a.namespace, "get", "cronjobs", "-o", "name")
    for name in r.stdout.split():
        kubectl(a, "-n", a.namespace, "patch", name, "--type=merge", "-p", '{"spec":{"suspend":true}}')


def ts(s):
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()


def quantile(buckets, q):
    """buckets: list of (le, cumulative delta count); linear interpolation like histogram_quantile."""
    buckets = sorted(buckets)
    total = buckets[-1][1] if buckets else 0
    if not total:
        return None
    rank, prev_le, prev_c = q * total, 0.0, 0.0
    for le, c in buckets:
        if c >= rank:
            if le == float("inf"):
                return prev_le
            return prev_le + (le - prev_le) * ((rank - prev_c) / max(c - prev_c, 1e-9))
        prev_le, prev_c = le, c
    return prev_le


def report(a):
    objs = json.load(open(a.objects))
    rows = [json.loads(l) for l in open(a.samples)]
    w0, w1 = a.window
    out = {}
    for kind in ("jobs", "pods"):
        sec = Counter(int(ts(o["created"])) for o in objs[kind] if w0 <= ts(o["created"]) < w1)
        mins = Counter(int(ts(o["created"])) // 60 for o in objs[kind] if w0 <= ts(o["created"]) < w1)
        out[kind] = {"count": sum(sec.values()), "peak_per_second": max(sec.values(), default=0),
                     "peak_per_minute": max(mins.values(), default=0),
                     "seconds_with_creations": len(sec)}
    lags = sorted(ts(j["created"]) - ts(j["scheduled"]) for j in objs["jobs"] if j["scheduled"] and w0 <= ts(j["created"]) < w1)
    if lags:
        out["job_creation_lag_seconds"] = {"p50": lags[len(lags) // 2], "p99": lags[int(len(lags) * 0.99) - 1 if len(lags) > 1 else 0], "max": lags[-1]}
    sched = sorted(ts(p["podScheduled"]) - ts(p["created"]) for p in objs["pods"] if p["podScheduled"] and w0 <= ts(p["created"]) < w1)
    if sched:
        out["pod_first_scheduling_attempt_seconds"] = {"p50": sched[len(sched) // 2], "max": sched[-1]}
    # API rates from counter deltas between consecutive samples inside the window.
    rows = [r for r in rows if w0 - a.interval <= r["t"] <= w1 + a.interval]
    peak_rate, peak_inflight, etcd_writes, req_total = defaultdict(float), 0, 0.0, defaultdict(float)
    peak_etcd = 0.0
    lat = defaultdict(lambda: defaultdict(float))
    for p, c in zip(rows, rows[1:]):
        dt = c["t"] - p["t"]
        per = defaultdict(float)
        ew = 0.0
        for k, v in c["s"].items():
            d = v - p["s"].get(k, v)
            if d < 0:
                continue
            if k.startswith("apiserver_request_total"):
                verb = re.search(r'verb="([A-Z]+)"', k).group(1)
                res = re.search(r'resource="([a-z/]+)"', k).group(1)
                sub = re.search(r'subresource="([a-z]*)"', k)
                key = f"{verb} {res}" + (f"/{sub.group(1)}" if sub and sub.group(1) else "")
                per[key] += d
                req_total[key] += d
            elif k.startswith("etcd_request_duration_seconds_count") and re.search(r'operation="(create|update|delete)"', k):
                ew += d
            elif k.startswith("apiserver_request_duration_seconds_bucket") and 'verb="POST"' in k:
                res = re.search(r'resource="([a-z/]+)"', k).group(1)
                le = re.search(r'le="([^"]+)"', k).group(1)
                lat[res][float(le)] += d
        for key, d in per.items():
            peak_rate[key] = max(peak_rate[key], d / dt)
        peak_etcd = max(peak_etcd, ew / dt)
        etcd_writes += ew
        peak_inflight = max(peak_inflight, sum(v for k, v in c["s"].items() if k.startswith("apiserver_flowcontrol_current_inqueue_requests")))
    out["api_peak_requests_per_second"] = {k: round(v, 1) for k, v in sorted(peak_rate.items()) if v >= 0.5}
    out["api_requests_in_window"] = {k: int(v) for k, v in sorted(req_total.items()) if v >= 1}
    out["storage_writes_in_window"] = int(etcd_writes)
    out["storage_peak_writes_per_second"] = round(peak_etcd, 1)
    out["apf_peak_inqueue_requests"] = peak_inflight
    for tag, metric in (("etcd", "etcd_mvcc_put_total"), ("etcd", "etcd_mvcc_txn_total"),
                        ("etcd", "etcd_disk_wal_fsync_duration_seconds_count")):
        key = f"{tag}:{metric}"
        vals = [(r["t"], r["s"][key]) for r in rows if key in r["s"]]
        if len(vals) > 1:
            out[f"{key}_in_window"] = int(vals[-1][1] - vals[0][1])
            out[f"{key}_peak_per_second"] = round(max((v2 - v1) / (t2 - t1) for (t1, v1), (t2, v2) in zip(vals, vals[1:])), 1)
    for name in ("process_cpu_seconds_total", "etcd:process_cpu_seconds_total", "kcm:process_cpu_seconds_total", "sched:process_cpu_seconds_total"):
        vals = [(r["t"], r["s"][name]) for r in rows if name in r["s"]]
        if len(vals) > 1:
            out[f"{name}_peak_cores"] = round(max((v2 - v1) / (t2 - t1) for (t1, v1), (t2, v2) in zip(vals, vals[1:])), 2)
            out[f"{name}_in_window"] = round(vals[-1][1] - vals[0][1], 1)
    for name in ('kcm:workqueue_depth{name="cronjob"}', 'kcm:workqueue_depth{name="job"}', "sched:scheduler_pending_pods{queue=\"unschedulable\"}", "sched:scheduler_pending_pods{queue=\"active\"}"):
        vals = [r["s"][name] for r in rows if name in r["s"]]
        if vals:
            out[f"{name}_peak"] = max(vals)
    skew = defaultdict(float)
    first = next((r for r in rows if any(k.startswith("kcm:cronjob_controller_job_creation_skew_duration_seconds_bucket") for k in r["s"])), None)
    if first:
        last = rows[-1]
        for k, v in last["s"].items():
            if k.startswith("kcm:cronjob_controller_job_creation_skew_duration_seconds_bucket"):
                skew[float(re.search(r'le="([^"]+)"', k).group(1))] = v - first["s"].get(k, 0)
        out["kcm_job_creation_skew_p50_p99_seconds"] = [quantile(list(skew.items()), 0.5), quantile(list(skew.items()), 0.99)]
    out["post_latency_p99_seconds"] = {r: quantile(list(b.items()), 0.99) for r, b in lat.items()}
    print(json.dumps(out, indent=1))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--kubeconfig", required=True)
    p.add_argument("--context", required=True)
    p.add_argument("--namespace", "-n", default="polyrhythm-bench")
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("create")
    c.add_argument("--n", type=int, default=1000)
    c.add_argument("--schedule", required=True)
    c.add_argument("--arm", required=True)
    c.add_argument("--spread", type=int, default=0, help="spec.scheduleSpread.maxDelaySeconds")
    c.add_argument("--hash-minutes", type=int, default=0, help="move the minute by fnv32a(ns/name) mod N")
    c.add_argument("--image", default="registry.k8s.io/pause:3.10")
    c.add_argument("--unschedulable", action=argparse.BooleanOptionalAction, default=True)
    c.add_argument("--chunk", type=int, default=50)
    c.add_argument("--rate", type=float, default=0, help="CronJobs per second while creating; 0 = unthrottled")
    s = sub.add_parser("sample")
    s.add_argument("--out", required=True)
    s.add_argument("--interval", type=float, default=5)
    s.add_argument("--duration", type=float, required=True)
    s.add_argument("--extra", action="append", default=[], metavar="TAG=URL",
                   help="also scrape this metrics URL (etcd, controller-manager, scheduler)")
    o = sub.add_parser("collect")
    o.add_argument("--out", required=True)
    sub.add_parser("suspend")
    r = sub.add_parser("report")
    r.add_argument("--samples", required=True)
    r.add_argument("--objects", required=True)
    r.add_argument("--window", type=float, nargs=2, required=True, metavar=("START", "END"))
    r.add_argument("--interval", type=float, default=5)
    a = p.parse_args()
    {"create": create, "sample": sample, "collect": collect, "suspend": suspend, "report": report}[a.cmd](a)


if __name__ == "__main__":
    main()
