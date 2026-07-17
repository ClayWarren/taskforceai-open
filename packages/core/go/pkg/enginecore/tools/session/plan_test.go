package session

import (
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPlanEnterExitLifecycle(t *testing.T) {
	ctx := protocol.ToolContext{Plan: NewPlanStore()}

	res := ExecutePlanEnter(ctx, nil)
	require.Equal(t, "completed", res.Status)
	assert.Contains(t, res.Output, "READ-ONLY")
	assert.True(t, ctx.Plan.IsActive())

	// Entering again is a no-op, not an error.
	res = ExecutePlanEnter(ctx, nil)
	require.Equal(t, "completed", res.Status)
	assert.Contains(t, res.Output, "already active")

	res = ExecutePlanExit(ctx, nil)
	require.Equal(t, "completed", res.Status)
	assert.False(t, ctx.Plan.IsActive())

	// Exiting again is a no-op, not an error.
	res = ExecutePlanExit(ctx, nil)
	require.Equal(t, "completed", res.Status)
	assert.Contains(t, res.Output, "not active")
}

func TestPlanToolsErrorWithoutStore(t *testing.T) {
	res := ExecutePlanEnter(protocol.ToolContext{}, nil)
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "not available")

	res = ExecutePlanExit(protocol.ToolContext{}, nil)
	assert.Equal(t, "error", res.Status)
}

func TestClonePlanStoreCopiesState(t *testing.T) {
	original := NewPlanStore()
	original.Enter()

	clone := ClonePlanStore(original)
	assert.True(t, clone.IsActive())

	// The clone is independent: exiting it doesn't affect the original.
	clone.Exit()
	assert.True(t, original.IsActive())
	assert.False(t, clone.IsActive())

	assert.False(t, ClonePlanStore(nil).IsActive())
}
