package session

import (
	"context"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
)

func TestParserHelperEdges(t *testing.T) {
	questionArgs := map[string]any{
		"questions": []any{
			"bad-entry",
			map[string]any{
				"header":   "h",
				"question": "q",
				"options":  []any{"bad-option"},
			},
		},
	}
	parsedQuestions, missingQuestions, invalidQuestions := parseQuestionArgs(questionArgs)
	assert.Empty(t, missingQuestions)
	assert.True(t, invalidQuestions)
	assert.Len(t, parsedQuestions.questions, 2)

	questionResult := ExecuteQuestion(protocol.ToolContext{Ctx: context.Background()}, questionArgs)
	assert.Equal(t, "error", questionResult.Status)
	assert.Contains(t, questionResult.Error, "invalid questions")

	todoArgs := map[string]any{
		"todos": []any{
			"bad-entry",
			map[string]any{
				"content":  "c",
				"status":   "pending",
				"priority": "high",
				"id":       123,
			},
		},
	}
	parsedTodos, missingTodos, invalidTodos := parseTodoArgs(todoArgs)
	assert.Empty(t, missingTodos)
	assert.True(t, invalidTodos)
	assert.Len(t, parsedTodos.todos, 2)
	assert.True(t, isMissingString(map[string]any{"id": 123}, "id"))
}
