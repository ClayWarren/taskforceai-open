package generatedfiles

import "testing"

func restore[T any](t *testing.T, target *T) {
	t.Helper()
	original := *target
	t.Cleanup(func() { *target = original })
}
