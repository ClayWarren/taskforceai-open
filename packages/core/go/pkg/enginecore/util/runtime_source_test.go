package util

import "testing"

func TestRuntimeSourceNilBranches(t *testing.T) {
	t.Cleanup(func() {
		runtimeContextSourceMu.Lock()
		runtimeContextSource = emptyRuntimeContextSource{}
		runtimeContextSourceMu.Unlock()
	})

	var fn RuntimeContextSourceFunc
	if got := fn.RuntimeContext(); got != (RuntimeContext{}) {
		t.Fatalf("nil func should return empty runtime context, got %#v", got)
	}

	restore := SetRuntimeContextSource(nil)
	if Directory() != "." || Worktree() != "." {
		t.Fatalf("nil source should install empty runtime context")
	}
	restore()

	runtimeContextSourceMu.Lock()
	runtimeContextSource = nil
	runtimeContextSourceMu.Unlock()
	if got := runtimeContext(); got != (RuntimeContext{}) {
		t.Fatalf("nil stored source should return empty runtime context, got %#v", got)
	}

	restore = SetRuntimeContextSource(RuntimeContextSourceFunc(func() RuntimeContext {
		return RuntimeContext{RootDir: " /repo "}
	}))
	t.Cleanup(restore)
	if got := Worktree(); got != "/repo" {
		t.Fatalf("expected worktree to fall back to root dir, got %q", got)
	}
}
