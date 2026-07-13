package tools

import (
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
)

func TestToolPlan(t *testing.T) {
	t.Run("plan enter", func(t *testing.T) {
		res := toolPlanEnter(protocol.ToolContext{}, nil)
		assert.Equal(t, "error", res.Status)
	})

	t.Run("plan exit", func(t *testing.T) {
		res := toolPlanExit(protocol.ToolContext{}, nil)
		assert.Equal(t, "error", res.Status)
	})
}
