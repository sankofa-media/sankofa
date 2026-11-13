// Command griot is the keeper of memory. In West Africa a griot keeps the
// oral history of a people; this one keeps the cards of the dictionary in the
// cluster and remembers the life of every object, so that what was lost can be
// fetched back.
package main

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/pem"
	"flag"
	"fmt"
	"log/slog"
	"math/big"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"sigs.k8s.io/controller-runtime/pkg/client"

	"github.com/tym83/sankofa/api/v1alpha1"
	"github.com/tym83/sankofa/content"
	"github.com/tym83/sankofa/pkg/admission"
	"github.com/tym83/sankofa/pkg/card"
	"github.com/tym83/sankofa/pkg/credits"
	"github.com/tym83/sankofa/pkg/history"
	"github.com/tym83/sankofa/pkg/pulse"
)

const managedBy = "griot"

type options struct {
	kubeconfig, store, db, dsn, listen, apiService, host, register, pulse, metrics string
	tlsCert, tlsKey                                                              string
	sync, record, webhooks, compress                                             bool
	leaderElect                                                                  bool
	leaseName, leaseNamespace                                                    string
	policy                                                                       history.Policy
	retainEvery                                                                  time.Duration
	scope                                                                        history.Scope
}

func main() {
	var o options
	var noSync, noRecord bool
	var compact, namespaces, excludeNS, excludeRes string
	flag.StringVar(&o.kubeconfig, "kubeconfig", "", "kubeconfig (in-cluster when empty)")
	flag.StringVar(&o.store, "store", "sqlite", "memory backend: sqlite (one replica) or postgres (several replicas with --leader-elect)")
	flag.StringVar(&o.db, "db", "/var/lib/griot/memory.db", "SQLite file")
	flag.StringVar(&o.dsn, "dsn", "", "PostgreSQL connection string; prefer the GRIOT_DSN environment variable")
	flag.StringVar(&o.listen, "listen", ":8443", "aggregated API listen address")
	flag.StringVar(&o.apiService, "apiservice", "v1alpha1."+history.Group, "APIService to keep the CA bundle of (empty: the CA is managed elsewhere)")
	flag.StringVar(&o.host, "host", "griot.sankofa-system.svc", "DNS name in the self-signed serving certificate")
	flag.StringVar(&o.tlsCert, "tls-cert-file", "", "serving certificate shared by all replicas (default: self-signed per process)")
	flag.StringVar(&o.tlsKey, "tls-key-file", "", "key of --tls-cert-file")
	flag.StringVar(&o.register, "register", "", "node IP to register as the Griot service endpoint (single control plane)")
	flag.DurationVar(&o.policy.MaxAge, "retention", 30*24*time.Hour, "forget changes older than this (the latest record of each object stays); 0 keeps all")
	flag.IntVar(&o.policy.MaxVersions, "max-versions", 0, "keep at most this many records per object (0: no limit)")
	flag.DurationVar(&o.policy.TombstoneTTL, "tombstone-ttl", 0, "forget dead objects entirely this long after their death (0: never)")
	flag.StringVar(&compact, "compact", "", `compaction tiers AFTER:WINDOW, e.g. "24h:1h,168h:24h" (every change for a day, hourly for a week, daily after)`)
	flag.DurationVar(&o.retainEvery, "retain-every", time.Hour, "how often to apply retention and compaction")
	flag.StringVar(&namespaces, "namespaces", "", "remember only these namespaces (comma-separated; cluster-scoped objects are always kept)")
	flag.StringVar(&excludeNS, "exclude-namespaces", "", "never remember these namespaces")
	flag.StringVar(&excludeRes, "exclude-resources", "", "never remember these resources, e.g. pods,replicasets.apps")
	flag.BoolVar(&o.compress, "compress", true, "store object bodies compressed with zstd")
	flag.BoolVar(&o.leaderElect, "leader-elect", false, "elect one recorder among replicas; all replicas serve reads (needs --store=postgres)")
	flag.StringVar(&o.leaseName, "lease-name", "griot-recorder", "leader election lease")
	flag.StringVar(&o.leaseNamespace, "lease-namespace", os.Getenv("POD_NAMESPACE"), "namespace of the lease")
	flag.BoolVar(&noSync, "no-sync", false, "do not sync cards and quests")
	flag.BoolVar(&noRecord, "no-record", false, "do not record history")
	flag.BoolVar(&o.webhooks, "webhooks", true, "serve the Sankofa admission webhooks (Kgotla, Polyrhythm, Credits)")
	flag.StringVar(&o.pulse, "pulse", ":8081", "plain-HTTP listen address of the public pulse stream (empty to disable)")
	flag.StringVar(&o.metrics, "metrics", "", "plain-HTTP listen address of /metrics (empty to disable)")
	flag.Parse()
	o.sync, o.record = !noSync, !noRecord
	o.scope = history.ParseScope(namespaces, excludeNS, excludeRes)
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	tiers, err := history.ParseTiers(compact)
	if err != nil {
		log.Error("griot", "err", err)
		os.Exit(2)
	}
	o.policy.Tiers = tiers
	if o.dsn == "" {
		o.dsn = os.Getenv("GRIOT_DSN")
	}
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	if err := run(ctx, log, o); err != nil {
		log.Error("griot", "err", err)
		os.Exit(1)
	}
}

