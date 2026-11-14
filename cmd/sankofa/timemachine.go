package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/pmezard/go-difflib/difflib"
	"github.com/spf13/cobra"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"sigs.k8s.io/yaml"

	"github.com/tym83/sankofa/pkg/history"
)

// when reads a moment: RFC3339, a duration back from now ("2h", "7d"), or
// "now". It returns RFC3339 with milliseconds, the store's resolution.
func when(s string) (string, error) {
	if s == "" || s == "now" {
		return time.Now().UTC().Format(time.RFC3339Nano), nil
	}
	if d, err := history.ParseDuration(s); err == nil {
		return time.Now().Add(-d).UTC().Format(time.RFC3339Nano), nil
	}
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t.UTC().Format(time.RFC3339Nano), nil
	}
	return "", fmt.Errorf("%q is not a moment: want RFC3339, a duration back from now (2h, 7d) or now", s)
}

func namespaceArg(arg string) (string, bool) {
	for _, p := range []string{"namespace/", "namespaces/", "ns/"} {
		if n, ok := strings.CutPrefix(arg, p); ok && n != "" {
			return n, true
		}
	}
	return "", false
}

// namespaceAt reads the namespace object and everything in it at a moment.
func namespaceAt(ctx context.Context, ns, at string) (*history.Record, []history.Record, error) {
	cfg, err := kubeFlags.ToRESTConfig()
	if err != nil {
		return nil, nil, err
	}
	kc, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return nil, nil, err
	}
	base := "/apis/" + history.Group + "/" + history.Version
	var recs []history.Record
	cont := ""
	for {
		req := kc.Discovery().RESTClient().Get().AbsPath(base+"/namespaces/"+ns+"/timelines").Param("at", at).Param("limit", "500")
		if cont != "" {
			req = req.Param("continue", cont)
		}
		raw, err := req.DoRaw(ctx)
		if err != nil {
			return nil, nil, err
		}
		var list history.TimelineList
		if err := json.Unmarshal(raw, &list); err != nil {
			return nil, nil, err
		}
		for _, tl := range list.Items {
			recs = append(recs, timelineRecord(tl))
		}
		if cont = list.Continue; cont == "" {
			break
		}
	}
	var nsRec *history.Record
	raw, err := kc.Discovery().RESTClient().Get().AbsPath(base+"/clustertimelines/"+history.TimelineName(history.Ref{Resource: "namespaces", Name: ns})).Param("at", at).DoRaw(ctx)
	switch {
	case err == nil:
		var tl history.Timeline
		if err := json.Unmarshal(raw, &tl); err != nil {
			return nil, nil, err
		}
		r := timelineRecord(tl)
		nsRec = &r
	case !apierrors.IsNotFound(err) && !apierrors.IsForbidden(err):
		return nil, nil, err
	}
	return nsRec, recs, nil
}

func timelineRecord(tl history.Timeline) history.Record {
	r := history.Record{Ref: tl.Target, Kind: tl.Kind, Object: tl.Object}
	if n := len(tl.Moments); n > 0 {
		m := tl.Moments[n-1]
		r.UID, r.Verb, r.At, r.Manager = m.UID, m.Verb, m.At, m.Manager
	}
	return r
}

