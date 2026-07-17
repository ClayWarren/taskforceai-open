package session

import (
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
)

func TestToolQuestion(t *testing.T) {
	ctx := protocol.ToolContext{}

	t.Run("basic question", func(t *testing.T) {
		args := map[string]any{
			"questions": []any{
				map[string]any{
					"header":   "Header",
					"question": "How are you?",
					"options":  []any{map[string]any{"label": "Good", "description": "I am good"}},
				},
			},
		}
		res := ExecuteQuestion(ctx, args)
		assert.Equal(t, "completed", res.Status)
		assert.Equal(t, "Question", res.Output)
	})

	t.Run("question with answer set", func(t *testing.T) {
		ctxWithAnswer := protocol.ToolContext{
			QuestionAnswer:    "I am fine",
			QuestionAnswerSet: true,
		}
		args := map[string]any{
			"questions": []any{
				map[string]any{
					"header":   "Status",
					"question": "How are you?",
					"options":  []any{map[string]any{"label": "Good", "description": "Good"}},
				},
			},
		}
		res := ExecuteQuestion(ctxWithAnswer, args)
		assert.Equal(t, "completed", res.Status)
		assert.Contains(t, res.Output, "User has answered")
		assert.Contains(t, res.Output, "I am fine")
	})

	t.Run("missing questions", func(t *testing.T) {
		args := map[string]any{}
		res := ExecuteQuestion(ctx, args)
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "missing questions")
	})

	t.Run("empty questions array is rejected", func(t *testing.T) {
		args := map[string]any{
			"questions": []any{},
		}
		res := ExecuteQuestion(ctx, args)
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "missing questions")
	})
}
