package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/spf13/cobra"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"sigs.k8s.io/yaml"

	"github.com/sankofa-media/sankofa/pkg/history"
)

// target resolves "deployment/web" or "deployments.apps/web" to a resource.
func target(arg string) (schema.GroupVersionResource, string, bool, error) {
	kind, name, ok := strings.Cut(arg, "/")
	if !ok || name == "" {
		return schema.GroupVersionResource{}, "", false, fmt.Errorf("want TYPE/NAME, e.g. deployment/web")
	}
	mapper, err := kubeFlags.ToRESTMapper()
	if err != nil {
		return schema.GroupVersionResource{}, "", false, err
	}
	gvr, err := mapper.ResourceFor(schema.ParseGroupResource(kind).WithVersion(""))
	if err != nil {
		return schema.GroupVersionResource{}, "", false, err
	}
	gvk, err := mapper.KindFor(gvr)
	if err != nil {
		return schema.GroupVersionResource{}, "", false, err
	}
	m, err := mapper.RESTMapping(gvk.GroupKind(), gvk.Version)
	if err != nil {
		return schema.GroupVersionResource{}, "", false, err
	}
	return gvr, name, m.Scope.Name() == meta.RESTScopeNameNamespace, nil
}

func namespace() string {
	ns, _, _ := kubeFlags.ToRawKubeConfigLoader().Namespace()
	if ns == "" {
		ns = "default"
	}
	return ns
}

func timeline(ctx context.Context, arg, at string) (*history.Timeline, schema.GroupVersionResource, string, error) {
	gvr, name, namespaced, err := target(arg)
	if err != nil {
		return nil, gvr, "", err
	}
	cfg, err := kubeFlags.ToRESTConfig()
	if err != nil {
		return nil, gvr, "", err
	}
	kc, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return nil, gvr, "", err
	}
	ref := history.Ref{Group: gvr.Group, Resource: gvr.Resource, Name: name}
	path := "/apis/" + history.Group + "/" + history.Version + "/clustertimelines/" + history.TimelineName(ref)
	ns := ""
	if namespaced {
		ns = namespace()
		path = "/apis/" + history.Group + "/" + history.Version + "/namespaces/" + ns + "/timelines/" + history.TimelineName(ref)
	}
	req := kc.Discovery().RESTClient().Get().AbsPath(path)
	if at != "" {
		req = req.Param("at", at)
	}
	raw, err := req.DoRaw(ctx)
	if err != nil {
		if apierrors.IsNotFound(err) {
			return nil, gvr, ns, fmt.Errorf("griot has no memory of %s: %w", arg, err)
		}
		return nil, gvr, ns, err
	}
	var tl history.Timeline
	if err := json.Unmarshal(raw, &tl); err != nil {
		return nil, gvr, ns, err
	}
	return &tl, gvr, ns, nil
}

func tellCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "tell TYPE/NAME",
		Short: "Tell the life story of an object, even after it is gone",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			tl, _, _, err := timeline(cmd.Context(), args[0], "")
			if err != nil {
				return err
			}
			w := cmd.OutOrStdout()
			fmt.Fprintln(w, wrap(tl.Story, 78))
			fmt.Fprintln(w)
			if tl.Records > len(tl.Moments) {
				fmt.Fprintf(w, "  (the latest %d of %d moments)\n", len(tl.Moments), tl.Records)
			}
			for _, m := range tl.Moments {
				who := m.Manager
				if who == "" {
					who = "-"
				}
				if m.User != "" {
					who += " (" + m.User + ")"
				}
				fmt.Fprintf(w, "  %s  %-7s  %s\n", m.At.Local().Format("2006-01-02 15:04:05"), m.Verb, who)
			}
			return nil
		},
	}
}

