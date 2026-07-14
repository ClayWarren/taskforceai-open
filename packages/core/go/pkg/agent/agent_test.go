package agent

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/core/internal/testsupport/configsource"
	"github.com/TaskForceAI/core/pkg/config"
	enginecoreconfig "github.com/TaskForceAI/core/pkg/enginecore/config"
	enginecore "github.com/TaskForceAI/core/pkg/enginecore/core"
	enginecorepermission "github.com/TaskForceAI/core/pkg/enginecore/permission"
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/tools"
	"github.com/TaskForceAI/core/pkg/tools/google"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

type MockLLMClient struct {
	mock.Mock
}

type testEnginecoreConfigSource = configsource.Source

func (m *MockLLMClient) CreateChatCompletion(ctx context.Context, params ChatCompletionCreateParams) (*ChatCompletion, error) {
	args := m.Called(ctx, params)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	completion, ok := args.Get(0).(*ChatCompletion)
	if !ok {
		return nil, fmt.Errorf("unexpected completion type: %T", args.Get(0))
	}
	return completion, args.Error(1)
}

func (m *MockLLMClient) CreateChatCompletionStream(ctx context.Context, params ChatCompletionCreateParams, onChunk func(ChatCompletionChunk)) error {
	args := m.Called(ctx, params, onChunk)
	return args.Error(0)
}

type mockGoogleDriveClient struct{}

func (mockGoogleDriveClient) ListFiles(context.Context, string) (string, error) {
	return "files", nil
}

func (mockGoogleDriveClient) ReadFile(context.Context, string) (string, error) {
	return "content", nil
}

type panicTool struct{}

func (panicTool) Name() string { return "panic_tool" }

func (panicTool) Description() string { return "panics" }

func (panicTool) Parameters() tools.ToolParameters { return tools.ToolParameters{} }

func (panicTool) Execute(context.Context, string) (tools.ToolResult, error) {
	panic("tool panic")
}

func (panicTool) ToGatewaySchema() any { return nil }

type unmarshalableToolResult struct{}

func (unmarshalableToolResult) MarshalJSON() ([]byte, error) {
	return nil, fmt.Errorf("cannot marshal")
}

type badResultTool struct{}

func (badResultTool) Name() string { return "bad_result" }

func (badResultTool) Description() string { return "bad result" }

func (badResultTool) Parameters() tools.ToolParameters { return tools.ToolParameters{} }

func (badResultTool) Execute(context.Context, string) (tools.ToolResult, error) {
	return tools.ToolResult{"bad": unmarshalableToolResult{}}, nil
}

func (badResultTool) ToGatewaySchema() any { return nil }

type testTeamInbox struct {
	messages map[string][]InboxMessage
}

func newTestTeamInbox(t *testing.T) *testTeamInbox {
	t.Helper()
	return &testTeamInbox{messages: map[string][]InboxMessage{}}
}

func (i *testTeamInbox) Write(teamName, agentName string, msg InboxMessage) {
	key := teamName + "/" + agentName
	i.messages[key] = append(i.messages[key], msg)
}

func (i *testTeamInbox) Unread(teamName, agentName string) ([]InboxMessage, error) {
	return i.messages[teamName+"/"+agentName], nil
}

func (i *testTeamInbox) MarkRead(teamName, agentName string) ([]InboxMessage, error) {
	key := teamName + "/" + agentName
	read := i.messages[key]
	delete(i.messages, key)
	return read, nil
}

type failingMarkReadInbox struct {
	err error
}

func (i failingMarkReadInbox) Unread(string, string) ([]InboxMessage, error) {
	return nil, nil
}

func (i failingMarkReadInbox) MarkRead(string, string) ([]InboxMessage, error) {
	return nil, i.err
}

var _ google.GoogleDriveClient = mockGoogleDriveClient{}

