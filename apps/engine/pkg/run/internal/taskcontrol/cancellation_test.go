package taskcontrol

import (
	"context"
	"testing"
)

func TestCancellationRegistryRejectsInvalidEntries(t *testing.T) {
	var registry CancellationRegistry
	clear := registry.Register("", func() {})
	clear()
	clear = registry.Register("nil-cancel", nil)
	clear()

	if registry.Cancel("") {
		t.Fatal("empty task should not cancel")
	}
	if registry.Cancel("missing") {
		t.Fatal("missing task should not cancel")
	}

	registry.cancellations.Store("bad-cancel", "not-a-cancel-func")
	if registry.Cancel("bad-cancel") {
		t.Fatal("invalid cancellation value should not cancel")
	}
	if _, ok := registry.cancellations.Load("bad-cancel"); ok {
		t.Fatal("invalid cancellation value should be deleted")
	}

	ctx, cancel := context.WithCancel(context.Background())
	clear = registry.Register("task", cancel)
	defer clear()
	if !registry.Cancel("task") {
		t.Fatal("registered cancellation should be found")
	}
	<-ctx.Done()
}
