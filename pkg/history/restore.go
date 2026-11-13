package history

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

// installOrder is the order objects are created in, dependencies first. It
// follows Helm's install order; kinds not listed (custom resources) go last.
var installOrder = []string{
	"Namespace", "NetworkPolicy", "ResourceQuota", "LimitRange", "PodSecurityPolicy",
	"PodDisruptionBudget", "ServiceAccount", "Secret", "SecretList", "ConfigMap",
	"StorageClass", "PersistentVolume", "PersistentVolumeClaim", "CustomResourceDefinition",
	"ClusterRole", "ClusterRoleList", "ClusterRoleBinding", "ClusterRoleBindingList",
	"Role", "RoleList", "RoleBinding", "RoleBindingList", "Service", "DaemonSet", "Pod",
	"ReplicationController", "ReplicaSet", "Deployment", "HorizontalPodAutoscaler",
	"StatefulSet", "Job", "CronJob", "IngressClass", "Ingress", "APIService",
	"MutatingWebhookConfiguration", "ValidatingWebhookConfiguration",
}

var orderOf = func() map[string]int {
	m := map[string]int{}
	for i, k := range installOrder {
		m[k] = i
	}
	return m
}()

// Order sorts objects for creation: by install order of their kind, then
// custom resources by kind, then by name.
func Order(objs []*unstructured.Unstructured) {
	rank := func(u *unstructured.Unstructured) int {
		if r, ok := orderOf[u.GetKind()]; ok {
			return r
		}
		return len(installOrder)
	}
	sort.SliceStable(objs, func(i, j int) bool {
		a, b := objs[i], objs[j]
		if ra, rb := rank(a), rank(b); ra != rb {
			return ra < rb
		}
		if a.GetKind() != b.GetKind() {
			return a.GetKind() < b.GetKind()
		}
		return a.GetName() < b.GetName()
	})
}

// Owner says who should restore an object instead of Griot.
type Owner struct {
	Tool string // Helm, Argo CD, Flux, or Kind/name of a controller
	Name string
}

func (o Owner) String() string {
	if o.Name == "" {
		return o.Tool
	}
	return o.Tool + " " + o.Name
}

// ControllerOf returns the controller owner reference, if any: ReplicaSets of
// Deployments, Pods of ReplicaSets, Jobs of CronJobs and so on. The controller
// recreates them; restoring them by hand would fight it.
func ControllerOf(u *unstructured.Unstructured) (Owner, bool) {
	for _, r := range u.GetOwnerReferences() {
		if r.Controller != nil && *r.Controller {
			return Owner{Tool: r.Kind, Name: r.Name}, true
		}
	}
	return Owner{}, false
}

// ManagerOf detects Helm, Argo CD and Flux by the labels and annotations they
// put on what they manage.
func ManagerOf(u *unstructured.Unstructured) (Owner, bool) {
	l, a := u.GetLabels(), u.GetAnnotations()
	switch {
	case a["argocd.argoproj.io/tracking-id"] != "":
		app, _, _ := strings.Cut(a["argocd.argoproj.io/tracking-id"], ":")
		return Owner{Tool: "Argo CD application", Name: app}, true
	case l["argocd.argoproj.io/instance"] != "":
		return Owner{Tool: "Argo CD application", Name: l["argocd.argoproj.io/instance"]}, true
	case l["helm.toolkit.fluxcd.io/name"] != "":
		return Owner{Tool: "Flux HelmRelease", Name: l["helm.toolkit.fluxcd.io/namespace"] + "/" + l["helm.toolkit.fluxcd.io/name"]}, true
	case l["kustomize.toolkit.fluxcd.io/name"] != "":
		return Owner{Tool: "Flux Kustomization", Name: l["kustomize.toolkit.fluxcd.io/namespace"] + "/" + l["kustomize.toolkit.fluxcd.io/name"]}, true
	case l["app.kubernetes.io/managed-by"] == "Helm" || a["meta.helm.sh/release-name"] != "":
		return Owner{Tool: "Helm release", Name: a["meta.helm.sh/release-namespace"] + "/" + a["meta.helm.sh/release-name"]}, true
	}
	return Owner{}, false
}

// skipReason says why an object is never restored from memory, or "".
func skipReason(u *unstructured.Unstructured) string {
	kind, name := u.GetKind(), u.GetName()
	switch {
	case kind == "Secret":
		if t, _, _ := unstructured.NestedString(u.Object, "type"); t == "kubernetes.io/service-account-token" || t == "helm.sh/release.v1" {
			return "created by the cluster or Helm"
		}
		return "secret values are never kept: restore it from your secret store"
	case kind == "ConfigMap" && name == "kube-root-ca.crt":
		return "created by the cluster in every namespace"
	case kind == "ServiceAccount" && name == "default":
		return "created by the cluster in every namespace"
	case kind == "Event" || kind == "Endpoints" || kind == "EndpointSlice" || kind == "Lease" || kind == "ControllerRevision":
		return "derived by the cluster"
	}
	return ""
}

// Plan is a namespace restore: what is restored and what is not, and why.
type Plan struct {
	Objects []*unstructured.Unstructured
	// Managed are objects of Helm or GitOps; restored only with Force.
	Managed []Skip
	Skipped []Skip
}

// Skip is an object left out of a restore.
type Skip struct {
	Ref    Ref
	Kind   string
	Reason string
}

