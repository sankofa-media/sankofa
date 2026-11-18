package history

import (
	"context"
	"testing"
	"time"
)

const auditBatch = `{"kind":"EventList","apiVersion":"audit.k8s.io/v1","items":[
 {"auditID":"a1","stage":"ResponseComplete","verb":"create","user":{"username":"alice"},"objectRef":{"resource":"configmaps","namespace":"a","name":"x"},"responseStatus":{"code":201},"stageTimestamp":"2026-11-01T00:00:00.400Z"},
 {"auditID":"a2","stage":"ResponseComplete","verb":"patch","user":{"username":"bob"},"objectRef":{"resource":"configmaps","namespace":"a","name":"x"},"responseStatus":{"code":200},"stageTimestamp":"2026-11-01T00:01:00.700Z"},
 {"auditID":"a3","stage":"ResponseComplete","verb":"patch","user":{"username":"mallory"},"objectRef":{"resource":"configmaps","namespace":"a","name":"x"},"responseStatus":{"code":403},"stageTimestamp":"2026-11-01T00:01:00.600Z"},
 {"auditID":"a4","stage":"ResponseComplete","verb":"update","user":{"username":"kubelet"},"objectRef":{"resource":"configmaps","namespace":"a","name":"x","subresource":"status"},"responseStatus":{"code":200},"stageTimestamp":"2026-11-01T00:01:00.650Z"},
 {"auditID":"a5","stage":"RequestReceived","verb":"delete","user":{"username":"carol"},"objectRef":{"resource":"configmaps","namespace":"a","name":"x"},"stageTimestamp":"2026-11-01T00:02:00Z"},
 {"auditID":"a6","stage":"ResponseComplete","verb":"delete","user":{"username":"admin"},"impersonatedUser":{"username":"carol"},"objectRef":{"resource":"configmaps","namespace":"a","name":"x"},"responseStatus":{"code":200},"stageTimestamp":"2026-11-01T00:02:00Z"},
 {"auditID":"a7","stage":"ResponseComplete","verb":"get","user":{"username":"dave"},"objectRef":{"resource":"configmaps","namespace":"a","name":"x"},"responseStatus":{"code":200},"stageTimestamp":"2026-11-01T00:02:00Z"},
 {"auditID":"a8","stage":"ResponseComplete","verb":"deletecollection","user":{"username":"system:serviceaccount:kube-system:namespace-controller"},"objectRef":{"resource":"configmaps","namespace":"a"},"responseStatus":{"code":200},"stageTimestamp":"2026-11-01T00:05:00Z"}
]}`

func TestAuditNamesTheUser(t *testing.T) {
	events, err := ParseAudit([]byte(auditBatch))
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 4 {
		t.Fatalf("kept %d events, want the successful mutations on objects: %+v", len(events), events)
	}
	for name, s := range backends(t) {
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			if err := s.AddAudit(ctx, events); err != nil {
				t.Fatal(err)
			}
			ref := Ref{Resource: "configmaps", Namespace: "a", Name: "x"}
			moments := []Moment{
				{Verb: Born, At: t0},                                           // managedFields time, whole seconds
				{Verb: Changed, At: t0.Add(time.Minute)},                       // bob, not the refused mallory or the kubelet's status
				{Verb: Died, At: t0.Add(2*time.Minute + 300*time.Millisecond)}, // Griot's clock, after the request
			}
			AttributeMoments(ctx, s, ref, moments)
			want := []string{"alice", "bob", "carol (as, by admin)"}
			for i, m := range moments {
				if m.User != want[i] {
					t.Fatalf("moment %d (%s): %q, want %q", i, m.Verb, m.User, want[i])
				}
			}
			// A namespace deletion removes objects with deletecollection.
			other := []Moment{{Verb: Died, At: t0.Add(5*time.Minute + time.Second)}}
			AttributeMoments(ctx, s, Ref{Resource: "configmaps", Namespace: "a", Name: "y"}, other)
			if other[0].User != "system:serviceaccount:kube-system:namespace-controller" {
				t.Fatalf("deletecollection not attributed: %q", other[0].User)
			}
			// Nothing within reach: no name rather than a wrong one.
			far := []Moment{{Verb: Changed, At: t0.Add(time.Hour)}}
			AttributeMoments(ctx, s, ref, far)
			if far[0].User != "" {
				t.Fatalf("attributed a moment with no event near it to %q", far[0].User)
			}
			if n, err := s.PruneAudit(ctx, t0.Add(10*time.Minute)); err != nil || n != 4 {
				t.Fatalf("pruned %d %v", n, err)
			}
		})
	}
}
