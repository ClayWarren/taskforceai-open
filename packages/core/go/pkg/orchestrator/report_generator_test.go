package orchestrator

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestGenerateReport(t *testing.T) {
	client := new(MockLLMClient)
	cfg := config.Config{}
	generator := NewLLMReportGenerator(client, cfg)

	trace := &ExecutionTrace{
		Goal: "test goal",
	}

	t.Run("trace marshal failure", func(t *testing.T) {
		res, err := generator.GenerateReport(context.Background(), &ExecutionTrace{Plan: func() {}})
		require.Error(t, err)
		assert.Nil(t, res)
		assert.Contains(t, err.Error(), "marshal execution trace")
	})

	t.Run("success", func(t *testing.T) {
		report := ExecutionReport{
			Summary: "Done",
			Rubric: struct {
				Accuracy     int    `json:"accuracy"`
				Completeness int    `json:"completeness"`
				Confidence   int    `json:"confidence"`
				Risk         string `json:"risk"`
				HumanReview  bool   `json:"human_review"`
			}{Accuracy: 5},
		}
		reportJSON, _ := json.Marshal(report)

		client.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
			Choices: []agent.ChatCompletionChoice{
				{Message: agent.ChatCompletionMessage{Content: string(reportJSON)}},
			},
		}, nil).Once()

		res, err := generator.GenerateReport(context.Background(), trace)
		require.NoError(t, err)
		assert.Equal(t, "Done", res.Summary)
		assert.Equal(t, 5, res.Rubric.Accuracy)
	})

	t.Run("llm failure", func(t *testing.T) {
		client.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(nil, fmt.Errorf("api error")).Once()

		res, err := generator.GenerateReport(context.Background(), trace)
		require.Error(t, err)
		assert.Nil(t, res)
		assert.Contains(t, err.Error(), "llm call failed")
	})

	t.Run("json parse failure", func(t *testing.T) {
		client.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
			Choices: []agent.ChatCompletionChoice{
				{Message: agent.ChatCompletionMessage{Content: "not json"}},
			},
		}, nil).Once()

		res, err := generator.GenerateReport(context.Background(), trace)
		require.Error(t, err)
		assert.Nil(t, res)
		assert.Contains(t, err.Error(), "failed to parse json")
	})

	t.Run("markdown json", func(t *testing.T) {
		jsonContent := `{"summary": "Markdown"}`
		content := "Here is the report:\n```json\n" + jsonContent + "\n```"

		client.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
			Choices: []agent.ChatCompletionChoice{
				{Message: agent.ChatCompletionMessage{Content: content}},
			},
		}, nil).Once()

		res, err := generator.GenerateReport(context.Background(), trace)
		require.NoError(t, err)
		assert.Equal(t, "Markdown", res.Summary)
	})
}
