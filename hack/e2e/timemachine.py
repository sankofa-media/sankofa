#!/usr/bin/env python3
"""End-to-end tests of Griot as a time machine, on the benchmark control plane.

They run against the throwaway API of hack/griot-bench (vapi), where the
PostgreSQL Griot (two replicas, leader election) is registered as the
aggregated API, never against the museum:

    source hack/griot-bench/run.sh; vk get ns   # starts the port-forward
    TM_KUBECONFIG=$BENCH_CERTS/kubeconfig.local TM_SERVER=https://localhost:16443 \
      SANKOFA_CLI=./bin/sankofa python3 hack/e2e/timemachine.py

Each test fails when its mechanism is broken: a diff that misses a change, a
restore that brings back owned objects or Helm objects, a namespace list that
ignores RBAC, a failover that stops recording.
"""
import json
import os
import subprocess
import time
import uuid

CONFIG = os.environ['TM_KUBECONFIG']
SERVER = os.environ.get('TM_SERVER', '')
MUSEUM = ['--kubeconfig', os.path.expanduser(os.environ.get('MUSEUM_KUBECONFIG', '~/.sankofa-stand/museum.kubeconfig')),
          '--context', os.environ.get('MUSEUM_CONTEXT', 'kubernetes-super-admin@kubernetes-museum')]
CLI = os.environ.get('SANKOFA_CLI', 'sankofa')
NS = 'tm-' + uuid.uuid4().hex[:6]


def run(binary, args, data=None, check=True):
    conn = ['--kubeconfig', CONFIG, '--context', 'bench'] + (['--server', SERVER] if SERVER else [])
    p = subprocess.run([binary, *conn, *args], input=data, text=True, capture_output=True, timeout=180)
    if check and p.returncode:
        raise RuntimeError(f'{binary} {args}: {p.stdout}\n{p.stderr}')
    return p


def k(*args, **kw):
    return run('kubectl', list(args), **kw)


def cli(*args, **kw):
    return run(CLI, list(args), **kw)


def apply(obj):
    k('apply', '-f', '-', data=json.dumps(obj))


def cm(name, data, labels=None, annotations=None):
    md = dict(name=name, namespace=NS, labels=labels or {}, annotations=annotations or {})
    return dict(apiVersion='v1', kind='ConfigMap', metadata=md, data=data)


def remembered(name, needle):
    p = k('get', '--raw', f'/apis/history.sankofa.kuberoot.dev/v1alpha1/namespaces/{NS}/timelines/configmaps.core:{name}', check=False)
    return p.returncode == 0 and needle in p.stdout


def eventually(fn, seconds=120):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if fn():
            return
        time.sleep(1)
    raise AssertionError(f'{fn.__name__ if hasattr(fn, "__name__") else fn} did not become true')


def now():
    # Records carry the managedFields time (whole seconds): step over the second.
    time.sleep(1.5)
    t = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    time.sleep(1.5)
    return t


def setup():
    k('create', 'namespace', NS)
    apply(cm('settings', {'mode': 'before'}))
    apply(cm('doomed', {'x': '1'}))
    apply(cm('chart-values', {'y': '1'}, labels={'app.kubernetes.io/managed-by': 'Helm'},
             annotations={'meta.helm.sh/release-name': 'shop', 'meta.helm.sh/release-namespace': NS}))
    apply(dict(apiVersion='v1', kind='Secret', metadata=dict(name='db', namespace=NS), stringData={'password': 'hunter2'}))
    apply(dict(apiVersion='apps/v1', kind='Deployment', metadata=dict(name='web', namespace=NS), spec=dict(
        replicas=1, selector={'matchLabels': {'app': 'web'}},
        template={'metadata': {'labels': {'app': 'web'}}, 'spec': {'containers': [{'name': 'app', 'image': 'registry.k8s.io/pause:3.10'}]}})))
    eventually(lambda: remembered('doomed', '"x":"1"'))
    eventually(lambda: '"ReplicaSet"' in k('get', '--raw', f'/apis/history.sankofa.kuberoot.dev/v1alpha1/namespaces/{NS}/timelines?at={time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 5))}').stdout)