func restConfig(path string) (*rest.Config, error) {
	if path != "" {
		return clientcmd.BuildConfigFromFlags("", path)
	}
	return rest.InClusterConfig()
}

func openStore(o options) (history.Store, error) {
	switch o.store {
	case "sqlite", "":
		if o.leaderElect {
			return nil, fmt.Errorf("--leader-elect needs --store=postgres: SQLite has one writer and one volume, run one replica")
		}
		if err := os.MkdirAll(filepath.Dir(o.db), 0o700); err != nil {
			return nil, err
		}
		s, err := history.OpenSQLite(o.db)
		if err != nil {
			return nil, err
		}
		s.Compress = o.compress
		return s, nil
	case "postgres":
		if o.dsn == "" {
			return nil, fmt.Errorf("--store=postgres needs GRIOT_DSN or --dsn")
		}
		s, err := history.OpenPostgres(o.dsn)
		if err != nil {
			return nil, err
		}
		s.Compress = o.compress
		return s, nil
	}
	return nil, fmt.Errorf("unknown --store %q", o.store)
}

func run(ctx context.Context, log *slog.Logger, o options) error {
	if o.register != "" && net.ParseIP(o.register) == nil {
		return fmt.Errorf("invalid --register IP %q", o.register)
	}
	cfg, err := restConfig(o.kubeconfig)
	if err != nil {
		return err
	}
	// Every read of the memory costs a SubjectAccessReview; the client-go
	// default of 5 requests per second would cap the API at a few reads.
	cfg.QPS, cfg.Burst = 100, 200
	kube := kubernetes.NewForConfigOrDie(cfg)
	sch := runtime.NewScheme()
	_ = clientgoscheme.AddToScheme(sch)
	_ = v1alpha1.AddToScheme(sch)
	cl, err := client.New(cfg, client.Options{Scheme: sch})
	if err != nil {
		return err
	}
	if o.sync && !o.record {
		return syncCards(ctx, log, cl)
	}
	if o.pulse != "" {
		hub := &pulse.Hub{}
		go hub.Run(ctx, kube)
		pm := http.NewServeMux()
		pm.Handle("/pulse", hub)
		serve(ctx, log, "pulse", o.pulse, pm)
	}
	if !o.record {
		<-ctx.Done()
		return nil
	}
	store, err := openStore(o)
	if err != nil {
		return err
	}
	defer store.Close()

	rec := &history.Recorder{Store: store, Discovery: kube.Discovery(), Dynamic: dynamic.NewForConfigOrDie(cfg), Log: log, Scope: o.scope}
	m := &metrics{rec: rec, store: store}
	if o.metrics != "" {
		mm := http.NewServeMux()
		mm.Handle("/metrics", m)
		serve(ctx, log, "metrics", o.metrics, mm)
	}
	record := func(ctx context.Context) {
		m.leader.Store(true)
		go retain(ctx, log, store, o.policy, o.retainEvery, m)
		if err := rec.Run(ctx, 2*time.Minute); err != nil {
			log.Error("recorder", "err", err)
		}
	}
	if o.leaderElect {
		go elect(ctx, log, kube, o, record)
	} else {
		go record(ctx)
	}

	auth, err := frontProxy(ctx, kube)
	if err != nil {
		return fmt.Errorf("front proxy auth: %w", err)
	}
	var cert tls.Certificate
	var caPEM []byte
	if o.tlsCert != "" {
		// Replicas behind one Service share one certificate; whoever installs
		// it also sets the APIService CA bundle.
		if cert, err = tls.LoadX509KeyPair(o.tlsCert, o.tlsKey); err != nil {
			return err
		}
	} else if cert, caPEM, err = selfSigned(o.host); err != nil {
		return err
	}
	mux := http.NewServeMux()
	mux.Handle("/", (&history.API{Store: store, Auth: auth, Kube: kube}).Handler())
	if o.webhooks {
		webhooks(mux, cl, kube)
	}
	// Addons and the node service start independently. Reconcile until they
	// exist, and repair CA bundles after addon reapplication or a restart.
	go reconcile(ctx, log, cl, o.apiService, caPEM, o.register, o.sync, o.webhooks)
	srv := &http.Server{
		Addr:    o.listen,
		Handler: mux,
		TLSConfig: &tls.Config{
			Certificates: []tls.Certificate{cert},
			ClientAuth:   tls.VerifyClientCertIfGiven,
			ClientCAs:    auth.CA,
			MinVersion:   tls.VersionTLS12,
		},
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		<-ctx.Done()
		sctx, c := context.WithTimeout(context.Background(), 5*time.Second)
		defer c()
		_ = srv.Shutdown(sctx)
	}()
	log.Info("griot is listening", "addr", o.listen, "store", o.store, "leaderElect", o.leaderElect)
	if err := srv.ListenAndServeTLS("", ""); err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}

