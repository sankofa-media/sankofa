package history

import (
	"context"
	"testing"

	authzv1 "k8s.io/api/authorization/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
)

// Reviews are reused for a short time: a namespace list or a busy reader must
// not cost one SubjectAccessReview per object, and the answer must still
// depend on who asks.
func TestReviewsAreCachedPerCaller(t *testing.T) {
	kc := fake.NewSimpleClientset()
	calls := 0
	kc.PrependReactor("create", "subjectaccessreviews", func(a k8stesting.Action) (bool, runtime.Object, error) {
		calls++
		sar := a.(k8stesting.CreateAction).GetObject().(*authzv1.SubjectAccessReview)
		sar.Status.Allowed = sar.Spec.User == "alice"
		return true, sar, nil
	})
	api := &API{Kube: kc}
	ctx := context.Background()
	ref := Ref{Resource: "configmaps", Namespace: "a", Name: "x"}
	for i := 0; i < 5; i++ {
		if !api.allowed(ctx, "alice", nil, ref) {
			t.Fatal("alice is allowed")
		}
		if api.allowed(ctx, "bob", nil, ref) {
			t.Fatal("bob is not allowed")
		}
	}
	if calls != 2 {
		t.Fatalf("%d reviews, want one per caller", calls)
	}
	check := api.checker(ctx, "alice", nil)
	for i := 0; i < 100; i++ {
		check(Ref{Resource: "configmaps", Namespace: "b", Name: string(rune('a' + i%26))})
	}
	if calls != 3 {
		t.Fatalf("a namespace-wide grant must cost one review, got %d more", calls-2)
	}
}