// PlanRestore turns the records of a namespace at a moment into manifests in
// creation order. Owned objects are left to their controllers; Helm, Argo CD
// and Flux objects go to Managed unless force; server-populated fields are
// stripped.
func PlanRestore(recs []Record, force bool) (Plan, error) {
	var p Plan
	for _, r := range recs {
		u := &unstructured.Unstructured{}
		if err := json.Unmarshal(r.Object, &u.Object); err != nil {
			return p, fmt.Errorf("%s: %w", r.Ref, err)
		}
		if reason := skipReason(u); reason != "" {
			p.Skipped = append(p.Skipped, Skip{Ref: r.Ref, Kind: r.Kind, Reason: reason})
			continue
		}
		if o, ok := ControllerOf(u); ok {
			p.Skipped = append(p.Skipped, Skip{Ref: r.Ref, Kind: r.Kind, Reason: "owned by " + o.String() + ": its controller recreates it"})
			continue
		}
		if o, ok := ManagerOf(u); ok {
			s := Skip{Ref: r.Ref, Kind: r.Kind, Reason: "managed by " + o.String() + ": restore through it"}
			p.Managed = append(p.Managed, s)
			if !force {
				continue
			}
		}
		Reborn(u)
		p.Objects = append(p.Objects, u)
	}
	Order(p.Objects)
	return p, nil
}

// Reborn strips what belongs to a past life and what the server fills in, so
// the manifest applies cleanly to a cluster that may have moved on.
func Reborn(u *unstructured.Unstructured) {
	for _, f := range []string{"uid", "creationTimestamp", "generation", "deletionTimestamp", "deletionGracePeriodSeconds", "ownerReferences", "resourceVersion", "selfLink", "managedFields", "finalizers"} {
		unstructured.RemoveNestedField(u.Object, "metadata", f)
	}
	unstructured.RemoveNestedField(u.Object, "status")
	ann := u.GetAnnotations()
	for _, k := range []string{
		"kubectl.kubernetes.io/last-applied-configuration",
		"deployment.kubernetes.io/revision",
		"pv.kubernetes.io/bind-completed", "pv.kubernetes.io/bound-by-controller",
		"volume.beta.kubernetes.io/storage-provisioner", "volume.kubernetes.io/storage-provisioner",
		"volume.kubernetes.io/selected-node",
	} {
		delete(ann, k)
	}
	if len(ann) == 0 {
		ann = nil
	}
	u.SetAnnotations(ann)
	switch u.GetKind() {
	case "Service":
		// Cluster IPs and health check ports are allocated; asking for the old
		// ones fails when they were reused meanwhile.
		for _, f := range []string{"clusterIP", "clusterIPs", "healthCheckNodePort"} {
			unstructured.RemoveNestedField(u.Object, "spec", f)
		}
	case "PersistentVolumeClaim":
		unstructured.RemoveNestedField(u.Object, "spec", "volumeName")
	case "Job":
		if manual, _, _ := unstructured.NestedBool(u.Object, "spec", "manualSelector"); !manual {
			unstructured.RemoveNestedField(u.Object, "spec", "selector")
			for _, l := range []string{"controller-uid", "batch.kubernetes.io/controller-uid", "job-name", "batch.kubernetes.io/job-name"} {
				unstructured.RemoveNestedField(u.Object, "spec", "template", "metadata", "labels", l)
			}
		}
	case "ServiceAccount":
		unstructured.RemoveNestedField(u.Object, "secrets")
	case "Namespace":
		unstructured.RemoveNestedField(u.Object, "spec", "finalizers")
	}
}

// Change is one object that differs between two moments.
type Change struct {
	Verb string // created, changed, deleted
	Ref  Ref
	Kind string
	From *Record // nil when created
	To   *Record // nil when deleted
}

// DiffSets compares the states of a namespace at two moments. Objects are
// matched by reference (resource and name), so a delete and recreate under the
// same name between the moments is a change, as an operator sees it.
func DiffSets(from, to []Record) []Change {
	key := func(r Record) string { return r.Ref.String() }
	before := map[string]*Record{}
	for i := range from {
		before[key(from[i])] = &from[i]
	}
	var out []Change
	seen := map[string]bool{}
	for i := range to {
		r := &to[i]
		k := key(*r)
		seen[k] = true
		b, ok := before[k]
		switch {
		case !ok:
			out = append(out, Change{Verb: "created", Ref: r.Ref, Kind: r.Kind, To: r})
		case b.UID != r.UID || !sameState(b.Object, r.Object):
			out = append(out, Change{Verb: "changed", Ref: r.Ref, Kind: r.Kind, From: b, To: r})
		}
	}
	for k, b := range before {
		if !seen[k] {
			out = append(out, Change{Verb: "deleted", Ref: b.Ref, Kind: b.Kind, From: b})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Ref.String() != out[j].Ref.String() {
			return out[i].Ref.String() < out[j].Ref.String()
		}
		return out[i].Verb < out[j].Verb
	})
	return out
}

func sameState(a, b []byte) bool {
	var x, y map[string]any
	if json.Unmarshal(a, &x) != nil || json.Unmarshal(b, &y) != nil {
		return string(a) == string(b)
	}
	for _, m := range []map[string]any{x, y} {
		if md, ok := m["metadata"].(map[string]any); ok {
			delete(md, "resourceVersion")
		}
	}
	xa, _ := json.Marshal(x)
	ya, _ := json.Marshal(y)
	return string(xa) == string(ya)
}