func serve(ctx context.Context, log *slog.Logger, name, addr string, h http.Handler) {
	s := &http.Server{Addr: addr, Handler: h, ReadHeaderTimeout: 10 * time.Second}
	go func() { <-ctx.Done(); _ = s.Close() }()
	go func() {
		if err := s.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error(name, "err", err)
		}
	}()
}

// syncCards applies every embedded card and removes cards that left the
// collection.
func syncCards(ctx context.Context, log *slog.Logger, cl client.Client) error {
	set, err := card.LoadFS(content.Cards())
	if err != nil {
		return err
	}
	if errs := set.Validate(); len(errs) > 0 {
		return fmt.Errorf("embedded content does not lint: %v", errs[0])
	}
	keep := map[string]bool{}
	for _, id := range set.Order {
		o := v1alpha1.FromCard(set.Resolved(set.ByID[id]))
		o.Labels["app.kubernetes.io/managed-by"] = managedBy
		if err := cl.Patch(ctx, o, client.Apply, client.FieldOwner(managedBy), client.ForceOwnership); err != nil {
			return fmt.Errorf("card %s: %w", id, err)
		}
		keep[id] = true
	}
	var list v1alpha1.CardList
	if err := cl.List(ctx, &list, client.MatchingLabels{"app.kubernetes.io/managed-by": managedBy}); err != nil {
		return err
	}
	for i := range list.Items {
		if !keep[list.Items[i].Name] {
			if err := cl.Delete(ctx, &list.Items[i]); err != nil {
				return err
			}
		}
	}
	quests, err := v1alpha1.LoadQuests(content.Quests())
	if err != nil {
		return err
	}
	for _, q := range quests {
		q.Labels = map[string]string{"app.kubernetes.io/managed-by": managedBy}
		if err := cl.Patch(ctx, q, client.Apply, client.FieldOwner(managedBy), client.ForceOwnership); err != nil {
			return fmt.Errorf("quest %s: %w", q.Name, err)
		}
	}
	log.Info("cards in the cluster", "cards", len(set.Order), "quests", len(quests))
	return nil
}

