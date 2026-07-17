package orchestrator

import (
	"context"
	"errors"
	"testing"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/cache"
	"github.com/TaskForceAI/core/pkg/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestTaskDecomposer(t *testing.T) {
	mockClient := new(MockLLMClient)
	cfg := config.Config{
		Gateway: config.GatewayConfig{Model: "gpt-4"},
	}
	budgetLimit := 10

	deps := TaskDecomposerDeps{
		Client: mockClient,
		Config: cfg,
		Budget: NewBudgetManager(&budgetLimit),
	}
	decomposer := NewTaskDecomposer(deps)
	ctx := context.Background()

	t.Run("Successful decomposition", func(t *testing.T) {
		mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
			Choices: []agent.ChatCompletionChoice{
				{Message: agent.ChatCompletionMessage{Content: `["task1", "task2"]`}},
			},
		}, nil).Once()

		res, err := decomposer.GenerateSubtasks(ctx, "query", 2)
		require.NoError(t, err)
		assert.Len(t, res, 2)
		assert.Equal(t, "task1", res[0])
	})

	t.Run("Decomposition failure fallback", func(t *testing.T) {
		mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(nil, assert.AnError).Once()

		res, err := decomposer.GenerateSubtasks(ctx, "query", 2)
		require.NoError(t, err) // returns fallback, not error
		assert.Len(t, res, 2)
		assert.Contains(t, res[0], "query")
	})
}

func TestTaskDecomposerCoverageGapPaths(t *testing.T) {
	ctx := context.Background()
	cfg := testConfig()
	cfg.Orchestrator.QuestionGenerationPrompt = "Split {user_input} into {num_agents} tasks"
	cfg.Gateway.Model = "test-model"

	t.Run("skip cache for current data queries and use regex fallback", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		decomposer := NewTaskDecomposer(TaskDecomposerDeps{
			Client:         mockClient,
			Config:         cfg,
			Budget:         NewBudgetManager(nil),
			LLMCache:       cache.NewLLMCache(&MockCache{Data: make(map[string]string)}),
			CacheNamespace: "decompose-gap",
		})

		mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
			Choices: []agent.ChatCompletionChoice{
				{Message: agent.ChatCompletionMessage{Content: "prefix [\"task-a\", \"task-b\"] suffix"}},
			},
		}, nil).Once()

		subtasks, err := decomposer.GenerateSubtasks(ctx, "What is the latest news today?", 2)
		if err != nil {
			t.Fatalf("generate subtasks: %v", err)
		}
		if len(subtasks) != 2 || subtasks[0] != "task-a" {
			t.Fatalf("unexpected subtasks: %#v", subtasks)
		}
	})

	t.Run("empty llm response and invalid json use fallback subtasks", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		decomposer := NewTaskDecomposer(TaskDecomposerDeps{
			Client:         mockClient,
			Config:         cfg,
			Budget:         NewBudgetManager(nil),
			LLMCache:       cache.NewLLMCache(&MockCache{Data: make(map[string]string)}),
			CacheNamespace: "decompose-fallback",
		})

		mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
			Choices: []agent.ChatCompletionChoice{
				{Message: agent.ChatCompletionMessage{Content: "   "}},
			},
		}, nil).Once()

		subtasks, err := decomposer.GenerateSubtasks(ctx, "Plan a project", 1)
		if err != nil {
			t.Fatalf("expected fallback subtasks without error, got %v", err)
		}
		if len(subtasks) != 1 {
			t.Fatalf("expected one fallback subtask, got %#v", subtasks)
		}

		mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
			Choices: []agent.ChatCompletionChoice{
				{Message: agent.ChatCompletionMessage{Content: "[\"only-one\"]"}},
			},
		}, nil).Once()
		subtasks, err = decomposer.GenerateSubtasks(ctx, "Another plan", 2)
		if err != nil {
			t.Fatalf("expected fallback when task count mismatches, got %v", err)
		}
		if len(subtasks) != 2 {
			t.Fatalf("expected fallback subtasks after mismatch, got %#v", subtasks)
		}
	})

	t.Run("llm transport error uses fallback subtasks", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		decomposer := NewTaskDecomposer(TaskDecomposerDeps{
			Client:         mockClient,
			Config:         cfg,
			Budget:         NewBudgetManager(nil),
			CacheNamespace: "decompose-error",
		})
		mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(nil, errors.New("stream failed")).Once()
		subtasks, err := decomposer.GenerateSubtasks(ctx, "Plan safely", 1)
		if err != nil {
			t.Fatalf("expected fallback on stream error, got %v", err)
		}
		if len(subtasks) != 1 {
			t.Fatalf("expected fallback subtask, got %#v", subtasks)
		}
	})

	t.Run("nil budget still runs decomposition", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		decomposer := NewTaskDecomposer(TaskDecomposerDeps{
			Client: mockClient,
			Config: cfg,
		})

		mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
			Choices: []agent.ChatCompletionChoice{
				{Message: agent.ChatCompletionMessage{Content: "[\"task-a\"]"}},
			},
		}, nil).Once()

		subtasks, err := decomposer.GenerateSubtasks(ctx, "Plan safely", 1)
		if err != nil {
			t.Fatalf("generate subtasks without budget: %v", err)
		}
		if len(subtasks) != 1 || subtasks[0] != "task-a" {
			t.Fatalf("unexpected subtasks: %#v", subtasks)
		}
	})
}
