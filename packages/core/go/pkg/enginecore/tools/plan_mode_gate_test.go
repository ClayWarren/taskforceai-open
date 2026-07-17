package tools

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestPlanModeGatesEditBucketAtDispatch exercises the full plan-mode flow
// through the real dispatch path: enter via the plan_enter tool, verify
// every edit-bucket tool is denied while read tools still work, exit via
// plan_exit, and verify writes work again.
func TestPlanModeGatesEditBucketAtDispatch(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "existing.txt"), []byte("hello"), 0o600))
	ctx := protocol.ToolContext{
		Ctx:       context.Background(),
		Cwd:       dir,
		ReadFiles: map[string]bool{},
		Plan:      NewPlanStore(),
	}

	res := ExecuteTool(ctx, "plan_enter", map[string]any{})
	require.Equal(t, "completed", res.Status)
	require.True(t, ctx.Plan.IsActive())

	// Edit-bucket tools are denied at dispatch, before their handlers run.
	for _, tc := range []struct {
		tool string
		args map[string]any
	}{
		{"write", map[string]any{"filePath": "blocked.txt", "content": "nope"}},
		{"edit", map[string]any{"filePath": "existing.txt", "oldString": "hello", "newString": "bye"}},
		{"apply_patch", map[string]any{"patch": "*** Begin Patch\n*** Add File: blocked.txt\n+nope\n*** End Patch"}},
	} {
		res := ExecuteTool(ctx, tc.tool, tc.args)
		assert.Equal(t, "error", res.Status, tc.tool)
		assert.Contains(t, res.Error, "plan mode is active", tc.tool)
	}
	assert.NoFileExists(t, filepath.Join(dir, "blocked.txt"))

	// Read-only tools are unaffected.
	res = ExecuteTool(ctx, "read", map[string]any{"filePath": "existing.txt"})
	require.Equal(t, "completed", res.Status)
	assert.Contains(t, res.Output, "hello")

	// Exit restores write access.
	res = ExecuteTool(ctx, "plan_exit", map[string]any{})
	require.Equal(t, "completed", res.Status)
	require.False(t, ctx.Plan.IsActive())

	res = ExecuteTool(ctx, "write", map[string]any{"filePath": "allowed.txt", "content": "yes"})
	require.Equal(t, "completed", res.Status)
	assert.FileExists(t, filepath.Join(dir, "allowed.txt"))
}

func TestPlanModeGateIgnoredWithoutStore(t *testing.T) {
	dir := t.TempDir()
	ctx := protocol.ToolContext{Ctx: context.Background(), Cwd: dir, ReadFiles: map[string]bool{}}

	// No PlanStore configured: writes proceed normally (backwards compatible).
	res := ExecuteTool(ctx, "write", map[string]any{"filePath": "ok.txt", "content": "fine"})
	require.Equal(t, "completed", res.Status)
	assert.FileExists(t, filepath.Join(dir, "ok.txt"))
}