func diffCmd() *cobra.Command {
	var from, to string
	var details bool
	c := &cobra.Command{
		Use:   "diff TYPE/NAME | namespace/NS --from T1 [--to T2]",
		Short: "What changed between two moments: one object, or a whole namespace",
		Long: `Compare an object, or every object of a namespace, between two moments.
Moments are RFC3339 or a duration back from now (2h, 7d); --to defaults to now.

  sankofa diff deployment/web --from 2h
  sankofa diff namespace/shop --from 2026-11-12T10:00:00Z --to 2026-11-12T11:00:00Z --details`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if from == "" {
				return fmt.Errorf("--from is required")
			}
			t1, err := when(from)
			if err != nil {
				return err
			}
			t2, err := when(to)
			if err != nil {
				return err
			}
			w := cmd.OutOrStdout()
			if ns, ok := namespaceArg(args[0]); ok {
				_, a, err := namespaceAt(cmd.Context(), ns, t1)
				if err != nil {
					return err
				}
				_, b, err := namespaceAt(cmd.Context(), ns, t2)
				if err != nil {
					return err
				}
				changes := history.DiffSets(a, b)
				counts := map[string]int{}
				for _, ch := range changes {
					counts[ch.Verb]++
					fmt.Fprintf(w, "%-8s %s/%s\n", ch.Verb, strings.ToLower(ch.Kind), ch.Ref.Name)
					if details && ch.Verb == "changed" {
						if err := unified(w, ch.Ref.String(), ch.From.Object, ch.To.Object); err != nil {
							return err
						}
					}
				}
				fmt.Fprintf(cmd.ErrOrStderr(), "namespace %s, %s → %s: %d created, %d changed, %d deleted\n", ns, t1, t2, counts["created"], counts["changed"], counts["deleted"])
				return nil
			}
			a, _, _, errA := timeline(cmd.Context(), args[0], t1)
			b, _, _, errB := timeline(cmd.Context(), args[0], t2)
			var oa, ob json.RawMessage
			switch {
			case errA != nil && errB != nil:
				return errB
			case errA != nil:
				fmt.Fprintf(cmd.ErrOrStderr(), "%s did not exist at %s\n", args[0], t1)
				ob = b.Object
			case errB != nil:
				fmt.Fprintf(cmd.ErrOrStderr(), "%s did not exist at %s\n", args[0], t2)
				oa = a.Object
			default:
				oa, ob = a.Object, b.Object
			}
			return unified(w, args[0], oa, ob)
		},
	}
	c.Flags().StringVar(&from, "from", "", "first moment")
	c.Flags().StringVar(&to, "to", "now", "second moment")
	c.Flags().BoolVar(&details, "details", false, "namespace diff: print the change of every changed object")
	return c
}

func unified(w io.Writer, name string, a, b json.RawMessage) error {
	ya, err := asYAML(a)
	if err != nil {
		return err
	}
	yb, err := asYAML(b)
	if err != nil {
		return err
	}
	if ya == yb {
		fmt.Fprintf(w, "# %s: no change\n", name)
		return nil
	}
	return difflib.WriteUnifiedDiff(w, difflib.UnifiedDiff{
		A: difflib.SplitLines(ya), B: difflib.SplitLines(yb),
		FromFile: name + " (from)", ToFile: name + " (to)", Context: 3,
	})
}

func asYAML(raw json.RawMessage) (string, error) {
	if len(raw) == 0 {
		return "", nil
	}
	var o map[string]any
	if err := json.Unmarshal(raw, &o); err != nil {
		return "", err
	}
	if md, ok := o["metadata"].(map[string]any); ok {
		delete(md, "resourceVersion")
		delete(md, "generation")
	}
	b, err := yaml.Marshal(o)
	return string(b), err
}

type nsFetch struct {
	at, outDir   string
	apply, force bool
}

// fetchNamespace restores a namespace as it was: manifests by default, applied
// only with --apply and only after a server-side dry run of all of them.
func fetchNamespace(cmd *cobra.Command, ns string, o nsFetch) error {
	ctx := cmd.Context()
	at, err := when(o.at)
	if err != nil {
		return err
	}
	nsRec, recs, err := namespaceAt(ctx, ns, at)
	if err != nil {
		return err
	}
	if nsRec == nil && len(recs) == 0 {
		return fmt.Errorf("griot remembers nothing in namespace %s at %s", ns, at)
	}
	if nsRec != nil {
		recs = append([]history.Record{*nsRec}, recs...)
	}
	plan, err := history.PlanRestore(recs, o.force)
	if err != nil {
		return err
	}
	report := cmd.ErrOrStderr()
	cfg, err := kubeFlags.ToRESTConfig()
	if err != nil {
		return err
	}
	dc, err := dynamic.NewForConfig(cfg)
	if err != nil {
		return err
	}
	mapper, err := kubeFlags.ToRESTMapper()
	if err != nil {
		return err
	}
	res := func(u *unstructured.Unstructured) (dynamic.ResourceInterface, error) {
		gvk := u.GroupVersionKind()
		m, err := mapper.RESTMapping(gvk.GroupKind(), gvk.Version)
		if err != nil {
			return nil, err
		}
		if m.Scope.Name() == meta.RESTScopeNameNamespace {
			return dc.Resource(m.Resource).Namespace(u.GetNamespace()), nil
		}
		return dc.Resource(m.Resource), nil
	}

	fmt.Fprintf(report, "# namespace %s as it was at %s\n", ns, at)
	if err := writeManifests(cmd.OutOrStdout(), o.outDir, plan.Objects); err != nil {
		return err
	}
	for _, u := range plan.Objects {
		state := "?"
		if ri, err := res(u); err != nil {
			state = "unknown kind: " + err.Error()
		} else if _, err := ri.Get(ctx, u.GetName(), metav1.GetOptions{}); err == nil {
			state = "exists, would be updated"
		} else if apierrors.IsNotFound(err) {
			state = "missing, would be created"
		} else {
			state = err.Error()
		}
		fmt.Fprintf(report, "  restore  %-24s %-40s %s\n", u.GetKind(), u.GetName(), state)
	}
	for _, s := range plan.Managed {
		verb := "managed"
		if o.force {
			verb = "forced"
		}
		fmt.Fprintf(report, "  %-7s  %-24s %-40s %s\n", verb, s.Kind, s.Ref.Name, s.Reason)
	}
	for _, s := range plan.Skipped {
		fmt.Fprintf(report, "  skip     %-24s %-40s %s\n", s.Kind, s.Ref.Name, s.Reason)
	}
	fmt.Fprintf(report, "# %d to restore, %d managed by Helm/GitOps%s, %d skipped\n", len(plan.Objects), len(plan.Managed), map[bool]string{true: " (included: --force)", false: " (left out; --force includes them)"}[o.force], len(plan.Skipped))
	if !o.apply {
		fmt.Fprintln(report, "# nothing applied; --apply restores after a server-side dry run")
		return nil
	}
	return applyAll(ctx, report, plan.Objects, res)
}

