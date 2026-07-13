package stream

import (
	"context"
	"net/http"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
)

// swap sets *target to val for the duration of the test and restores the
// previous value on cleanup, collapsing `old:=X; X=val; t.Cleanup(restore)`.
func swap[T any](t testing.TB, target *T, val T) {
	t.Helper()
	old := *target
	*target = val
	t.Cleanup(func() { *target = old })
}

// restore snapshots *target now and restores it on cleanup without changing the
// current value. Use when the test assigns the var itself just after.
func restore[T any](t testing.TB, target *T) {
	t.Helper()
	old := *target
	t.Cleanup(func() { *target = old })
}

// withStreamUser stubs getQueries (empty queries) and authWrapper (injects user
// into the request context) for the duration of the test, restoring both on
// cleanup.
func withStreamUser(t testing.TB, user *auth.AuthenticatedUser) {
	t.Helper()
	swap(t, &getQueries, func(ctx context.Context) (*db.Queries, error) { return &db.Queries{}, nil })
	swap(t, &authWrapper, func(q *db.Queries, next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			ctx := context.WithValue(r.Context(), adapterhandler.UserContextKey, user)
			next(w, r.WithContext(ctx))
		}
	})
}