def test_diff_namespace():
    t1 = now()
    apply(cm('settings', {'mode': 'after'}))
    k('delete', 'configmap', 'doomed', '-n', NS)
    apply(cm('newcomer', {'z': '1'}))
    eventually(lambda: remembered('newcomer', '"z":"1"') and remembered('settings', 'after'))
    eventually(lambda: '"died"' in k('get', '--raw', f'/apis/history.sankofa.kuberoot.dev/v1alpha1/namespaces/{NS}/timelines/configmaps.core:doomed').stdout)
    t2 = now()
    out = cli('diff', f'namespace/{NS}', '--from', t1, '--to', t2).stdout.splitlines()
    assert 'changed  configmap/settings' in out, out
    assert 'deleted  configmap/doomed' in out, out
    assert 'created  configmap/newcomer' in out, out
    assert not any('chart-values' in line or 'deployment/web' in line for line in out), f'unchanged objects reported: {out}'
    one = cli('diff', 'configmap/settings', '-n', NS, '--from', t1, '--to', t2).stdout
    assert '-  mode: before' in one and '+  mode: after' in one, one
    return t2


def test_fetch_namespace(t2):
    k('delete', 'namespace', NS, '--wait=true', '--timeout=120s')
    p = cli('fetch', f'namespace/{NS}', '--at', t2)
    docs = [d for d in p.stdout.split('---\n') if d.strip()]
    kinds = [next(l.split(': ')[1] for l in d.splitlines() if l.startswith('kind: ')) for d in docs]
    assert kinds[0] == 'Namespace', kinds
    assert kinds.index('ConfigMap') < kinds.index('Deployment'), kinds
    assert 'ReplicaSet' not in kinds and 'Pod' not in kinds and 'Secret' not in kinds, kinds
    assert 'chart-values' not in p.stdout, 'Helm object restored without --force'
    assert 'doomed' not in p.stdout, 'object deleted before the moment came back'
    assert 'uid:' not in p.stdout and 'resourceVersion' not in p.stdout, 'server fields kept'
    assert 'managed by Helm release' in p.stderr and 'owned by Deployment web' in p.stderr, p.stderr
    assert 'secret values are never kept' in p.stderr, p.stderr
    assert k('get', 'namespace', NS, check=False).returncode != 0, 'fetch without --apply changed the cluster'
    p = cli('fetch', f'namespace/{NS}', '--at', t2, '--apply')
    assert 'applied' in p.stderr, p.stderr
    got = json.loads(k('get', 'configmap', 'settings', '-n', NS, '-o', 'json').stdout)
    assert got['data'] == {'mode': 'after'}, got['data']
    k('get', 'deployment', 'web', '-n', NS)
    assert k('get', 'configmap', 'chart-values', '-n', NS, check=False).returncode != 0, 'Helm object applied'
    eventually(lambda: k('get', 'replicasets', '-n', NS, '-o', 'name').stdout.strip() != '')


def test_fetch_refuses_dry_run_failure():
    # A manifest the server refuses stops the whole restore before anything is applied.
    bad = NS + '-bad'
    k('create', 'namespace', bad)
    apply(dict(apiVersion='v1', kind='Service', metadata=dict(name='svc', namespace=bad), spec=dict(ports=[{'port': 80}])))
    apply(dict(apiVersion='v1', kind='ConfigMap', metadata=dict(name='first', namespace=bad), data={'a': '1'}))
    eventually(lambda: '"Service"' in k('get', '--raw', f'/apis/history.sankofa.kuberoot.dev/v1alpha1/namespaces/{bad}/timelines?at={time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 5))}').stdout)
    t = now()
    k('delete', 'configmap', 'first', '-n', bad)
    # A quota that forbids services makes the dry run of the Service fail.
    apply(dict(apiVersion='v1', kind='ResourceQuota', metadata=dict(name='no-services', namespace=bad), spec={'hard': {'services': '0'}}))
    k('delete', 'service', 'svc', '-n', bad)
    p = cli('fetch', f'namespace/{bad}', '--at', t, '--apply', check=False)
    assert p.returncode != 0 and 'dry-run refused' in p.stderr, p.stderr
    assert k('get', 'configmap', 'first', '-n', bad, check=False).returncode != 0, 'applied despite a refused dry run'
    k('delete', 'namespace', bad, '--wait=false')


