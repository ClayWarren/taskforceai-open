package handler

import (
	"context"
	"testing"

	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/golang-jwt/jwt/v5"
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

// withTokenValidation stubs adapterhandler.ValidateToken with validate and
// IsTokenRevoked to always-false for the duration of the test, restoring both
// on cleanup.
func withTokenValidation(t testing.TB, validate func(string) (jwt.MapClaims, error)) {
	t.Helper()
	swap(t, &adapterhandler.ValidateToken, validate)
	swap(t, &adapterhandler.IsTokenRevoked, func(context.Context, string) bool { return false })
}