// frontProxy reads the aggregator's client CA and header names, the same way
// any extension API server does.
func frontProxy(ctx context.Context, kube kubernetes.Interface) (*history.Authenticator, error) {
	cm, err := kube.CoreV1().ConfigMaps("kube-system").Get(ctx, "extension-apiserver-authentication", metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM([]byte(cm.Data["requestheader-client-ca-file"])) {
		return nil, fmt.Errorf("no requestheader-client-ca-file")
	}
	list := func(k, def string) []string {
		v := cm.Data[k]
		if v == "" {
			v = def
		}
		var out []string
		for _, s := range strings.Split(strings.Trim(v, "[]"), ",") {
			if s = strings.Trim(strings.TrimSpace(s), `"`); s != "" {
				out = append(out, s)
			}
		}
		return out
	}
	return &history.Authenticator{
		CA:           pool,
		AllowedNames: list("requestheader-allowed-names", ""),
		UserHeaders:  list("requestheader-username-headers", "X-Remote-User"),
		GroupHeaders: list("requestheader-group-headers", "X-Remote-Group"),
	}, nil
}

func selfSigned(host string) (tls.Certificate, []byte, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(time.Now().UnixNano()),
		Subject:               pkix.Name{CommonName: host},
		DNSNames:              []string{host, strings.TrimSuffix(host, ".svc"), host + ".cluster.local"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(10 * 365 * 24 * time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IsCA:                  true,
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	kb, _ := x509.MarshalECPrivateKey(key)
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: kb})
	c, err := tls.X509KeyPair(certPEM, keyPEM)
	return c, certPEM, err
}

// publishCA writes the serving CA into the APIService, so the aggregator
// trusts Griot without cert-manager.
func publishCA(ctx context.Context, cl client.Client, name string, ca []byte) error {
	obj := &unstructured.Unstructured{}
	obj.SetAPIVersion("apiregistration.k8s.io/v1")
	obj.SetKind("APIService")
	obj.SetName(name)
	if err := cl.Get(ctx, client.ObjectKey{Name: name}, obj); err != nil {
		return err
	}
	current, _, _ := unstructured.NestedString(obj.Object, "spec", "caBundle")
	insecure, _, _ := unstructured.NestedBool(obj.Object, "spec", "insecureSkipTLSVerify")
	if current == base64.StdEncoding.EncodeToString(ca) && !insecure {
		return nil
	}
	patch := fmt.Sprintf(`{"spec":{"caBundle":%q,"insecureSkipTLSVerify":false}}`, base64.StdEncoding.EncodeToString(ca))
	return cl.Patch(ctx, obj, client.RawPatch(types.MergePatchType, []byte(patch)))
}

// webhooks registers the distribution's admission webhooks.
func webhooks(mux *http.ServeMux, cl client.Client, kube kubernetes.Interface) {
	councils := func(ctx context.Context) ([]v1alpha1.Kgotla, error) {
		var l v1alpha1.KgotlaList
		err := cl.List(ctx, &l)
		return l.Items, err
	}
	taken := func(ctx context.Context, rest, self string) map[int]bool {
		out := map[int]bool{}
		l, err := kube.BatchV1().CronJobs("").List(ctx, metav1.ListOptions{})
		if err != nil {
			return out
		}
		for _, cj := range l.Items {
			f := strings.Fields(cj.Spec.Schedule)
			if len(f) != 5 || cj.Namespace+"/"+cj.Name == self || strings.Join(f[1:], " ") != rest {
				continue
			}
			if m, err := strconv.Atoi(strings.SplitN(f[0], "/", 2)[0]); err == nil {
				out[m] = true
			}
		}
		return out
	}
	resolver := &credits.Resolver{Timeout: 12 * time.Second}
	mux.Handle("/admit/kgotla", admission.Serve(admission.Kgotla(councils)))
	mux.Handle("/mutate/kgotla-speech", admission.Serve(admission.KgotlaSpeech(time.Now)))
	mux.Handle("/mutate/polyrhythm", admission.Serve(admission.Polyrhythm(taken)))
	mux.Handle("/admit/credits/warn", admission.Serve(admission.Credits(resolver.Resolve, false)))
	mux.Handle("/admit/credits/enforce", admission.Serve(admission.Credits(resolver.Resolve, true)))
}

// publishWebhookCA writes the serving CA into every webhook of a configuration.
func publishWebhookCA(ctx context.Context, cl client.Client, name string, ca []byte) error {
	kind := "ValidatingWebhookConfiguration"
	if strings.Contains(name, "mutating") {
		kind = "MutatingWebhookConfiguration"
	}
	obj := &unstructured.Unstructured{}
	obj.SetAPIVersion("admissionregistration.k8s.io/v1")
	obj.SetKind(kind)
	if err := cl.Get(ctx, client.ObjectKey{Name: name}, obj); err != nil {
		return err
	}
	before := obj.DeepCopy()
	hooks, _, _ := unstructured.NestedSlice(obj.Object, "webhooks")
	for i := range hooks {
		h := hooks[i].(map[string]any)
		_ = unstructured.SetNestedField(h, base64.StdEncoding.EncodeToString(ca), "clientConfig", "caBundle")
		hooks[i] = h
	}
	_ = unstructured.SetNestedSlice(obj.Object, hooks, "webhooks")
	a, _ := before.MarshalJSON()
	b, _ := obj.MarshalJSON()
	if bytes.Equal(a, b) {
		return nil
	}
	return cl.Update(ctx, obj)
}
