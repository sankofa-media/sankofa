package history

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"time"
)

// Griot's records say what an object became and which field manager wrote
// it, never which user: a watch does not carry identities. The API server's
// audit log does. When the API server sends its audit events to Griot (the
// webhook backend), Griot keeps a compact index of mutating requests and
// names the user behind each moment by matching object, verb class and time.
//
// The match is best effort. Record times come from managedFields (whole
// seconds) for births and changes and from Griot's clock for deaths; when
// several users write the same object within the same second, the nearest
// event wins.

// AuditEvent is the part of an audit.k8s.io/v1 Event Griot keeps.
type AuditEvent struct {
	At      time.Time
	Ref     Ref // Name is empty for deletecollection
	Verb    string
	User    string
	AuditID string
}

// AuditStore keeps audit events next to the records.
type AuditStore interface {
	AddAudit(ctx context.Context, events []AuditEvent) error
	AuditFor(ctx context.Context, ref Ref, from, to time.Time) ([]AuditEvent, error)
	PruneAudit(ctx context.Context, before time.Time) (int64, error)
}

// auditMatch is how far from a record time an event may be.
const auditMatch = 10 * time.Second

// AuditReceiver accepts EventList batches from the API server's audit
// webhook. Authentication (a client certificate) is the server's job.
type AuditReceiver struct {
	Store AuditStore
	Log   *slog.Logger
}

type auditEventList struct {
	Items []struct {
		AuditID string `json:"auditID"`
		Stage   string `json:"stage"`
		Verb    string `json:"verb"`
		User    struct {
			Username string `json:"username"`
		} `json:"user"`
		ImpersonatedUser *struct {
			Username string `json:"username"`
		} `json:"impersonatedUser"`
		ObjectRef *struct {
			APIGroup    string `json:"apiGroup"`
			Resource    string `json:"resource"`
			Namespace   string `json:"namespace"`
			Name        string `json:"name"`
			Subresource string `json:"subresource"`
		} `json:"objectRef"`
		ResponseStatus *struct {
			Code int `json:"code"`
		} `json:"responseStatus"`
		StageTimestamp time.Time `json:"stageTimestamp"`
	} `json:"items"`
}

var mutating = map[string]bool{"create": true, "update": true, "patch": true, "delete": true, "deletecollection": true}

// ParseAudit keeps successful mutating requests on objects (not on their
// status) from an EventList.
func ParseAudit(body []byte) ([]AuditEvent, error) {
	var l auditEventList
	if err := json.Unmarshal(body, &l); err != nil {
		return nil, err
	}
	var out []AuditEvent
	for _, e := range l.Items {
		if e.Stage != "ResponseComplete" || !mutating[e.Verb] || e.ObjectRef == nil || e.ObjectRef.Subresource != "" {
			continue
		}
		if e.ResponseStatus == nil || e.ResponseStatus.Code < 200 || e.ResponseStatus.Code >= 300 {
			continue
		}
		user := e.User.Username
		if e.ImpersonatedUser != nil && e.ImpersonatedUser.Username != "" {
			user = e.ImpersonatedUser.Username + " (as, by " + e.User.Username + ")"
		}
		out = append(out, AuditEvent{
			At:      e.StageTimestamp.UTC(),
			Ref:     Ref{Group: e.ObjectRef.APIGroup, Resource: e.ObjectRef.Resource, Namespace: e.ObjectRef.Namespace, Name: e.ObjectRef.Name},
			Verb:    e.Verb,
			User:    user,
			AuditID: e.AuditID,
		})
	}
	return out, nil
}

