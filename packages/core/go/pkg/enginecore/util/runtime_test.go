package util

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestRuntime(t *testing.T) {
	t.Run("Directory and Worktree", func(t *testing.T) {
		restore := SetRuntimeContextSource(RuntimeContextSourceFunc(func() RuntimeContext {
			return RuntimeContext{RootDir: "/tmp/root"}
		}))
		t.Cleanup(restore)
		assert.Equal(t, "/tmp/root", Directory())

		restore()
		assert.Equal(t, ".", Directory())

		restore = SetRuntimeContextSource(RuntimeContextSourceFunc(func() RuntimeContext {
			return RuntimeContext{RootDir: "/tmp/root", WorktreeDir: "/tmp/wt"}
		}))
		t.Cleanup(restore)
		assert.Equal(t, "/tmp/wt", Worktree())
	})
}