func writeManifests(stdout io.Writer, dir string, objs []*unstructured.Unstructured) error {
	if dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	for i, u := range objs {
		b, err := yaml.Marshal(u.Object)
		if err != nil {
			return err
		}
		if dir == "" {
			fmt.Fprintf(stdout, "---\n%s", b)
			continue
		}
		name := fmt.Sprintf("%03d-%s-%s.yaml", i, strings.ToLower(u.GetKind()), u.GetName())
		if err := os.WriteFile(filepath.Join(dir, name), b, 0o644); err != nil {
			return err
		}
	}
	return nil
}

// applyAll dry-runs every manifest on the server, stops on any refusal, then
// applies them in order. A namespace that does not exist yet is created first,
// since nothing inside it can be dry-run before it exists.
func applyAll(ctx context.Context, report io.Writer, objs []*unstructured.Unstructured, res func(*unstructured.Unstructured) (dynamic.ResourceInterface, error)) error {
	force := true
	patch := func(u *unstructured.Unstructured, dry bool) error {
		ri, err := res(u)
		if err != nil {
			return err
		}
		ann := u.GetAnnotations()
		if ann == nil {
			ann = map[string]string{}
		}
		ann["sankofa.kuberoot.dev/fetched-at"] = time.Now().UTC().Format(time.RFC3339)
		u.SetAnnotations(ann)
		data, err := json.Marshal(u.Object)
		if err != nil {
			return err
		}
		opts := metav1.PatchOptions{FieldManager: "sankofa-fetch", Force: &force}
		if dry {
			opts.DryRun = []string{metav1.DryRunAll}
		}
		_, err = ri.Patch(ctx, u.GetName(), types.ApplyPatchType, data, opts)
		return err
	}
	dryRun := func(list []*unstructured.Unstructured) (failed int, nsMissing bool) {
		for _, u := range list {
			if err := patch(u, true); err != nil {
				if apierrors.IsNotFound(err) && u.GetNamespace() != "" {
					nsMissing = true
				}
				failed++
				fmt.Fprintf(report, "  dry-run refused %s/%s: %v\n", u.GetKind(), u.GetName(), err)
			}
		}
		return failed, nsMissing
	}
	failed, nsMissing := dryRun(objs)
	if failed > 0 && nsMissing && len(objs) > 0 && objs[0].GetKind() == "Namespace" {
		fmt.Fprintf(report, "# namespace %s does not exist: creating it, then dry-running the rest again\n", objs[0].GetName())
		if err := patch(objs[0], false); err != nil {
			return err
		}
		failed, _ = dryRun(objs[1:])
	}
	if failed > 0 {
		return fmt.Errorf("server-side dry run refused %d objects: nothing (else) applied", failed)
	}
	for _, u := range objs {
		if err := patch(u, false); err != nil {
			return fmt.Errorf("%s/%s: %w (objects before it are applied)", u.GetKind(), u.GetName(), err)
		}
	}
	fmt.Fprintf(report, "# applied %d objects. Sankofa: go back and fetch it.\n", len(objs))
	return nil
}
