package session

import (
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
)

func TestTodoFamilyDefaultStoreAndMissingArguments(t *testing.T) {
	assert.Equal(t, "error", ExecuteTodoWrite(protocol.ToolContext{}, nil).Status)
	_, missing, invalid := parseTodoArgs(nil)
	assert.Equal(t, []string{"missing todos"}, missing)
	assert.False(t, invalid)

	write := ExecuteTodoWrite(protocol.ToolContext{}, map[string]any{
		"todos": []any{map[string]any{
			"content":  "default store",
			"status":   "pending",
			"priority": "high",
			"id":       "1",
		}},
	})
	assert.Equal(t, "completed", write.Status)
	read := ExecuteTodoRead(protocol.ToolContext{}, nil)
	assert.Equal(t, "completed", read.Status)
	assert.Equal(t, "1 todos", read.Title)
}