func TestAgentCoverageGapPaths(t *testing.T) {
	t.Run("transcript text falls back to tool activity summary", func(t *testing.T) {
		text := transcriptText(enginecore.Transcript{Messages: []enginecore.Message{{
			Info: enginecore.MessageInfo{Role: enginecore.RoleAssistant},
			Parts: []enginecore.Part{
				{Type: enginecore.PartTool, Tool: "grep"},
				{Type: enginecore.PartTool, Tool: "edit"},
			},
		}}})
		assert.Contains(t, text, "grep")
		assert.Contains(t, text, "edit")
		assert.Contains(t, text, "No summary provided by model")
	})

	t.Run("build tools definition and handler deps include google drive tools", func(t *testing.T) {
		registry := tools.NewToolRegistry()
		registry.Register(tools.NewBaseTool("keep", "kept", tools.ToolParameters{}, nil))
		agent := NewGatewayAgent(
			config.Config{Gateway: config.GatewayConfig{Model: "gpt-4o"}},
			nil,
			AgentOptions{
				Registry:          registry,
				GoogleDriveClient: mockGoogleDriveClient{},
			},
		)
		defs := agent.buildToolsDefinition()
		names := map[string]bool{}
		for _, def := range defs {
			names[def.Function.Name] = true
		}
		assert.True(t, names["keep"])
		assert.True(t, names["google_drive_list"])
		assert.True(t, names["google_drive_read"])

		deps := agent.buildToolHandlerDeps()
		assert.Contains(t, deps.DiscoveredTools, "google_drive_list")
		assert.Contains(t, deps.DiscoveredTools, "google_drive_read")
	})

	t.Run("engine options wrap permission checker with approval registry", func(t *testing.T) {
		repo := new(MockApprovalRegistry)
		agent := NewGatewayAgent(config.Config{}, nil, AgentOptions{
			ApprovalRegistry: repo,
			TaskID:           "task-1",
			AgentName:        "agent-a",
		})
		opts := agent.engineOptions(context.Background())
		if _, ok := opts.Permission.(*HITLPermissionChecker); !ok {
			t.Fatalf("expected HITL permission checker, got %T", opts.Permission)
		}
	})

	t.Run("google drive client type assertion guard", func(t *testing.T) {
		agent := NewGatewayAgent(config.Config{Gateway: config.GatewayConfig{Model: "gpt-4o"}}, nil, AgentOptions{
			GoogleDriveClient: struct{}{},
		})
		defs := agent.buildToolsDefinition()
		assert.Empty(t, defs)
		deps := agent.buildToolHandlerDeps()
		assert.Empty(t, deps.DiscoveredTools)
	})
}

func TestAgentFinalPushTo95CoverageGapPaths(t *testing.T) {
	t.Run("engine options use enginecore permission config when available", func(t *testing.T) {
		restore := enginecoreconfig.SetConfigSource(testEnginecoreConfigSource{
			Snapshot: enginecoreconfig.ConfigSnapshot{
				Documents: []enginecoreconfig.ConfigDocument{{
					Name: "config.json",
					Data: []byte(`{"permission":{"read":"deny"}}`),
				}},
			},
		})
		t.Cleanup(restore)

		agent := NewGatewayAgent(config.Config{}, nil, AgentOptions{})
		opts := agent.engineOptions(context.Background())
		checker, ok := opts.Permission.(*enginecorepermission.RuleBasedPermission)
		require.True(t, ok, "expected rule-based permission from enginecore config")
		err := checker.Ask(protocol.PermissionRequest{Permission: "read", Patterns: []string{"*"}})
		assert.ErrorIs(t, err, enginecorepermission.ErrPermissionDenied)
	})

	t.Run("engine options skip HITL when approval registry is wrong type", func(t *testing.T) {
		agent := NewGatewayAgent(config.Config{}, nil, AgentOptions{
			ApprovalRegistry: struct{}{},
			TaskID:           "task-1",
			AgentName:        "worker",
		})
		opts := agent.engineOptions(context.Background())
		_, ok := opts.Permission.(*HITLPermissionChecker)
		assert.False(t, ok, "expected default permission without HITL wrapper")
	})

	t.Run("generated file requirement detects specialist prompts and tools", func(t *testing.T) {
		assert.False(t, requiresGeneratedFileTool("regular prompt", []ToolDefinition{{
			Function: FunctionDefinition{Name: "create_csv"},
		}}))
		assert.False(t, requiresGeneratedFileTool("file-generation specialist", nil))
		assert.True(t, requiresGeneratedFileTool("file-generation specialist", []ToolDefinition{{
			Function: FunctionDefinition{Name: "create_csv"},
		}}))
	})

	t.Run("hitl approval id defaults blank agent name", func(t *testing.T) {
		repo := new(MockApprovalRegistry)
		checker := NewHITLPermissionChecker(context.Background(), &enginecorepermission.RuleBasedPermission{
			DefaultAction: enginecorepermission.PermissionAsk,
		}, repo, "task-1", "")
		repo.On("RequestApproval", mock.Anything, mock.MatchedBy(func(req ApprovalRequest) bool {
			return strings.HasPrefix(req.ApprovalID, "task-1:agent:")
		})).Return(errors.New("stop")).Once()

		err := checker.Ask(protocol.PermissionRequest{Permission: "write"})
		assert.ErrorContains(t, err, "stop")
	})

	t.Run("cacheable system prompt uses token estimate", func(t *testing.T) {
		assert.False(t, cacheableSystemPrompt(strings.Repeat("short ", 100)))
		assert.True(t, cacheableSystemPrompt(strings.Repeat("word ", 800)))
	})

	t.Run("build initial messages marks long system prompt cacheable", func(t *testing.T) {
		agent := NewGatewayAgent(config.Config{}, nil, AgentOptions{})
		messages := agent.buildInitialMessages(strings.Repeat("word ", 800), "hello", nil)

		require.Len(t, messages, 2)
		require.NotNil(t, messages[0].CacheControl)
		assert.Equal(t, "ephemeral", messages[0].CacheControl.Type)
	})

	t.Run("default tool failure callbacks are callable", func(t *testing.T) {
		agent := NewGatewayAgent(config.Config{}, nil, AgentOptions{})
		deps := agent.buildToolHandlerDeps()
		assert.Equal(t, 0, deps.RegisterToolFailure("noop"))
		deps.ResetToolFailures("noop")
	})
}

