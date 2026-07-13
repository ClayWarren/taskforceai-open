package util

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestUtilFinalPushTo95CoverageGapPaths(t *testing.T) {
	t.Run("validate struct returns nil for nil input", func(t *testing.T) {
		assert.NoError(t, ValidateStruct(nil))
	})

	t.Run("worktree falls back to directory when worktree env unset", func(t *testing.T) {
		restore := SetRuntimeContextSource(RuntimeContextSourceFunc(func() RuntimeContext {
			return RuntimeContext{RootDir: "/tmp/taskforce-root"}
		}))
		t.Cleanup(restore)
		assert.Equal(t, "/tmp/taskforce-root", Worktree())
	})
}