def test_namespace_list_follows_rbac():
    user = NS + '-reader'
    at = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() + 5))
    path = f'/apis/history.sankofa.kuberoot.dev/v1alpha1/namespaces/{NS}/timelines?at={at}'
    apply(dict(apiVersion='rbac.authorization.k8s.io/v1', kind='ClusterRoleBinding', metadata=dict(name=user),
               roleRef=dict(apiGroup='rbac.authorization.k8s.io', kind='ClusterRole', name='griot-e2e-memory'),
               subjects=[dict(kind='User', name=user)]))
    apply(dict(apiVersion='rbac.authorization.k8s.io/v1', kind='ClusterRole', metadata=dict(name='griot-e2e-memory'),
               rules=[dict(apiGroups=['history.sankofa.kuberoot.dev'], resources=['timelines'], verbs=['get', 'list'])]))
    items = json.loads(k('get', '--raw', path, '--as', user).stdout)['items']
    assert items == [], f'user without rights sees {len(items)} objects'
    apply(dict(apiVersion='rbac.authorization.k8s.io/v1', kind='Role', metadata=dict(name='cm-only', namespace=NS),
               rules=[dict(apiGroups=[''], resources=['configmaps'], verbs=['get'])]))
    apply(dict(apiVersion='rbac.authorization.k8s.io/v1', kind='RoleBinding', metadata=dict(name='cm-only', namespace=NS),
               roleRef=dict(apiGroup='rbac.authorization.k8s.io', kind='Role', name='cm-only'), subjects=[dict(kind='User', name=user)]))
    items = json.loads(k('get', '--raw', path, '--as', user).stdout)['items']
    kinds = {i['targetKind'] for i in items}
    assert kinds == {'ConfigMap'}, kinds
    k('delete', 'clusterrolebinding', user)
    k('delete', 'clusterrole', 'griot-e2e-memory')


def test_failover_keeps_recording():
    lease = lambda: json.loads(k('get', 'lease', 'griot-recorder', '-n', 'default', '-o', 'json').stdout)['spec']['holderIdentity']
    leader = lease()
    subprocess.run(['kubectl', *MUSEUM, '-n', 'griot-bench', 'delete', 'pod', leader, '--wait=false'], check=True, capture_output=True)
    eventually(lambda: lease() != leader, 60)
    apply(cm('after-failover', {'a': '1'}))
    eventually(lambda: remembered('after-failover', '"a":"1"'), 60)


if __name__ == '__main__':
    results = []
    try:
        setup()
        t2 = test_diff_namespace()
        for name, fn in [('fetch_namespace', lambda: test_fetch_namespace(t2)), ('fetch_refuses_dry_run_failure', test_fetch_refuses_dry_run_failure),
                         ('namespace_list_follows_rbac', test_namespace_list_follows_rbac), ('failover_keeps_recording', test_failover_keeps_recording)]:
            start = time.monotonic()
            fn()
            print(json.dumps(dict(test=name, status='passed', seconds=round(time.monotonic() - start, 1))), flush=True)
        print(json.dumps(dict(test='diff_namespace', status='passed')))
    finally:
        k('delete', 'namespace', NS, '--wait=false', '--ignore-not-found', check=False)
