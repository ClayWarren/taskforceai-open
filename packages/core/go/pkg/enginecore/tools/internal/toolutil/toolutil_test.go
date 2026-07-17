package toolutil

import (
	"context"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResultHelpers(t *testing.T) {
	result := NewResult(nil)
	assert.Equal(t, "completed", result.Status)
	assert.NotNil(t, result.Input)

	input := map[string]any{"value": 1}
	result = NewResult(input)
	result.Input["value"] = 2
	assert.Equal(t, 2, input["value"])

	result = ErrorResult(input, "failed")
	assert.Equal(t, "error", result.Status)
	assert.Equal(t, "failed", result.Error)

	assert.Equal(t, "Error: read: invalid arguments", InvalidArgs("read", input).Error)
	assert.Equal(t, "Error: read: invalid arguments (missing path)", InvalidArgs("read", input, "missing path").Error)

	MarkError(&result, "changed")
	assert.Equal(t, "error", result.Status)
	assert.Equal(t, "changed", result.Error)
}

func TestContextHelpers(t *testing.T) {
	ctx := EnsureContext(protocol.ToolContext{})
	assert.NotNil(t, ctx.Ctx)
	assert.NotEmpty(t, ctx.Cwd)
	assert.NotNil(t, ctx.ReadFiles)
	require.NoError(t, CheckContext(ctx))

	base, cancel := context.WithCancel(context.Background())
	cancel()
	assert.ErrorIs(t, CheckContext(EnsureContext(protocol.ToolContext{Ctx: base, Cwd: "custom", ReadFiles: map[string]bool{"a": true}})), context.Canceled)
}

func TestArgumentHelpers(t *testing.T) {
	args := map[string]any{"string": "value", "other": 4}
	assert.Equal(t, "value", GetString(args, "string"))
	assert.Empty(t, GetString(args, "other"))

	tests := []struct {
		input any
		want  int
		ok    bool
	}{
		{input: 2, want: 2, ok: true},
		{input: int64(3), want: 3, ok: true},
		{input: 4.9, want: 4, ok: true},
		{input: "5", want: 5, ok: true},
		{input: "bad", ok: false},
		{input: struct{}{}, ok: false},
	}
	for _, test := range tests {
		got, ok := ToInt(test.input)
		assert.Equal(t, test.ok, ok)
		assert.Equal(t, test.want, got)
	}
}
