package handler

import "testing"

// swap sets *target to val for the duration of the test and restores the
// previous value on cleanup, collapsing `old:=X; X=val; t.Cleanup(restore)`.
func swap[T any](t *testing.T, target *T, val T) {
	t.Helper()
	old := *target
	*target = val
	t.Cleanup(func() { *target = old })
}

// restore snapshots *target now and restores it on cleanup without changing the
// current value. Use when the test assigns the var itself just after.
func restore[T any](t *testing.T, target *T) {
	t.Helper()
	old := *target
	t.Cleanup(func() { *target = old })
}