func (a *AuditReceiver) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST an audit.k8s.io/v1 EventList", http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 64<<20))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	events, err := ParseAudit(body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := a.Store.AddAudit(r.Context(), events); err != nil {
		a.Log.Warn("audit", "err", err)
		http.Error(w, "store", http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func verbClass(recordVerb, auditVerb string) bool {
	switch recordVerb {
	case Born:
		// Server-side apply creates with a patch; kubectl replace --force
		// with an update is not a creation but appears so after a delete.
		return auditVerb == "create" || auditVerb == "patch" || auditVerb == "update"
	case Changed:
		return auditVerb == "update" || auditVerb == "patch"
	case Died:
		return auditVerb == "delete" || auditVerb == "deletecollection"
	}
	return false
}

// AttributeMoments names the user behind each moment of one object, from
// audit events around them. Moments must be oldest first.
func AttributeMoments(ctx context.Context, s AuditStore, ref Ref, moments []Moment) {
	if len(moments) == 0 {
		return
	}
	from, to := moments[0].At.Add(-auditMatch), moments[len(moments)-1].At.Add(auditMatch)
	events, err := s.AuditFor(ctx, ref, from, to)
	if err != nil || len(events) == 0 {
		return
	}
	used := map[string]bool{}
	for i := range moments {
		m := &moments[i]
		best, bestD := -1, auditMatch+time.Second
		for j, e := range events {
			if used[e.AuditID] || !verbClass(m.Verb, e.Verb) {
				continue
			}
			// A record time from managedFields is truncated to the second.
			d := e.At.Sub(m.At)
			if m.Verb != Died {
				d -= 500 * time.Millisecond
			}
			if d < 0 {
				d = -d
			}
			// A named request beats a deletecollection of the whole resource.
			if e.Ref.Name == "" {
				d += auditMatch / 2
			}
			if d < bestD {
				best, bestD = j, d
			}
		}
		if best >= 0 && bestD <= auditMatch {
			m.User = events[best].User
			if events[best].Ref.Name != "" {
				used[events[best].AuditID] = true
			}
		}
	}
}

// AddAudit appends audit events.
func (s *SQLStore) AddAudit(ctx context.Context, events []AuditEvent) error {
	if len(events) == 0 {
		return nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	for start := 0; start < len(events); start += batchRows {
		chunk := events[start:min(start+batchRows, len(events))]
		var b strings.Builder
		b.WriteString(`INSERT INTO audit(at,grp,resource,namespace,name,verb,username,audit_id) VALUES`)
		args := make([]any, 0, 8*len(chunk))
		for i, e := range chunk {
			if i > 0 {
				b.WriteByte(',')
			}
			b.WriteString("(?,?,?,?,?,?,?,?)")
			args = append(args, e.At.UnixMilli(), e.Ref.Group, e.Ref.Resource, e.Ref.Namespace, e.Ref.Name, e.Verb, e.User, e.AuditID)
		}
		if _, err := tx.ExecContext(ctx, s.q(b.String()), args...); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// AuditFor returns events on the object, and deletecollections of its
// resource in its namespace, between from and to.
func (s *SQLStore) AuditFor(ctx context.Context, ref Ref, from, to time.Time) ([]AuditEvent, error) {
	rows, err := s.db.QueryContext(ctx, s.q(`SELECT at,grp,resource,namespace,name,verb,username,audit_id FROM audit
 WHERE grp=? AND resource=? AND namespace=? AND (name=? OR name='') AND at>=? AND at<=? ORDER BY at`),
		ref.Group, ref.Resource, ref.Namespace, ref.Name, from.UnixMilli(), to.UnixMilli())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AuditEvent
	for rows.Next() {
		var e AuditEvent
		var at int64
		if err := rows.Scan(&at, &e.Ref.Group, &e.Ref.Resource, &e.Ref.Namespace, &e.Ref.Name, &e.Verb, &e.User, &e.AuditID); err != nil {
			return nil, err
		}
		e.At = time.UnixMilli(at).UTC()
		out = append(out, e)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].At.Before(out[j].At) })
	return out, rows.Err()
}

// PruneAudit forgets audit events older than before.
func (s *SQLStore) PruneAudit(ctx context.Context, before time.Time) (int64, error) {
	return s.exec(ctx, `DELETE FROM audit WHERE at<?`, before.UnixMilli())
}

const auditSchema = `
CREATE TABLE IF NOT EXISTS audit (
  at BIGINT NOT NULL, grp TEXT NOT NULL, resource TEXT NOT NULL, namespace TEXT NOT NULL, name TEXT NOT NULL,
  verb TEXT NOT NULL, username TEXT NOT NULL, audit_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_ref ON audit(grp, resource, namespace, name, at)`