func TestAgentGapCoverage(t *testing.T) {
	// Test streaming error when initialising stream
	t.Run("CreateChatCompletionStream Error", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		cfg := config.Config{}
		agent := NewGatewayAgent(cfg, mockClient, AgentOptions{})

		mockClient.On("CreateChatCompletionStream", mock.Anything, mock.Anything, mock.Anything).Return(fmt.Errorf("stream init fail"))

		_, err := agent.Run(context.Background(), "input", func(s string) {})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "streaming failed")
	})

	// Test Run loop max iterations with content
	t.Run("Max Iterations Reached With Content", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		cfg := config.Config{
			Agent: config.AgentConfig{MaxIterations: 1},
		}
		agent := NewGatewayAgent(cfg, mockClient, AgentOptions{})

		// Return response with content, no tool calls.
		mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&ChatCompletion{
			Choices: []ChatCompletionChoice{
				{Message: ChatCompletionMessage{Role: RoleAssistant, Content: "some content"}},
			},
		}, nil)

		res, err := agent.Run(context.Background(), "input", nil)
		require.NoError(t, err)
		assert.Equal(t, "some content", res)
	})
}

func TestAgentMoreCoverageGapPaths(t *testing.T) {
	t.Run("engine options use default allow permission without approval registry", func(t *testing.T) {
		agent := NewGatewayAgent(config.Config{}, nil, AgentOptions{})
		opts := agent.engineOptions(context.Background())
		if opts.Permission == nil {
			t.Fatal("expected default permission checker")
		}
	})

	t.Run("tool error event logs through tool logger", func(t *testing.T) {
		logged := false
		stream := newAgentStream(agentStreamOptions{
			ctx: context.Background(),
			toolLogger: func(event ToolEvent) {
				logged = true
				assert.False(t, event.Success)
				assert.Equal(t, "broken", event.ToolName)
			},
		})
		event, message := stream.toolErrorEvent(ToolCall{
			Function: ToolCallFunction{Name: "broken", Arguments: `{}`},
		}, time.Now(), "failed")
		assert.Equal(t, "error", event.ToolState["status"])
		assert.Contains(t, message, "failed")
		assert.True(t, logged)
	})

	t.Run("sanitize tool result drops image payload", func(t *testing.T) {
		result := sanitizeToolResult(tools.ToolResult{
			"content":      "ok",
			"image_base64": "abc",
		})
		assert.NotContains(t, result, "image_base64")
		assert.Equal(t, "ok", result["content"])
		assert.Nil(t, sanitizeToolResult(nil))
	})

	t.Run("build assistant message uses non streaming client", func(t *testing.T) {
		stream := newAgentStream(agentStreamOptions{
			ctx: context.Background(),
			client: &streamTestClient{
				responses: []ChatCompletionMessage{{Role: RoleAssistant, Content: "answer"}},
			},
		})
		msg, err := stream.getAssistantMessage(ChatCompletionCreateParams{}, nil)
		if err != nil || msg == nil || msg.Content != "answer" {
			t.Fatalf("expected assistant message, got msg=%#v err=%v", msg, err)
		}
	})

	t.Run("team inbox mark read error is non fatal", func(t *testing.T) {
		stream := newAgentStream(agentStreamOptions{
			ctx:           context.Background(),
			client:        &streamTestClient{responses: []ChatCompletionMessage{{Role: RoleAssistant, Content: "answer"}}},
			maxIterations: 1,
			TeamInbox:     failingMarkReadInbox{err: errors.New("mark read failed")},
			TeamName:      "team",
			AgentName:     "agent",
		})

		event, ok, err := stream.Next()
		require.NoError(t, err)
		require.True(t, ok)
		assert.Equal(t, "answer", event.Text)
	})
}

