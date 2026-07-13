package tools

import (
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
)

func TestToolInvalid(t *testing.T) {
	res := toolInvalid(protocol.ToolContext{}, nil)
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "invalid tool call")
}
