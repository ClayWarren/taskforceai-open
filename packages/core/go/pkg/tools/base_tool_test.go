package tools

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBaseTool(t *testing.T) {
	params := ToolParameters{
		Type: "object",
		Properties: map[string]any{
			"input": map[string]any{"type": "string"},
		},
	}

	exec := func(ctx context.Context, args string) (ToolResult, error) {
		return ToolResult{"res": args}, nil
	}

	tool := NewBaseTool("test", "desc", params, exec)

	assert.Equal(t, "test", tool.Name())
	assert.Equal(t, "desc", tool.Description())
	assert.Equal(t, params, tool.Parameters())

	res, err := tool.Execute(context.Background(), "val")
	require.NoError(t, err)
	assert.Equal(t, "val", res["res"])

	schema, ok := tool.ToGatewaySchema().(map[string]any)
	assert.True(t, ok)
	if !ok {
		t.Fatal("expected gateway schema to be a map")
	}
	fn, ok := schema["function"].(map[string]any)
	assert.True(t, ok)
	if !ok {
		t.Fatal("expected function schema to be a map")
	}
	assert.Equal(t, "test", fn["name"])
}

func TestNewBaseToolUsesPromptProviderDescription(t *testing.T) {
	restore := SetToolPromptProvider(testToolPromptProvider{"test": " prompt description "})
	t.Cleanup(restore)

	tool := NewBaseTool("test", "fallback", ToolParameters{}, func(context.Context, string) (ToolResult, error) {
		return ToolResult{}, nil
	})

	assert.Equal(t, "prompt description", tool.Description())
}
