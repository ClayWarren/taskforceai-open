package handler_test

import "testing"

// restore snapshots *target now and restores it on cleanup without changing the
// current value. Use when the test assigns the var itself just after.
func restore[T any](t *testing.T, target *T) {
	t.Helper()
	old := *target
	t.Cleanup(func() { *target = old })
}