func TestAgentToolFilteringPushTo95CoverageGapPaths(t *testing.T) {
	registry := tools.NewToolRegistry()
	registry.Register(tools.NewBaseTool("search_web", "search", tools.ToolParameters{}, nil))
	registry.Register(tools.NewBaseTool("execute_code", "code", tools.ToolParameters{}, nil))
	registry.Register(tools.NewBaseTool("computer_use", "computer", tools.ToolParameters{}, nil))
	registry.Register(tools.NewBaseTool("keep", "keep", tools.ToolParameters{}, nil))

	agent := NewGatewayAgent(config.Config{Gateway: config.GatewayConfig{Model: "gpt-4o"}}, nil, AgentOptions{
		Registry:             registry,
		WebSearchEnabled:     false,
		CodeExecutionEnabled: false,
		ComputerUseEnabled:   false,
	})

	defs := agent.buildToolsDefinition()
	if len(defs) != 1 || defs[0].Function.Name != "keep" {
		t.Fatalf("expected only enabled tool in definitions, got %#v", defs)
	}

	deps := agent.buildToolHandlerDeps()
	if len(deps.DiscoveredTools) != 1 {
		t.Fatalf("expected one discovered tool, got %d", len(deps.DiscoveredTools))
	}
	if _, ok := deps.DiscoveredTools["keep"]; !ok {
		t.Fatalf("expected keep tool in handler deps, got %#v", deps.DiscoveredTools)
	}
}

func TestEnginecoreStreamCoverageGapPaths(t *testing.T) {
	t.Run("team inbox polling and mark task complete finish early", func(t *testing.T) {
		inbox := newTestTeamInbox(t)
		inbox.Write("team", "agent", InboxMessage{ID: "m1", From: "lead", Text: "update"})

		stream := newAgentStream(agentStreamOptions{
			ctx:           context.Background(),
			client:        &streamTestClient{responses: []ChatCompletionMessage{{Role: RoleAssistant, ToolCalls: []ToolCall{{ID: "done", Function: ToolCallFunction{Name: "mark_task_complete", Arguments: `{}`}}}}}},
			maxIterations: 2,
			TeamInbox:     inbox,
			TeamName:      "team",
			AgentName:     "agent",
			handlerDeps:   &ToolCallHandlerDeps{DiscoveredTools: map[string]tools.ITool{}},
		})

		event, ok, err := stream.Next()
		if err != nil || !ok {
			t.Fatalf("expected streamed team/tool events, ok=%v err=%v", ok, err)
		}
		if event.Type != enginecore.EventText || !strings.Contains(event.Text, "Received message from lead") {
			t.Fatalf("expected team inbox injection event first, got %#v", event)
		}
	})

	t.Run("execute tool call handles nil deps and image follow-up", func(t *testing.T) {
		stream := newAgentStream(agentStreamOptions{
			ctx: context.Background(),
			handlerDeps: &ToolCallHandlerDeps{
				DiscoveredTools: map[string]tools.ITool{
					"shot": streamTestTool{result: tools.ToolResult{"image_base64": "abc123"}},
				},
				LogToolEvent: func(ToolEvent) {},
			},
		})
		res := stream.executeToolCall(nil, ToolCall{ID: "missing-deps", Function: ToolCallFunction{Name: "any", Arguments: `{}`}})
		if res.event.ToolState["status"] != "error" {
			t.Fatalf("expected nil deps error, got %#v", res.event.ToolState)
		}

		res = stream.executeToolCall(stream.opts.handlerDeps, ToolCall{
			ID: "shot",
			Function: ToolCallFunction{
				Name:      "shot",
				Arguments: `{}`,
			},
		})
		if res.imageBase64 != "abc123" {
			t.Fatalf("expected image payload, got %q", res.imageBase64)
		}
	})

	t.Run("get assistant message returns nil when completion has no choices", func(t *testing.T) {
		stream := newAgentStream(agentStreamOptions{
			ctx:    context.Background(),
			client: &streamTestClient{},
		})
		msg, err := stream.getAssistantMessage(ChatCompletionCreateParams{}, nil)
		if err != nil || msg != nil {
			t.Fatalf("expected nil assistant message without error, got msg=%#v err=%v", msg, err)
		}
	})

	t.Run("streaming assistant message returns error from client", func(t *testing.T) {
		stream := newAgentStream(agentStreamOptions{
			ctx:     context.Background(),
			client:  &streamTestClient{streamErr: errors.New("stream down")},
			onChunk: func(string) {},
		})
		if _, err := stream.getAssistantMessageStream(ChatCompletionCreateParams{}, nil); err == nil {
			t.Fatal("expected streaming assistant error")
		}
	})
}

