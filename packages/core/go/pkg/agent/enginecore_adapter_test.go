package agent

import (
	"context"
	"testing"

	"github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/core/pkg/tools"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestGatewayAgent_BuildSystemPrompt(t *testing.T) {
	mockClient := new(MockLLMClient)
	cfg := config.Config{
		Gateway:      config.GatewayConfig{Model: "gpt-4"},
		SystemPrompt: "CUSTOM SYSTEM",
	}
	a := NewGatewayAgent(cfg, mockClient, AgentOptions{})

	prompt := a.buildSystemPrompt()
	assert.Contains(t, prompt, "CUSTOM SYSTEM")
	assert.Contains(t, prompt, "Current date:")
	assert.Contains(t, prompt, "older year roundups")
	assert.NotContains(t, prompt, "<env>")
	assert.NotContains(t, prompt, "<files>")
}

func TestGatewayAgent_ModelSpecificPrompt(t *testing.T) {
	mockClient := new(MockLLMClient)
	cfg := config.Config{
		Gateway:      config.GatewayConfig{Model: "model-a"},
		SystemPrompt: "GLOBAL",
		Models: config.ModelsConfig{
			Options: []config.ModelOption{
				{ID: "model-a", SystemPrompt: "MODEL SPECIFIC"},
			},
		},
	}
	a := NewGatewayAgent(cfg, mockClient, AgentOptions{})

	prompt := a.buildSystemPrompt()
	assert.Contains(t, prompt, "MODEL SPECIFIC")
	assert.Contains(t, prompt, "Current date:")
	assert.NotContains(t, prompt, "GLOBAL")
}

func TestGatewayAgent_BuildSystemPromptRaw(t *testing.T) {
	mockClient := new(MockLLMClient)
	cfg := config.Config{
		Gateway:      config.GatewayConfig{Model: "gpt-4"},
		SystemPrompt: "RAW ONLY",
	}
	a := NewGatewayAgent(cfg, mockClient, AgentOptions{
		RawSystemPrompt: true,
	})

	prompt := a.buildSystemPrompt()
	assert.Contains(t, prompt, "RAW ONLY")
	assert.Contains(t, prompt, "Current date:")
	assert.Contains(t, prompt, "news, latest, recent")
}

func TestGatewayAgent_ToolRouting(t *testing.T) {
	mockClient := new(MockLLMClient)
	cfg := config.Config{
		Gateway: config.GatewayConfig{Model: "gpt-4"},
	}

	registry := tools.NewToolRegistry()
	registry.Register(tools.NewBaseTool(
		"test_tool",
		"desc",
		tools.ToolParameters{Type: "object", Properties: map[string]any{}, Required: []string{}},
		func(ctx context.Context, args string) (tools.ToolResult, error) {
			return tools.ToolResult{"content": "ok"}, nil
		},
	))

	var events []ToolEvent
	toolLogger := ToolLogger(func(event ToolEvent) { events = append(events, event) })

	agent := NewGatewayAgent(cfg, mockClient, AgentOptions{
		Registry:   registry,
		ToolLogger: toolLogger,
	})

	mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&ChatCompletion{
		Choices: []ChatCompletionChoice{
			{Message: ChatCompletionMessage{
				Role: RoleAssistant,
				ToolCalls: []ToolCall{
					{
						ID: "call-1",
						Function: ToolCallFunction{
							Name:      "test_tool",
							Arguments: "{}",
						},
					},
				},
			}},
		},
	}, nil).Once()

	mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&ChatCompletion{
		Choices: []ChatCompletionChoice{
			{Message: ChatCompletionMessage{Role: RoleAssistant, Content: "done"}},
		},
	}, nil).Once()

	res, err := agent.Run(context.Background(), "do work", nil)
	require.NoError(t, err)
	assert.Equal(t, "done", res)
	assert.Len(t, events, 2)
	assert.Equal(t, "test_tool", events[0].ToolName)
	assert.Equal(t, "running", events[0].Status)
	assert.True(t, events[0].Success)
	assert.Empty(t, events[0].ResultPreview)
	assert.Equal(t, "test_tool", events[1].ToolName)
	assert.Equal(t, "completed", events[1].Status)
	assert.True(t, events[1].Success)
	assert.Contains(t, events[1].ResultPreview, "ok")
}