func fetchCmd() *cobra.Command {
	var at, outDir string
	var dry, apply, force bool
	c := &cobra.Command{
		Use:   "fetch TYPE/NAME | namespace/NS",
		Short: "Sankofa: go back and fetch it. Restore an object or a namespace from the cluster memory",
		Long: `Restore one object as it was at --at (RFC3339 or a duration like 2h meaning
"two hours ago"), or as it was last seen alive. Status, UID and owner
references are not restored: the object is born again.

With namespace/NS, print the manifests of the whole namespace as it was at
--at, in creation order, and a report on stderr: objects owned by controllers
(ReplicaSets, Pods, Jobs of CronJobs...) are left to their controllers,
Secrets are left out (their values are never kept), objects of Helm, Argo CD
or Flux are left out unless --force. --apply restores them, after a
server-side dry run of every manifest.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if ns, ok := namespaceArg(args[0]); ok {
				if at == "" {
					return fmt.Errorf("namespace/%s needs --at", ns)
				}
				return fetchNamespace(cmd, ns, nsFetch{at: at, outDir: outDir, apply: apply, force: force})
			}
			ts := ""
			if at != "" {
				var err error
				if ts, err = when(at); err != nil {
					return err
				}
			}
			tl, gvr, ns, err := timeline(cmd.Context(), args[0], ts)
			if err != nil {
				return err
			}
			u := &unstructured.Unstructured{}
			if err := json.Unmarshal(tl.Object, &u.Object); err != nil {
				return err
			}
			if reason := history.SkipReason(u); reason != "" {
				return fmt.Errorf("%s is not restored from memory: %s", args[0], reason)
			}
			if o, ok := history.ControllerOf(u); ok && !force {
				return fmt.Errorf("%s was owned by %s, which recreates it; restore the owner, or --force", args[0], o)
			}
			if o, ok := history.ManagerOf(u); ok && !force {
				return fmt.Errorf("%s is managed by %s; restore it through that, or --force", args[0], o)
			}
			reborn(u)
			if dry {
				out, _ := yaml.Marshal(u.Object)
				_, err := cmd.OutOrStdout().Write(out)
				return err
			}
			cfg, err := kubeFlags.ToRESTConfig()
			if err != nil {
				return err
			}
			dc, err := dynamic.NewForConfig(cfg)
			if err != nil {
				return err
			}
			var ri dynamic.ResourceInterface = dc.Resource(gvr)
			if ns != "" {
				ri = dc.Resource(gvr).Namespace(ns)
			}
			data, _ := json.Marshal(u.Object)
			force := true
			if _, err := ri.Patch(cmd.Context(), u.GetName(), types.ApplyPatchType, data, metav1.PatchOptions{FieldManager: "sankofa-fetch", Force: &force}); err != nil {
				return err
			}
			from := "as last seen alive"
			if ts != "" {
				from = "as it was at " + ts
			}
			fmt.Fprintf(cmd.OutOrStdout(), "%s fetched back, %s. Sankofa: go back and fetch it.\n", args[0], from)
			return nil
		},
	}
	c.Flags().StringVar(&at, "at", "", "point in time: RFC3339, or a duration back from now (e.g. 2h, 7d)")
	c.Flags().BoolVar(&dry, "dry-run", false, "one object: print it instead of restoring it")
	c.Flags().StringVar(&outDir, "out-dir", "", "namespace: write one manifest per file into this directory instead of stdout")
	c.Flags().BoolVar(&apply, "apply", false, "namespace: apply the manifests after a server-side dry run")
	c.Flags().BoolVar(&force, "force", false, "include objects managed by Helm, Argo CD or Flux, or owned by a controller")
	return c
}

// reborn strips what belongs to a past life.
func reborn(u *unstructured.Unstructured) {
	history.Reborn(u)
	ann := u.GetAnnotations()
	if ann == nil {
		ann = map[string]string{}
	}
	ann["sankofa.kuberoot.dev/fetched-at"] = time.Now().UTC().Format(time.RFC3339)
	u.SetAnnotations(ann)
}

func obituariesCmd() *cobra.Command {
	var all bool
	c := &cobra.Command{
		Use:   "obituaries",
		Short: "Who died lately: deleted objects Griot still remembers",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := kubeFlags.ToRESTConfig()
			if err != nil {
				return err
			}
			kc, err := kubernetes.NewForConfig(cfg)
			if err != nil {
				return err
			}
			p := "/apis/" + history.Group + "/" + history.Version + "/namespaces/" + namespace() + "/timelines"
			if all {
				p = "/apis/" + history.Group + "/" + history.Version + "/timelines"
			}
			raw, err := kc.Discovery().RESTClient().Get().AbsPath(p).DoRaw(cmd.Context())
			if err != nil {
				return err
			}
			var list history.TimelineList
			if err := json.Unmarshal(raw, &list); err != nil {
				return err
			}
			for _, t := range list.Items {
				m := t.Moments[len(t.Moments)-1]
				fmt.Fprintf(cmd.OutOrStdout(), "%s  %-12s %s/%s\n", m.At.Local().Format("2006-01-02 15:04"), t.Kind, t.Namespace, t.Target.Name)
			}
			if len(list.Items) == 0 {
				fmt.Fprintln(cmd.OutOrStdout(), "No one died. Or no one is remembered yet.")
			}
			return nil
		},
	}
	c.Flags().BoolVarP(&all, "all-namespaces", "A", false, "in all namespaces")
	return c
}