func TestGatewayAgent(t *testing.T) {
	mockClient := new(MockLLMClient)
	cfg := config.Config{
		Gateway: config.GatewayConfig{Model: "gpt-4"},
	}

	// Mock Tools
	registry := tools.NewToolRegistry()
	testTool := tools.NewBaseTool(
		"test_tool",
		"description",
		tools.ToolParameters{Type: "object", Properties: map[string]any{}, Required: []string{}},
		func(ctx context.Context, args string) (tools.ToolResult, error) {
			return tools.ToolResult{"result": "success"}, nil
		},
	)
	registry.Register(testTool)

	// Mock Loggers
	toolLogger := ToolLogger(func(event ToolEvent) {})
	usageLogger := UsageLogger(func(payload UsagePayload) {})

	agent := NewGatewayAgent(cfg, mockClient, AgentOptions{
		AgentLabel:  "test-agent",
		Registry:    registry,
		ToolLogger:  toolLogger,
		UsageLogger: usageLogger,
	})

	t.Run("Basic Run", func(t *testing.T) {
		mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&ChatCompletion{
			Choices: []ChatCompletionChoice{
				{Message: ChatCompletionMessage{Role: RoleAssistant, Content: "Hello world"}},
			},
		}, nil).Once()

		res, err := agent.Run(context.Background(), "hi", nil)
		require.NoError(t, err)
		assert.Equal(t, "Hello world", res)
	})

	t.Run("Streaming Run", func(t *testing.T) {
		mockClient.On("CreateChatCompletionStream", mock.Anything, mock.Anything, mock.Anything).Run(func(args mock.Arguments) {
			onChunk, ok := args.Get(2).(func(ChatCompletionChunk))
			assert.True(t, ok)
			if !ok {
				return
			}
			onChunk(ChatCompletionChunk{Choices: []ChatCompletionChunkChoice{{Delta: ChatCompletionChunkDelta{Content: "Hello"}}}})
			onChunk(ChatCompletionChunk{Choices: []ChatCompletionChunkChoice{{Delta: ChatCompletionChunkDelta{Content: " Stream"}}}})
		}).Return(nil).Once()

		var chunks []string
		res, err := agent.Run(context.Background(), "stream me", func(s string) {
			chunks = append(chunks, s)
		})

		require.NoError(t, err)
		assert.Contains(t, res, "Hello Stream")
		assert.NotEmpty(t, chunks)
	})

	t.Run("Tool Calls", func(t *testing.T) {
		// First call returns tool call
		mockClient.On("CreateChatCompletion", mock.Anything, mock.MatchedBy(func(p ChatCompletionCreateParams) bool {
			return len(p.Messages) == 2 // System + User
		})).Return(&ChatCompletion{
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

		// Second call returns final response
		mockClient.On("CreateChatCompletion", mock.Anything, mock.MatchedBy(func(p ChatCompletionCreateParams) bool {
			return len(p.Messages) > 2 // System + User + Assistant(ToolCall) + ToolResult
		})).Return(&ChatCompletion{
			Choices: []ChatCompletionChoice{
				{Message: ChatCompletionMessage{Role: RoleAssistant, Content: "Task done"}},
			},
		}, nil).Once()

		res, err := agent.Run(context.Background(), "do work", nil)
		require.NoError(t, err)
		assert.Equal(t, "Task done", res)
	})
}

func TestGatewayAgentEngineOptions(t *testing.T) {
	repo := new(MockApprovalRegistry)
	agent := NewGatewayAgent(config.Config{}, nil, AgentOptions{
		TaskID:           "task-1",
		AgentName:        "worker",
		ApprovalRegistry: repo,
	})

	opts := agent.engineOptions(context.Background())
	_, ok := opts.Permission.(*HITLPermissionChecker)
	assert.True(t, ok)

	plain := NewGatewayAgent(config.Config{}, nil, AgentOptions{})
	plainOpts := plain.engineOptions(context.Background())
	_, ok = plainOpts.Permission.(*enginecorepermission.RuleBasedPermission)
	assert.True(t, ok)
	assert.NotNil(t, plainOpts.Instruction)
}

func TestGatewayAgentHelpers(t *testing.T) {
	t.Run("provider model parsing", func(t *testing.T) {
		assert.Equal(t, "openai", parseProviderModel("openai/gpt-4").ProviderID)
		assert.Equal(t, "gpt-4", parseProviderModel("openai/gpt-4").ModelID)
		assert.Equal(t, protocol.DefaultProviderID, parseProviderModel("").ProviderID)
		assert.Equal(t, protocol.DefaultModelID, parseProviderModel("").ModelID)
		assert.Equal(t, protocol.DefaultProviderID, parseProviderModel("gpt-4o").ProviderID)
		assert.Equal(t, "gpt-4o", parseProviderModel("gpt-4o").ModelID)
	})

	t.Run("system and filtering helpers", func(t *testing.T) {
		assert.Nil(t, systemSlice("   "))
		assert.Equal(t, []string{"sys"}, systemSlice("sys"))
		assert.Equal(t, []string{"a", " b "}, filterEmpty([]string{"", "a", "   ", " b "}))
	})

	t.Run("agent defaults and tool maps", func(t *testing.T) {
		registry := tools.NewToolRegistry()
		registry.Register(tools.NewBaseTool("search_web", "search", tools.ToolParameters{}, nil))
		registry.Register(tools.NewBaseTool("calculate", "calc", tools.ToolParameters{}, nil))
		registry.Register(tools.NewBaseTool("computer_use", "computer", tools.ToolParameters{}, nil))
		registry.Register(tools.NewBaseTool("keep", "kept", tools.ToolParameters{}, nil))

		agent := NewGatewayAgent(
			config.Config{Gateway: config.GatewayConfig{Model: "gemini-2.5-flash-image-preview"}},
			nil,
			AgentOptions{Registry: registry},
		)
		assert.Equal(t, 5, agent.maxIterations())
		assert.Nil(t, agent.buildToolsDefinition())

		agent.config.Gateway.Model = "gpt-4o"
		defs := agent.buildToolsDefinition()
		assert.Len(t, defs, 1)
		assert.Equal(t, "keep", defs[0].Function.Name)

		deps := agent.buildToolHandlerDeps()
		assert.Contains(t, deps.DiscoveredTools, "keep")
		assert.NotContains(t, deps.DiscoveredTools, "search_web")
		assert.NotContains(t, deps.DiscoveredTools, "calculate")
		assert.NotContains(t, deps.DiscoveredTools, "computer_use")
	})
}

// Mock Approval Registry
type MockApprovalRegistry struct {
	mock.Mock
}

func (m *MockApprovalRegistry) RequestApproval(ctx context.Context, req ApprovalRequest) error {
	args := m.Called(ctx, req)
	return args.Error(0)
}

func (m *MockApprovalRegistry) WaitForDecision(ctx context.Context, approvalID string) (bool, error) {
	args := m.Called(ctx, approvalID)
	return args.Bool(0), args.Error(1)
}

func (m *MockApprovalRegistry) WaitForExecutionDecision(ctx context.Context, approvalID string) (map[string]any, error) {
	args := m.Called(ctx, approvalID)
	result, _ := args.Get(0).(map[string]any)
	return result, args.Error(1)
}

func (m *MockApprovalRegistry) ClearApproval(ctx context.Context, approvalID string) error {
	args := m.Called(ctx, approvalID)
	return args.Error(0)
}

func TestGatewayAgent_RunMultimodal(t *testing.T) {
	mockClient := new(MockLLMClient)
	cfg := config.Config{Gateway: config.GatewayConfig{Model: "gpt-4"}}

	agent := NewGatewayAgent(cfg, mockClient, AgentOptions{
		AgentLabel: "multimodal-agent",
	})

	mockClient.On("CreateChatCompletion", mock.Anything, mock.MatchedBy(func(p ChatCompletionCreateParams) bool {
		if len(p.Messages) != 2 {
			return false
		}
		userMsg := p.Messages[1]
		return len(userMsg.ContentParts) == 3 // Text + 2 images
	})).Return(&ChatCompletion{
		Choices: []ChatCompletionChoice{{Message: ChatCompletionMessage{Role: RoleAssistant, Content: "I see the images."}}},
	}, nil).Once()

	images := []ContentPart{
		{Type: ContentPartImageURL, ImageURL: &ImageURLPart{URL: "img1"}},
		{Type: ContentPartImageURL, ImageURL: &ImageURLPart{URL: "img2"}},
	}
	res, err := agent.RunMultimodal(context.Background(), "look at these", images, nil)
	require.NoError(t, err)
	assert.Equal(t, "I see the images.", res)
}

func TestGatewayAgent_ToolFiltering(t *testing.T) {
	mockClient := new(MockLLMClient)
	cfg := config.Config{Gateway: config.GatewayConfig{Model: "gpt-4"}}
	registry := tools.NewToolRegistry()

	// Register controllable tools
	registry.Register(tools.NewBaseTool("search_web", "desc", tools.ToolParameters{}, nil))
	registry.Register(tools.NewBaseTool("execute_code", "desc", tools.ToolParameters{}, nil))
	registry.Register(tools.NewBaseTool("always_available", "desc", tools.ToolParameters{}, nil))

	t.Run("All Tools Enabled", func(t *testing.T) {
		agent := NewGatewayAgent(cfg, mockClient, AgentOptions{
			Registry:             registry,
			WebSearchEnabled:     true,
			CodeExecutionEnabled: true,
		})

		mockClient.On("CreateChatCompletion", mock.Anything, mock.MatchedBy(func(p ChatCompletionCreateParams) bool {
			// Should have all 3 tools
			return len(p.Tools) == 3
		})).Return(&ChatCompletion{
			Choices: []ChatCompletionChoice{{Message: ChatCompletionMessage{Content: "ok"}}},
		}, nil).Once()

		_, _ = agent.Run(context.Background(), "hi", nil)
	})

	t.Run("Web Search Disabled", func(t *testing.T) {
		agent := NewGatewayAgent(cfg, mockClient, AgentOptions{
			Registry:             registry,
			WebSearchEnabled:     false,
			CodeExecutionEnabled: true,
		})

		mockClient.On("CreateChatCompletion", mock.Anything, mock.MatchedBy(func(p ChatCompletionCreateParams) bool {
			// Should NOT have search_web, but have others (2 tools)
			hasSearch := false
			for _, t := range p.Tools {
				if t.Function.Name == "search_web" {
					hasSearch = true
				}
			}
			return !hasSearch && len(p.Tools) == 2
		})).Return(&ChatCompletion{
			Choices: []ChatCompletionChoice{{Message: ChatCompletionMessage{Content: "ok"}}},
		}, nil).Once()

		_, _ = agent.Run(context.Background(), "hi", nil)
	})

	t.Run("Code Execution Disabled", func(t *testing.T) {
		agent := NewGatewayAgent(cfg, mockClient, AgentOptions{
			Registry:             registry,
			WebSearchEnabled:     true,
			CodeExecutionEnabled: false,
		})

		mockClient.On("CreateChatCompletion", mock.Anything, mock.MatchedBy(func(p ChatCompletionCreateParams) bool {
			// Should NOT have execute_code, but have others
			hasCode := false
			for _, t := range p.Tools {
				if t.Function.Name == "execute_code" {
					hasCode = true
				}
			}
			return !hasCode && len(p.Tools) == 2
		})).Return(&ChatCompletion{
			Choices: []ChatCompletionChoice{{Message: ChatCompletionMessage{Content: "ok"}}},
		}, nil).Once()

		_, _ = agent.Run(context.Background(), "hi", nil)
	})
}

func TestHITLPermissionChecker(t *testing.T) {
	repo := new(MockApprovalRegistry)
	ctx := context.Background()
	req := protocol.PermissionRequest{Permission: "write", Patterns: []string{"file.txt"}}

	checker := NewHITLPermissionChecker(ctx, &enginecorepermission.RuleBasedPermission{
		DefaultAction: enginecorepermission.PermissionAsk,
	}, repo, "task-123", "agent-x")

	t.Run("Ask User - Approved", func(t *testing.T) {
		var approvalID string
		repo.On("RequestApproval", mock.Anything, mock.MatchedBy(func(req ApprovalRequest) bool {
			approvalID = req.ApprovalID
			return strings.HasPrefix(req.ApprovalID, "task-123:agent-x:")
		})).Return(nil).Once()
		repo.On("WaitForDecision", mock.Anything, mock.MatchedBy(func(id string) bool {
			return id == approvalID && strings.HasPrefix(id, "task-123:agent-x:")
		})).Return(true, nil).Once()
		repo.On("ClearApproval", mock.Anything, mock.MatchedBy(func(id string) bool {
			return id == approvalID && strings.HasPrefix(id, "task-123:agent-x:")
		})).Return(nil).Once()

		err := checker.Ask(req)
		assert.NoError(t, err)
	})

	t.Run("Ask User - Denied", func(t *testing.T) {
		var approvalID string
		repo.On("RequestApproval", mock.Anything, mock.MatchedBy(func(req ApprovalRequest) bool {
			approvalID = req.ApprovalID
			return strings.HasPrefix(req.ApprovalID, "task-123:agent-x:")
		})).Return(nil).Once()
		repo.On("WaitForDecision", mock.Anything, mock.MatchedBy(func(id string) bool {
			return id == approvalID && strings.HasPrefix(id, "task-123:agent-x:")
		})).Return(false, nil).Once()
		repo.On("ClearApproval", mock.Anything, mock.MatchedBy(func(id string) bool {
			return id == approvalID && strings.HasPrefix(id, "task-123:agent-x:")
		})).Return(nil).Once()

		err := checker.Ask(req)
		assert.ErrorContains(t, err, "user denied")
	})

	t.Run("base nil allows", func(t *testing.T) {
		nilChecker := NewHITLPermissionChecker(ctx, nil, repo, "task-123", "agent-x")
		assert.NoError(t, nilChecker.Ask(req))
	})

	t.Run("base allow skips approval", func(t *testing.T) {
		allowChecker := NewHITLPermissionChecker(ctx, &enginecorepermission.RuleBasedPermission{
			DefaultAction: enginecorepermission.PermissionAllow,
		}, repo, "task-123", "agent-x")
		assert.NoError(t, allowChecker.Ask(req))
	})

	t.Run("request approval error propagates", func(t *testing.T) {
		repo.On("RequestApproval", mock.Anything, mock.MatchedBy(func(req ApprovalRequest) bool {
			return strings.HasPrefix(req.ApprovalID, "task-123:agent-x:")
		})).Return(errors.New("request failed")).Once()
		err := checker.Ask(req)
		assert.ErrorContains(t, err, "request failed")
	})

	t.Run("decision error propagates", func(t *testing.T) {
		var approvalID string
		repo.On("RequestApproval", mock.Anything, mock.MatchedBy(func(req ApprovalRequest) bool {
			approvalID = req.ApprovalID
			return strings.HasPrefix(req.ApprovalID, "task-123:agent-x:")
		})).Return(nil).Once()
		repo.On("WaitForDecision", mock.Anything, mock.MatchedBy(func(id string) bool {
			return id == approvalID && strings.HasPrefix(id, "task-123:agent-x:")
		})).Return(false, errors.New("decision failed")).Once()
		repo.On("ClearApproval", mock.Anything, mock.MatchedBy(func(id string) bool {
			return id == approvalID && strings.HasPrefix(id, "task-123:agent-x:")
		})).Return(nil).Once()
		err := checker.Ask(req)
		assert.ErrorContains(t, err, "decision failed")
	})

	t.Run("missing registry returns error", func(t *testing.T) {
		missingRegistry := NewHITLPermissionChecker(ctx, &enginecorepermission.RuleBasedPermission{
			DefaultAction: enginecorepermission.PermissionAsk,
		}, nil, "task-123", "agent-x")
		err := missingRegistry.Ask(req)
		assert.ErrorContains(t, err, "no registry available")
	})
}
