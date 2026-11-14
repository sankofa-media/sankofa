package history

import (
	"encoding/json"
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func rec(t *testing.T, resource, kind, name, uid string, obj map[string]any) Record {
	t.Helper()
	md := map[string]any{"name": name, "namespace": "shop", "uid": uid, "resourceVersion": "7", "creationTimestamp": "2026-11-01T00:00:00Z"}
	for k, v := range obj["metadata"].(map[string]any) {
		md[k] = v
	}
	obj["metadata"] = md
	obj["kind"] = kind
	data, err := json.Marshal(obj)
	if err != nil {
		t.Fatal(err)
	}
	return Record{Ref: Ref{Resource: resource, Namespace: "shop", Name: name}, UID: uid, Kind: kind, Object: data}
}

func TestPlanRestoreOrdersAndSkips(t *testing.T) {
	yes := true
	recs := []Record{
		rec(t, "deployments", "Deployment", "web", "d1", map[string]any{"apiVersion": "apps/v1", "metadata": map[string]any{"annotations": map[string]any{"deployment.kubernetes.io/revision": "3"}}, "spec": map[string]any{"replicas": 2}}),
		rec(t, "replicasets", "ReplicaSet", "web-abc", "r1", map[string]any{"apiVersion": "apps/v1", "metadata": map[string]any{"ownerReferences": []any{map[string]any{"kind": "Deployment", "name": "web", "uid": "d1", "controller": yes, "apiVersion": "apps/v1"}}}}),
		rec(t, "pods", "Pod", "web-abc-1", "p1", map[string]any{"apiVersion": "v1", "metadata": map[string]any{"ownerReferences": []any{map[string]any{"kind": "ReplicaSet", "name": "web-abc", "uid": "r1", "controller": yes, "apiVersion": "apps/v1"}}}}),
		rec(t, "services", "Service", "web", "s1", map[string]any{"apiVersion": "v1", "metadata": map[string]any{}, "spec": map[string]any{"clusterIP": "10.0.0.7", "clusterIPs": []any{"10.0.0.7"}, "ports": []any{map[string]any{"port": 80}}}}),
		rec(t, "configmaps", "ConfigMap", "settings", "c1", map[string]any{"apiVersion": "v1", "metadata": map[string]any{}, "data": map[string]any{"a": "b"}}),
		rec(t, "configmaps", "ConfigMap", "kube-root-ca.crt", "c2", map[string]any{"apiVersion": "v1", "metadata": map[string]any{}}),
		rec(t, "secrets", "Secret", "db", "x1", map[string]any{"apiVersion": "v1", "metadata": map[string]any{}, "data": map[string]any{"p": "<redacted>"}}),
		rec(t, "serviceaccounts", "ServiceAccount", "default", "sa0", map[string]any{"apiVersion": "v1", "metadata": map[string]any{}}),
		rec(t, "serviceaccounts", "ServiceAccount", "app", "sa1", map[string]any{"apiVersion": "v1", "metadata": map[string]any{}, "secrets": []any{map[string]any{"name": "app-token"}}}),
		rec(t, "persistentvolumeclaims", "PersistentVolumeClaim", "data", "v1", map[string]any{"apiVersion": "v1", "metadata": map[string]any{"annotations": map[string]any{"pv.kubernetes.io/bind-completed": "yes"}}, "spec": map[string]any{"volumeName": "pvc-123"}}),
		rec(t, "widgets", "Widget", "w", "cr1", map[string]any{"apiVersion": "example.com/v1", "metadata": map[string]any{}}),
		rec(t, "configmaps", "ConfigMap", "chart-values", "h1", map[string]any{"apiVersion": "v1", "metadata": map[string]any{"labels": map[string]any{"app.kubernetes.io/managed-by": "Helm"}, "annotations": map[string]any{"meta.helm.sh/release-name": "shop", "meta.helm.sh/release-namespace": "shop"}}}),
		rec(t, "configmaps", "ConfigMap", "from-git", "g1", map[string]any{"apiVersion": "v1", "metadata": map[string]any{"annotations": map[string]any{"argocd.argoproj.io/tracking-id": "shop-app:/ConfigMap:shop/from-git"}}}),
		rec(t, "configmaps", "ConfigMap", "from-flux", "f1", map[string]any{"apiVersion": "v1", "metadata": map[string]any{"labels": map[string]any{"kustomize.toolkit.fluxcd.io/name": "apps", "kustomize.toolkit.fluxcd.io/namespace": "flux-system"}}}),
	}
	p, err := PlanRestore(recs, false)
	if err != nil {
		t.Fatal(err)
	}
	var order []string
	for _, u := range p.Objects {
		order = append(order, u.GetKind()+"/"+u.GetName())
	}
	if got := strings.Join(order, " "); got != "ServiceAccount/app ConfigMap/settings PersistentVolumeClaim/data Service/web Deployment/web Widget/w" {
		t.Fatalf("order: %s", got)
	}
	reasons := map[string]string{}
	for _, s := range append(p.Skipped, p.Managed...) {
		reasons[s.Kind+"/"+s.Ref.Name] = s.Reason
	}
	for k, want := range map[string]string{
		"ReplicaSet/web-abc":         "owned by Deployment web",
		"Pod/web-abc-1":              "owned by ReplicaSet web-abc",
		"Secret/db":                  "secret values are never kept",
		"ConfigMap/kube-root-ca.crt": "created by the cluster",
		"ServiceAccount/default":     "created by the cluster",
		"ConfigMap/chart-values":     "Helm release shop/shop",
		"ConfigMap/from-git":         "Argo CD application shop-app",
		"ConfigMap/from-flux":        "Flux Kustomization flux-system/apps",
	} {
		if !strings.Contains(reasons[k], want) {
			t.Errorf("%s: reason %q, want %q", k, reasons[k], want)
		}
	}
	if len(p.Managed) != 3 {
		t.Fatalf("managed %d", len(p.Managed))
	}
	for _, u := range p.Objects {
		md := u.Object["metadata"].(map[string]any)
		for _, f := range []string{"uid", "resourceVersion", "creationTimestamp", "ownerReferences"} {
			if _, ok := md[f]; ok {
				t.Errorf("%s/%s keeps metadata.%s", u.GetKind(), u.GetName(), f)
			}
		}
		if u.GetAnnotations()["deployment.kubernetes.io/revision"] != "" || u.GetAnnotations()["pv.kubernetes.io/bind-completed"] != "" {
			t.Errorf("%s keeps server annotations", u.GetName())
		}
	}
	svc := find(p.Objects, "Service")
	if _, ok, _ := unstructured.NestedString(svc.Object, "spec", "clusterIP"); ok {
		t.Error("service keeps its old cluster IP")
	}
	if _, ok, _ := unstructured.NestedString(find(p.Objects, "PersistentVolumeClaim").Object, "spec", "volumeName"); ok {
		t.Error("claim keeps its old volume")
	}
	if _, ok := find(p.Objects, "ServiceAccount").Object["secrets"]; ok {
		t.Error("service account keeps token secrets")
	}
	forced, _ := PlanRestore(recs, true)
	if len(forced.Objects) != len(p.Objects)+3 {
		t.Fatalf("force must include managed objects: %d", len(forced.Objects))
	}
}

func find(objs []*unstructured.Unstructured, kind string) *unstructured.Unstructured {
	for _, u := range objs {
		if u.GetKind() == kind {
			return u
		}
	}
	return nil
}

func TestDiffSets(t *testing.T) {
	a := rec(t, "configmaps", "ConfigMap", "a", "1", map[string]any{"metadata": map[string]any{}, "data": map[string]any{"v": "1"}})
	a2 := rec(t, "configmaps", "ConfigMap", "a", "1", map[string]any{"metadata": map[string]any{"resourceVersion": "99"}, "data": map[string]any{"v": "1"}})
	b := rec(t, "configmaps", "ConfigMap", "b", "2", map[string]any{"metadata": map[string]any{}, "data": map[string]any{"v": "1"}})
	b2 := rec(t, "configmaps", "ConfigMap", "b", "2", map[string]any{"metadata": map[string]any{}, "data": map[string]any{"v": "2"}})
	c := rec(t, "configmaps", "ConfigMap", "c", "3", map[string]any{"metadata": map[string]any{}})
	d := rec(t, "configmaps", "ConfigMap", "d", "4", map[string]any{"metadata": map[string]any{}})
	d2 := rec(t, "configmaps", "ConfigMap", "d", "5", map[string]any{"metadata": map[string]any{}})
	e := rec(t, "configmaps", "ConfigMap", "e", "6", map[string]any{"metadata": map[string]any{}})
	got := DiffSets([]Record{a, b, c, d}, []Record{a2, b2, d2, e})
	var s []string
	for _, ch := range got {
		s = append(s, ch.Verb+" "+ch.Ref.Name)
	}
	if strings.Join(s, ", ") != "changed b, deleted c, changed d, created e" {
		t.Fatalf("diff: %v", s)
	}
}
