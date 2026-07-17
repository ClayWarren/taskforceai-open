package tools

import (
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
)

// Legacy tool names from the prior port are not registered in enginecore.
func TestExecuteTool_legacyPortToolsReturnNotFound(t *testing.T) {
	ctx := protocol.ToolContext{Ctx: t.Context(), Cwd: t.TempDir()}
	legacy := []string{"ls", "bash", "batch", "nope"}

	for _, name := range legacy {
		t.Run(name, func(t *testing.T) {
			res := ExecuteTool(ctx, name, map[string]any{"path": ".", "command": "echo hi"})
			assert.Equal(t, "error", res.Status)
			assert.Contains(t, res.Error, "tool not found: "+name)
		})
	}
}
