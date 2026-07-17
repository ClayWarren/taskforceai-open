package agent

import (
	"context"
	"errors"
	"strings"
	"testing"

	enginecore "github.com/TaskForceAI/core/pkg/enginecore/core"
	"github.com/TaskForceAI/core/pkg/tools"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type streamTestClient struct {
	responses []ChatCompletionMessage
	streamErr error
}

func (c *streamTestClient) CreateChatCompletion(context.Context, ChatCompletionCreateParams) (*ChatCompletion, error) {
	if len(c.responses) == 0 {
		return &ChatCompletion{}, nil
	}
	msg := c.responses[0]
	c.responses = c.responses[1:]
	return &ChatCompletion{
		Choices: []ChatCompletionChoice{{Message: msg}},
		Usage:   ChatCompletionUsage{TotalTokens: 1},
	}, nil
}

func (c *streamTestClient) CreateChatCompletionStream(_ context.Context, _ ChatCompletionCreateParams, onChunk func(ChatCompletionChunk)) error {
	if c.streamErr != nil {
		return c.streamErr
	}
	zero := 0
	onChunk(ChatCompletionChunk{Usage: &ChatCompletionUsage{TotalTokens: 1}})
	onChunk(ChatCompletionChunk{Choices: []ChatCompletionChunkChoice{{Delta: ChatCompletionChunkDelta{Content: "hello", Reasoning: "because"}}}})
	onChunk(ChatCompletionChunk{Choices: []ChatCompletionChunkChoice{{Delta: ChatCompletionChunkDelta{ToolCalls: []ToolCall{{
		Index: &zero,
		ID:    "call-1",
		Type:  "function",
		Function: ToolCallFunction{
			Name:      "create_chart",
			Arguments: `{"x":`,
		},
	}}}}}})
	onChunk(ChatCompletionChunk{Choices: []ChatCompletionChunkChoice{{Delta: ChatCompletionChunkDelta{ToolCalls: []ToolCall{{
		Index: &zero,
		Function: ToolCallFunction{
			Arguments: `1}`,
		},
	}}}}}})
	return nil
}

type streamTestTool struct {
	result tools.ToolResult
	err    error
}

func (t streamTestTool) Name() string        { return "create_chart" }
func (t streamTestTool) Description() string { return "test tool" }
func (t streamTestTool) Parameters() tools.ToolParameters {
	return tools.ToolParameters{Type: "object"}
}
func (t streamTestTool) Execute(context.Context, string) (tools.ToolResult, error) {
	return t.result, t.err
}
func (t streamTestTool) ToGatewaySchema() any { return nil }

type pushStreamClient struct {
	responses     []ChatCompletionMessage
	completionErr error
}

func (c *pushStreamClient) CreateChatCompletion(context.Context, ChatCompletionCreateParams) (*ChatCompletion, error) {
	if c.completionErr != nil {
		return nil, c.completionErr
	}
	if len(c.responses) == 0 {
		return &ChatCompletion{Choices: []ChatCompletionChoice{}}, nil
	}
	msg := c.responses[0]
	c.responses = c.responses[1:]
	return &ChatCompletion{Choices: []ChatCompletionChoice{{Message: msg}}}, nil
}

func (c *pushStreamClient) CreateChatCompletionStream(context.Context, ChatCompletionCreateParams, func(ChatCompletionChunk)) error {
	return errors.New("streaming disabled in push test")
}

type recordingStreamClient struct {
	responses []ChatCompletionMessage
	params    []ChatCompletionCreateParams
}

func (c *recordingStreamClient) CreateChatCompletion(_ context.Context, params ChatCompletionCreateParams) (*ChatCompletion, error) {
	c.params = append(c.params, params)
	if len(c.responses) == 0 {
		return &ChatCompletion{Choices: []ChatCompletionChoice{}}, nil
	}
	msg := c.responses[0]
	c.responses = c.responses[1:]
	return &ChatCompletion{Choices: []ChatCompletionChoice{{Message: msg}}}, nil
}

func (c *recordingStreamClient) CreateChatCompletionStream(context.Context, ChatCompletionCreateParams, func(ChatCompletionChunk)) error {
	return errors.New("streaming disabled in recording test")
}

func TestAgentStreamBuildsEventsForTextToolAndFinish(t *testing.T) {
	client := &streamTestClient{responses: []ChatCompletionMessage{
		{
			Role:    RoleAssistant,
			Content: "working",
			ToolCalls: []ToolCall{{
				ID: "call-1",
				Function: ToolCallFunction{
					Name:      "create_chart",
					Arguments: `{"x":1}`,
				},
			}},
		},
		{Role: RoleAssistant, Content: "done"},
	}}
	var usageLogged bool
	var toolLogged bool
	var loggedToolEvents []ToolEvent
	stream := newAgentStream(agentStreamOptions{
		ctx:           context.Background(),
		client:        client,
		model:         "model-a",
		maxIterations: 3,
		usageLogger: func(UsagePayload) {
			usageLogged = true
		},
		toolLogger: func(event ToolEvent) {
			toolLogged = true
			loggedToolEvents = append(loggedToolEvents, event)
		},
		handlerDeps: &ToolCallHandlerDeps{
			DiscoveredTools: map[string]tools.ITool{
				"create_chart": streamTestTool{result: tools.ToolResult{
					"content":      "tool output",
					"title":        "Tool A",
					"metadata":     map[string]any{"ok": true},
					"attachments":  []map[string]any{{"path": "file.txt"}},
					"image_base64": "abc",
				}},
			},
			LogToolEvent: func(event ToolEvent) {
				toolLogged = true
				loggedToolEvents = append(loggedToolEvents, event)
			},
		},
	})

	var events []enginecore.Event
	for {
		event, ok, err := stream.Next()
		if err != nil {
			t.Fatalf("unexpected stream error: %v", err)
		}
		if !ok {
			break
		}
		events = append(events, event)
	}

	if len(events) != 4 {
		t.Fatalf("expected text, tool, text, finish events, got %#v", events)
	}
	if events[1].Type != enginecore.EventTool || events[1].ToolState["screenshot"] == nil {
		t.Fatalf("expected tool event with screenshot state: %#v", events[1])
	}
	if !usageLogged || !toolLogged {
		t.Fatalf("expected usage and tool loggers to run")
	}
	var completedWithImage bool
	for _, event := range loggedToolEvents {
		if event.Status == "completed" && event.ImageBase64 == "abc" {
			completedWithImage = true
			break
		}
	}
	if !completedWithImage {
		t.Fatalf("expected completed tool event to carry screenshot for UI theater: %#v", loggedToolEvents)
	}
}

func TestAgentStreamRequiresGeneratedFileTool(t *testing.T) {
	client := &pushStreamClient{responses: []ChatCompletionMessage{
		{Role: RoleAssistant, Content: "I can't directly create or save files, but you can paste this into Excel."},
		{
			Role: RoleAssistant,
			ToolCalls: []ToolCall{{
				ID: "call-spreadsheet",
				Function: ToolCallFunction{
					Name:      "create_spreadsheet",
					Arguments: `{"filePath":"sunlight.xlsx","sheets":[{"name":"Planets","rows":[["Planet"],["Earth"]]}]}`,
				},
			}},
		},
		{Role: RoleAssistant, Content: "Created sunlight.xlsx."},
	}}
	tool := tools.NewBaseTool(
		"create_spreadsheet",
		"Create a downloadable Excel .xlsx spreadsheet file.",
		tools.ToolParameters{Type: "object"},
		func(context.Context, string) (tools.ToolResult, error) {
			return tools.ToolResult{
				"success": true,
				"content": "Spreadsheet created successfully at sunlight.xlsx",
				"generated_file": map[string]any{
					"filename":   "sunlight.xlsx",
					"mime_type":  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
					"local_path": "/tmp/taskforceai-generated-files/sunlight.xlsx",
				},
			}, nil
		},
	)
	stream := newAgentStream(agentStreamOptions{
		ctx:                      context.Background(),
		client:                   client,
		model:                    "model-a",
		maxIterations:            4,
		requireGeneratedFileTool: true,
		tools:                    []ToolDefinition{{Function: FunctionDefinition{Name: "create_spreadsheet"}}},
		handlerDeps: &ToolCallHandlerDeps{
			DiscoveredTools: map[string]tools.ITool{"create_spreadsheet": tool},
		},
	})

	var events []enginecore.Event
	for {
		event, ok, err := stream.Next()
		if err != nil {
			t.Fatalf("unexpected stream error: %v", err)
		}
		if !ok {
			break
		}
		events = append(events, event)
	}

	var sawTool bool
	var text strings.Builder
	for _, event := range events {
		if event.Type == enginecore.EventTool && event.Tool != nil && event.Tool.Name == "create_spreadsheet" {
			sawTool = true
		}
		if event.Type == enginecore.EventText {
			text.WriteString(event.Text)
		}
	}
	if !sawTool {
		t.Fatalf("expected create_spreadsheet tool event, got %#v", events)
	}
	if strings.Contains(text.String(), "paste this into Excel") {
		t.Fatalf("refusal text should not be emitted, got %q", text.String())
	}
	if !strings.Contains(text.String(), "Created sunlight.xlsx") {
		t.Fatalf("expected final generated file summary, got %q", text.String())
	}
}

func TestAgentStreamGeneratedFileCorrectionAddsToolResponsesForSkippedCalls(t *testing.T) {
	client := &recordingStreamClient{responses: []ChatCompletionMessage{{
		Role:    RoleAssistant,
		Content: "I found data, but cannot create a file.",
		ToolCalls: []ToolCall{{
			ID: "call-search",
			Function: ToolCallFunction{
				Name:      "search_web",
				Arguments: `{"query":"data"}`,
			},
		}},
	}}}
	stream := newAgentStream(agentStreamOptions{
		ctx:                      context.Background(),
		client:                   client,
		model:                    "model-a",
		maxIterations:            2,
		requireGeneratedFileTool: true,
	})

	_, _, err := stream.Next()
	require.ErrorContains(t, err, "generated file tool was required")
	require.Len(t, client.params, 2)
	messages := client.params[1].Messages
	require.GreaterOrEqual(t, len(messages), 3)

	assistant := messages[len(messages)-3]
	tool := messages[len(messages)-2]
	correction := messages[len(messages)-1]
	assert.Equal(t, RoleAssistant, assistant.Role)
	assert.Len(t, assistant.ToolCalls, 1)
	assert.Equal(t, RoleTool, tool.Role)
	assert.Equal(t, "call-search", tool.ToolID)
	assert.Contains(t, tool.Content, `"skipped":true`)
	assert.Equal(t, RoleUser, correction.Role)
	assert.Equal(t, generatedFileToolRequiredCorrection(), correction.Content)
}

func TestAgentStreamSkippedMarkTaskCompleteAddsToolResponseBeforeCorrection(t *testing.T) {
	searchTool := tools.NewBaseTool(
		"search_web",
		"search",
		tools.ToolParameters{Type: "object"},
		func(_ context.Context, args string) (tools.ToolResult, error) {
			return tools.ToolResult{"success": true, "content": "search done"}, nil
		},
	)
	client := &recordingStreamClient{responses: []ChatCompletionMessage{{
		Role: RoleAssistant,
		ToolCalls: []ToolCall{
			{
				ID: "call-done",
				Function: ToolCallFunction{
					Name:      "mark_task_complete",
					Arguments: `{"completion_message":"done"}`,
				},
			},
			{
				ID: "call-search",
				Function: ToolCallFunction{
					Name:      "search_web",
					Arguments: `{"query":"data"}`,
				},
			},
		},
	}}}
	stream := newAgentStream(agentStreamOptions{
		ctx:                      context.Background(),
		client:                   client,
		model:                    "model-a",
		maxIterations:            2,
		requireGeneratedFileTool: true,
		handlerDeps: &ToolCallHandlerDeps{
			DiscoveredTools: map[string]tools.ITool{"search_web": searchTool},
		},
	})

	_, _, err := stream.Next()
	require.ErrorContains(t, err, "generated file tool was required")
	require.Len(t, client.params, 2)
	messages := client.params[1].Messages
	require.GreaterOrEqual(t, len(messages), 4)

	assert.Equal(t, RoleAssistant, messages[len(messages)-4].Role)
	assert.Equal(t, RoleTool, messages[len(messages)-3].Role)
	assert.Equal(t, "call-done", messages[len(messages)-3].ToolID)
	assert.Equal(t, RoleTool, messages[len(messages)-2].Role)
	assert.Equal(t, "call-search", messages[len(messages)-2].ToolID)
	assert.Equal(t, RoleUser, messages[len(messages)-1].Role)
	assert.Equal(t, generatedFileToolRequiredCorrection(), messages[len(messages)-1].Content)
}

func TestAgentStreamRequiresGeneratedFileArtifactNotJustToolName(t *testing.T) {
	client := &pushStreamClient{responses: []ChatCompletionMessage{
		{
			Role: RoleAssistant,
			ToolCalls: []ToolCall{{
				ID: "call-spreadsheet",
				Function: ToolCallFunction{
					Name:      "create_spreadsheet",
					Arguments: `{"filePath":"sunlight.xlsx","sheets":[{"name":"Planets","rows":[["Planet"],["Earth"]]}]}`,
				},
			}},
		},
		{
			Role: RoleAssistant,
			ToolCalls: []ToolCall{{
				ID: "call-complete",
				Function: ToolCallFunction{
					Name:      "mark_task_complete",
					Arguments: `{"completion_message":"Done"}`,
				},
			}},
		},
	}}
	tool := tools.NewBaseTool(
		"create_spreadsheet",
		"Create a downloadable Excel .xlsx spreadsheet file.",
		tools.ToolParameters{Type: "object"},
		func(context.Context, string) (tools.ToolResult, error) {
			return tools.ToolResult{
				"success": true,
				"content": "Spreadsheet created successfully at sunlight.xlsx",
			}, nil
		},
	)
	stream := newAgentStream(agentStreamOptions{
		ctx:                      context.Background(),
		client:                   client,
		model:                    "model-a",
		maxIterations:            3,
		requireGeneratedFileTool: true,
		tools:                    []ToolDefinition{{Function: FunctionDefinition{Name: "create_spreadsheet"}}},
		handlerDeps: &ToolCallHandlerDeps{
			DiscoveredTools: map[string]tools.ITool{"create_spreadsheet": tool},
		},
	})

	for {
		_, ok, err := stream.Next()
		if errors.Is(err, errGeneratedFileToolNotCalled) {
			return
		}
		if err != nil {
			t.Fatalf("unexpected stream error: %v", err)
		}
		if !ok {
			break
		}
	}

	t.Fatal("expected generated-file enforcement error when tool produced no generated_file artifact")
}

func TestAgentStreamErrorBranches(t *testing.T) {
	stream := newAgentStream(agentStreamOptions{})
	if _, _, err := stream.Next(); !errors.Is(err, errAgentStreamNilContext) {
		t.Fatalf("expected nil context error, got %v", err)
	}

	stream = newAgentStream(agentStreamOptions{
		ctx:           context.Background(),
		client:        &streamTestClient{responses: []ChatCompletionMessage{{Role: RoleAssistant, ToolCalls: []ToolCall{{ID: "call-1", Function: ToolCallFunction{Name: "missing", Arguments: `{}`}}}}}},
		maxIterations: 1,
		handlerDeps:   &ToolCallHandlerDeps{DiscoveredTools: map[string]tools.ITool{}},
	})
	event, ok, err := stream.Next()
	if err != nil || !ok || event.ToolState["status"] != "error" {
		t.Fatalf("expected unknown tool error event, ok=%v err=%v event=%#v", ok, err, event)
	}

	stream = newAgentStream(agentStreamOptions{
		ctx:           context.Background(),
		client:        &streamTestClient{responses: []ChatCompletionMessage{{Role: RoleAssistant, ToolCalls: []ToolCall{{ID: "call-1", Function: ToolCallFunction{Name: "create_chart", Arguments: `{}`}}}}}},
		maxIterations: 1,
		handlerDeps: &ToolCallHandlerDeps{DiscoveredTools: map[string]tools.ITool{
			"create_chart": streamTestTool{err: errors.New("failed")},
		}},
	})
	event, ok, err = stream.Next()
	if err != nil || !ok || event.ToolState["status"] != "error" {
		t.Fatalf("expected execution error event, ok=%v err=%v event=%#v", ok, err, event)
	}
}

func TestAgentStreamStreamingBuildsAssistantMessage(t *testing.T) {
	var chunks []string
	var reasoning []string
	var toolEvents []ToolEvent
	var usageLogged bool
	stream := newAgentStream(agentStreamOptions{
		ctx:           context.Background(),
		client:        &streamTestClient{},
		model:         "model-a",
		maxIterations: 1,
		onChunk: func(value string) {
			chunks = append(chunks, value)
		},
		onReasoning: func(value string) {
			reasoning = append(reasoning, value)
		},
		usageLogger: func(UsagePayload) {
			usageLogged = true
		},
		toolLogger: func(event ToolEvent) {
			toolEvents = append(toolEvents, event)
		},
		handlerDeps: &ToolCallHandlerDeps{DiscoveredTools: map[string]tools.ITool{}},
	})

	event, ok, err := stream.Next()
	if err != nil || !ok {
		t.Fatalf("expected streamed event, ok=%v err=%v", ok, err)
	}
	if event.Text != "hello" || event.Reasoning != "because" {
		t.Fatalf("unexpected streamed event: %#v", event)
	}
	if len(chunks) != 1 || len(reasoning) != 1 || !usageLogged {
		t.Fatalf("expected chunk, reasoning, and usage callbacks")
	}
	if len(toolEvents) == 0 {
		t.Fatalf("expected live streamed tool event, got %#v", toolEvents)
	}
	if toolEvents[0].InvocationID != "call-1" || toolEvents[0].ToolName != "create_chart" {
		t.Fatalf("unexpected live streamed tool event identity: %#v", toolEvents[0])
	}
	if toolEvents[0].Status != "running" {
		t.Fatalf("expected live streamed tool event to be running: %#v", toolEvents[0])
	}
	if toolEvents[0].Arguments != `{"x":1}` {
		t.Fatalf("unexpected live streamed tool arguments: %#v", toolEvents[0].Arguments)
	}

	stream = newAgentStream(agentStreamOptions{
		ctx:     context.Background(),
		client:  &streamTestClient{streamErr: errors.New("down")},
		onChunk: func(string) {},
	})
	if _, _, err := stream.Next(); err == nil {
		t.Fatalf("expected streaming error")
	}
}

func TestAgentStreamStreamingChunksIncludePriorResponses(t *testing.T) {
	var chunks []string
	var fullContent strings.Builder
	var fullReasoning strings.Builder
	var fullToolCalls []ToolCall
	visibleContent := newStreamedVisibleContent([]string{"first", "second"})
	stream := newAgentStream(agentStreamOptions{
		ctx: context.Background(),
		onChunk: func(value string) {
			chunks = append(chunks, value)
		},
	})

	stream.processChunkChoice(
		&ChatCompletionChunkChoice{Delta: ChatCompletionChunkDelta{Content: "hello"}},
		&fullContent,
		&fullReasoning,
		visibleContent,
		&fullToolCalls,
	)
	stream.processChunkChoice(
		&ChatCompletionChunkChoice{Delta: ChatCompletionChunkDelta{Content: " world"}},
		&fullContent,
		&fullReasoning,
		visibleContent,
		&fullToolCalls,
	)

	assert.Equal(t, []string{
		"first\n\nsecond\n\nhello",
		"first\n\nsecond\n\nhello world",
	}, chunks)
}

var benchmarkStreamChunkSink string

func BenchmarkAgentStreamProcessChunkChoiceWithPriorResponses(b *testing.B) {
	priorResponses := []string{
		strings.Repeat("previous assistant response one ", 80),
		strings.Repeat("previous assistant response two ", 80),
		strings.Repeat("previous assistant response three ", 80),
	}
	choice := ChatCompletionChunkChoice{Delta: ChatCompletionChunkDelta{Content: "chunk "}}

	b.ReportAllocs()
	for b.Loop() {
		var fullContent strings.Builder
		var fullReasoning strings.Builder
		var fullToolCalls []ToolCall
		visibleContent := newStreamedVisibleContent(priorResponses)
		stream := newAgentStream(agentStreamOptions{
			ctx: context.Background(),
			onChunk: func(value string) {
				benchmarkStreamChunkSink = value
			},
		})
		for range 500 {
			stream.processChunkChoice(&choice, &fullContent, &fullReasoning, visibleContent, &fullToolCalls)
		}
	}
}

func TestAgentStreamRepairsMissingSearchQueryFromUserTask(t *testing.T) {
	var executedArgs string
	searchTool := tools.NewBaseTool(
		"search_web",
		"search",
		tools.ToolParameters{Type: "object"},
		func(_ context.Context, args string) (tools.ToolResult, error) {
			executedArgs = args
			return tools.ToolResult{
				"results": []tools.SearchResultItem{{
					Title: "AI news",
					URL:   "https://example.com/ai-news",
				}},
			}, nil
		},
	)
	var toolEvents []ToolEvent
	stream := newAgentStream(agentStreamOptions{
		ctx: context.Background(),
		messages: []ChatCompletionMessage{{
			Role:    RoleUser,
			Content: "Biggest news in AI",
		}},
		toolLogger: func(event ToolEvent) {
			toolEvents = append(toolEvents, event)
		},
		handlerDeps: &ToolCallHandlerDeps{
			DiscoveredTools: map[string]tools.ITool{"search_web": searchTool},
			LogToolEvent: func(event ToolEvent) {
				toolEvents = append(toolEvents, event)
			},
		},
	})

	res := stream.executeToolCall(stream.opts.handlerDeps, ToolCall{
		ID:       "call-search",
		Function: ToolCallFunction{Name: "search_web", Arguments: `{}`},
	})

	assert.Equal(t, enginecore.EventTool, res.event.Type)
	assert.JSONEq(t, `{"query":"Biggest news in AI"}`, executedArgs)
	if assert.NotEmpty(t, toolEvents) {
		assert.JSONEq(t, `{"query":"Biggest news in AI"}`, toolEvents[0].Arguments.(string))
	}
}

func TestSearchToolCallHasQuery(t *testing.T) {
	assert.False(t, searchToolCallHasQuery(""))
	assert.False(t, searchToolCallHasQuery(`{}`))
	assert.False(t, searchToolCallHasQuery(`{"query":""}`))
	assert.True(t, searchToolCallHasQuery(`{"query":"AI news"}`))
	assert.True(t, searchToolCallHasQuery(`not-json`))
}

func TestEnginecoreStreamPushTo95CoverageGapPaths(t *testing.T) {
	t.Run("build stops when assistant message is missing", func(t *testing.T) {
		stream := newAgentStream(agentStreamOptions{
			ctx:           context.Background(),
			client:        &pushStreamClient{},
			maxIterations: 2,
		})
		_, ok, err := stream.Next()
		require.NoError(t, err)
		assert.False(t, ok)
	})

	t.Run("build records llm completion failures", func(t *testing.T) {
		stream := newAgentStream(agentStreamOptions{
			ctx:    context.Background(),
			client: &pushStreamClient{completionErr: errors.New("completion down")},
		})
		_, ok, err := stream.Next()
		require.Error(t, err)
		assert.False(t, ok)
	})

	t.Run("execute tool call logs failures and handles bad json marshal", func(t *testing.T) {
		logged := false
		stream := newAgentStream(agentStreamOptions{
			ctx: context.Background(),
			handlerDeps: &ToolCallHandlerDeps{
				DiscoveredTools: map[string]tools.ITool{
					"bad_result": badResultTool{},
					"panic_tool": panicTool{},
				},
				LogToolEvent: func(event ToolEvent) {
					logged = true
				},
			},
		})
		res := stream.executeToolCall(stream.opts.handlerDeps, ToolCall{
			ID:       "bad",
			Function: ToolCallFunction{Name: "bad_result", Arguments: `{}`},
		})
		assert.Contains(t, res.message.Content, "failed to serialize result")
		assert.True(t, logged)

		res = stream.executeToolCall(stream.opts.handlerDeps, ToolCall{
			ID:       "panic",
			Function: ToolCallFunction{Name: "panic_tool", Arguments: `{}`},
		})
		assert.Contains(t, res.message.Content, "panic detected")
		assert.Equal(t, "error", res.event.ToolState["status"])

		stream = newAgentStream(agentStreamOptions{
			ctx: context.Background(),
			toolLogger: func(ToolEvent) {
				logged = true
			},
			handlerDeps: &ToolCallHandlerDeps{
				DiscoveredTools: map[string]tools.ITool{"missing": streamTestTool{err: errors.New("boom")}},
			},
		})
		res = stream.executeToolCall(stream.opts.handlerDeps, ToolCall{
			ID:       "missing",
			Function: ToolCallFunction{Name: "missing", Arguments: `{}`},
		})
		assert.Equal(t, "error", res.event.ToolState["status"])
	})

	t.Run("build finishes after text response", func(t *testing.T) {
		stream := newAgentStream(agentStreamOptions{
			ctx: context.Background(),
			client: &pushStreamClient{
				responses: []ChatCompletionMessage{{Role: RoleAssistant, Content: "done"}},
			},
		})
		event, ok, err := stream.Next()
		requireNoStreamErr(t, err, ok)
		assert.Equal(t, enginecore.EventText, event.Type)
		event, ok, err = stream.Next()
		requireNoStreamErr(t, err, ok)
		assert.Equal(t, enginecore.EventFinishStep, event.Type)
		_, ok, err = stream.Next()
		require.NoError(t, err)
		assert.False(t, ok)
	})

	t.Run("mark task complete emits completion message", func(t *testing.T) {
		stream := newAgentStream(agentStreamOptions{
			ctx: context.Background(),
			client: &pushStreamClient{
				responses: []ChatCompletionMessage{{
					Role: RoleAssistant,
					ToolCalls: []ToolCall{{
						ID: "done",
						Function: ToolCallFunction{
							Name:      "mark_task_complete",
							Arguments: `{"task_summary":"generated media","completion_message":"Here is the generated media."}`,
						},
					}},
				}},
			},
		})
		event, ok, err := stream.Next()
		requireNoStreamErr(t, err, ok)
		assert.Equal(t, enginecore.EventText, event.Type)
		assert.Equal(t, "Here is the generated media.", event.Text)
		event, ok, err = stream.Next()
		requireNoStreamErr(t, err, ok)
		assert.Equal(t, enginecore.EventFinishStep, event.Type)
		_, ok, err = stream.Next()
		require.NoError(t, err)
		assert.False(t, ok)
	})

	t.Run("build stops after empty assistant message", func(t *testing.T) {
		stream := newAgentStream(agentStreamOptions{
			ctx:           context.Background(),
			client:        &pushStreamClient{responses: []ChatCompletionMessage{{Role: RoleAssistant}}},
			maxIterations: 2,
		})
		_, ok, err := stream.Next()
		require.NoError(t, err)
		assert.False(t, ok)
	})
}

func requireNoStreamErr(t *testing.T, err error, ok bool) {
	t.Helper()
	if err != nil || !ok {
		t.Fatalf("expected stream event, ok=%v err=%v", ok, err)
	}
}

func TestMergeToolCallChunksIgnoresNegativeIndex(t *testing.T) {
	neg := -1
	zero := 0

	merged := mergeToolCallChunks(nil, []ToolCall{
		{
			Index: &neg,
			ID:    "bad",
			Type:  "function",
			Function: ToolCallFunction{
				Name:      "ignored",
				Arguments: `{"x":1}`,
			},
		},
		{
			Index: &zero,
			ID:    "ok",
			Type:  "function",
			Function: ToolCallFunction{
				Name:      "apply",
				Arguments: `{"a":`,
			},
		},
		{
			Index: &zero,
			Function: ToolCallFunction{
				Arguments: `"b"}`,
			},
		},
	})

	if len(merged) != 1 {
		t.Fatalf("expected one merged tool call, got %d", len(merged))
	}
	if merged[0].ID != "ok" {
		t.Fatalf("expected valid tool call id to be preserved, got %q", merged[0].ID)
	}
	if merged[0].Function.Name != "apply" {
		t.Fatalf("expected tool call name apply, got %q", merged[0].Function.Name)
	}
	if merged[0].Function.Arguments != `{"a":"b"}` {
		t.Fatalf("unexpected merged arguments: %q", merged[0].Function.Arguments)
	}
}

func TestMergeToolCallChunksIgnoresOutOfRangeIndex(t *testing.T) {
	large := maxStreamedToolCallSlots
	zero := 0

	merged := mergeToolCallChunks(nil, []ToolCall{
		{
			Index: &large,
			ID:    "bad",
			Type:  "function",
			Function: ToolCallFunction{
				Name:      "ignored",
				Arguments: `{"x":1}`,
			},
		},
		{
			Index: &zero,
			ID:    "ok",
			Type:  "function",
			Function: ToolCallFunction{
				Name:      "apply",
				Arguments: `{}`,
			},
		},
	})

	require.Len(t, merged, 1)
	assert.Equal(t, "ok", merged[0].ID)
}
