package agent

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	enginecore "github.com/TaskForceAI/core/pkg/enginecore/core"
	"github.com/TaskForceAI/core/pkg/tools"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSanitizeToolResultRemovesInternalPayloads(t *testing.T) {
	input := tools.ToolResult{
		"status":       "ok",
		"image_base64": "abc123",
		"generated_file": map[string]any{
			"filename":   "chart.png",
			"local_path": "/tmp/chart.png",
		},
		"metadata": map[string]any{
			"x": 1,
			"generated_file": map[string]any{
				"filename":   "chart.png",
				"local_path": "/tmp/chart.png",
			},
		},
	}

	sanitized := sanitizeToolResult(input)

	if _, ok := sanitized["image_base64"]; ok {
		t.Fatal("expected image_base64 to be removed from tool messages")
	}
	if sanitized["status"] != "ok" {
		t.Fatalf("expected status to be preserved, got %v", sanitized["status"])
	}
	if _, ok := sanitized["metadata"]; !ok {
		t.Fatal("expected metadata to be preserved")
	}
	if file, ok := sanitized["generated_file"].(map[string]any); !ok {
		t.Fatalf("expected generated file metadata to be preserved, got %#v", sanitized["generated_file"])
	} else if _, ok := file["local_path"]; ok {
		t.Fatalf("expected generated file local_path to be removed, got %#v", file)
	}
	if metadata, ok := sanitized["metadata"].(map[string]any); !ok {
		t.Fatalf("expected metadata map to be preserved, got %#v", sanitized["metadata"])
	} else if file, ok := metadata["generated_file"].(map[string]any); !ok {
		t.Fatalf("expected nested generated file metadata, got %#v", metadata["generated_file"])
	} else if _, ok := file["local_path"]; ok {
		t.Fatalf("expected nested generated file local_path to be removed, got %#v", file)
	}
	if _, ok := input["image_base64"]; !ok {
		t.Fatal("expected original tool result map to remain unchanged")
	}
}

func TestToolErrorEvent_FallsBackWhenErrorPayloadCannotBeMarshaled(t *testing.T) {
	previous := marshalToolError
	marshalToolError = func(any) ([]byte, error) { return nil, errors.New("marshal failed") }
	t.Cleanup(func() { marshalToolError = previous })

	stream := &agentStream{}
	event, message := stream.toolErrorEvent(ToolCall{Function: ToolCallFunction{Name: "broken_tool"}}, time.Now(), "boom")

	assert.Equal(t, enginecore.EventTool, event.Type)
	assert.JSONEq(t, `{"error":"tool failed"}`, message)
}

func TestSanitizeToolResultKeepsSafeResultMap(t *testing.T) {
	input := tools.ToolResult{
		"success": true,
		"rows":    []string{"a", "b"},
	}

	sanitized := sanitizeToolResult(input)
	sanitized["extra"] = true

	if _, ok := input["extra"]; !ok {
		t.Fatal("expected safe sanitized result to reuse original map")
	}
}

func TestGeneratedFileFromToolResultPreservesRawPaths(t *testing.T) {
	file := generatedFileFromToolResult("create_csv", tools.ToolResult{
		"generated_file": map[string]any{
			"filename":   "report.csv",
			"filepath":   "report.csv ",
			"local_path": "/tmp/report.csv ",
		},
	})

	require.NotNil(t, file)
	require.Equal(t, "report.csv ", file.Filepath)
	require.Equal(t, "/tmp/report.csv ", file.LocalPath)
}

func TestExecuteToolCallLogsGeneratedFileArtifact(t *testing.T) {
	var logged []ToolEvent
	stream := newAgentStream(agentStreamOptions{ctx: context.Background()})
	result := stream.executeToolCall(&ToolCallHandlerDeps{
		DiscoveredTools: map[string]tools.ITool{
			"create_chart": streamTestTool{result: tools.ToolResult{
				"success": true,
				"generated_file": map[string]any{
					"filename":   "chart.png",
					"filepath":   "chart.png",
					"mime_type":  "image/png",
					"bytes":      int64(123),
					"local_path": "/tmp/chart.png",
				},
			}},
		},
		LogToolEvent: func(event ToolEvent) {
			logged = append(logged, event)
		},
	}, ToolCall{
		ID: "call-file",
		Function: ToolCallFunction{
			Name:      "create_chart",
			Arguments: `{}`,
		},
	})

	if result.message.Content == "" {
		t.Fatal("expected a tool message")
	}
	if strings.Contains(result.message.Content, "local_path") {
		t.Fatalf("expected tool message to omit local_path, got %s", result.message.Content)
	}
	if len(logged) != 1 || logged[0].GeneratedFile == nil {
		t.Fatalf("expected generated file tool event, got %#v", logged)
	}
	if logged[0].GeneratedFile.Filename != "chart.png" ||
		logged[0].GeneratedFile.MimeType != "image/png" ||
		logged[0].GeneratedFile.Bytes != 123 ||
		logged[0].GeneratedFile.LocalPath != "/tmp/chart.png" {
		t.Fatalf("unexpected generated file metadata: %#v", logged[0].GeneratedFile)
	}
}

var benchmarkToolCallResult toolCallResult

func BenchmarkExecuteToolCallPackagesLargeResult(b *testing.B) {
	rows := make([]map[string]any, 0, 120)
	for i := range 120 {
		rows = append(rows, map[string]any{
			"id":      i,
			"title":   "benchmark row",
			"summary": strings.Repeat("large tool output ", 6),
		})
	}
	result := tools.ToolResult{
		"success": true,
		"rows":    rows,
		"metadata": map[string]any{
			"count": 120,
			"generated_file": map[string]any{
				"filename":   "report.json",
				"local_path": "/tmp/report.json",
			},
		},
		"generated_file": map[string]any{
			"filename":   "report.json",
			"filepath":   "report.json",
			"mime_type":  "application/json",
			"bytes":      int64(4096),
			"local_path": "/tmp/report.json",
		},
		"image_base64": strings.Repeat("screen", 256),
	}
	stream := newAgentStream(agentStreamOptions{ctx: context.Background()})
	deps := &ToolCallHandlerDeps{
		DiscoveredTools: map[string]tools.ITool{
			"create_report": streamTestTool{result: result},
		},
		LogToolEvent: func(ToolEvent) {},
	}
	toolCall := ToolCall{
		ID: "call-report",
		Function: ToolCallFunction{
			Name:      "create_report",
			Arguments: `{"format":"json"}`,
		},
	}

	b.ReportAllocs()
	for b.Loop() {
		benchmarkToolCallResult = stream.executeToolCall(deps, toolCall)
	}
}

func TestToolStateFromResultVariants(t *testing.T) {
	state := toolStateFromResult(nil, `{}`, "")
	if state["status"] != "completed" {
		t.Fatalf("nil result should still complete")
	}
	state = toolStateFromResult(tools.ToolResult{"error": "bad"}, `{}`, "")
	if state["status"] != "error" || state["error"] != "bad" {
		t.Fatalf("expected error state: %#v", state)
	}
	state = toolStateFromResult(tools.ToolResult{"value": func() {}}, `{}`, "")
	if _, ok := state["output"]; ok {
		t.Fatalf("unmarshalable results should omit output")
	}
	state = toolStateFromResult(tools.ToolResult{"value": func() {}}, `{}`, `{"value":"fallback"}`)
	if state["output"] != `{"value":"fallback"}` {
		t.Fatalf("expected caller-provided JSON output, got %#v", state)
	}
}

func TestAgentStreamFinalCoverageEdges(t *testing.T) {
	t.Run("generated file helper false branch", func(t *testing.T) {
		assert.False(t, isGeneratedFileToolName("not_generated"))
		assert.False(t, hasPrematureGeneratedFileCompletionCall([]ToolCall{{Function: ToolCallFunction{Name: "create_chart"}}}))
	})

	t.Run("ready tool call logging covers skipped and duplicate calls", func(t *testing.T) {
		var logged []ToolEvent
		stream := newAgentStream(agentStreamOptions{
			ctx: context.Background(),
			toolLogger: func(event ToolEvent) {
				logged = append(logged, event)
			},
		})
		stream.logReadyToolCalls([]ToolCall{
			{Function: ToolCallFunction{Arguments: `{}`}},
			{ID: "not-ready", Function: ToolCallFunction{Name: "create_chart", Arguments: `{`}},
			{ID: "dup", Function: ToolCallFunction{Name: "create_chart", Arguments: `{"x":1}`}},
			{ID: "dup", Function: ToolCallFunction{Name: "create_chart", Arguments: `{"x":1}`}},
			{ID: "empty-args", Function: ToolCallFunction{Name: "create_chart"}},
		})
		require.Len(t, logged, 1)
		assert.Equal(t, "create_chart", logged[0].ToolName)

		stream.logReadyToolCalls([]ToolCall{{ID: "late", Function: ToolCallFunction{Name: "create_chart"}}})
		stream.logReadyToolCalls([]ToolCall{{ID: "late", Function: ToolCallFunction{Name: "create_chart", Arguments: `{"ready":true}`}}})
		require.Len(t, logged, 2)
		assert.Equal(t, "late", logged[1].InvocationID)

		stream.opts.toolLogger = nil
		stream.logReadyToolCalls([]ToolCall{{ID: "ignored", Function: ToolCallFunction{Name: "create_chart", Arguments: `{}`}}})
	})

	t.Run("search repair leaves calls unchanged without fallback or on marshal failure", func(t *testing.T) {
		stream := newAgentStream(agentStreamOptions{ctx: context.Background()})
		unchanged := stream.repairSearchToolCallArguments(ToolCall{
			Function: ToolCallFunction{Name: "search_web", Arguments: `{}`},
		})
		assert.Equal(t, `{}`, unchanged.Function.Arguments)
		assert.Empty(t, fallbackSearchQueryFromMessages([]ChatCompletionMessage{
			{Role: RoleAssistant, Content: "skip"},
			{Role: RoleUser, Content: "   "},
		}))

		origMarshal := marshalSearchQueryArguments
		marshalSearchQueryArguments = func(any) ([]byte, error) {
			return nil, errors.New("marshal failed")
		}
		t.Cleanup(func() { marshalSearchQueryArguments = origMarshal })

		stream.opts.messages = []ChatCompletionMessage{{Role: RoleUser, Content: "latest AI news"}}
		unchanged = stream.repairSearchToolCallArguments(ToolCall{
			Function: ToolCallFunction{Name: "search_web", Arguments: `{}`},
		})
		assert.Equal(t, `{}`, unchanged.Function.Arguments)
	})

	t.Run("skipped tool response marshal fallback", func(t *testing.T) {
		origMarshal := marshalSkippedToolResponse
		marshalSkippedToolResponse = func(any) ([]byte, error) {
			return nil, errors.New("marshal failed")
		}
		t.Cleanup(func() { marshalSkippedToolResponse = origMarshal })

		msg := skippedToolResponse(ToolCall{ID: "call-1"}, "skip")
		assert.JSONEq(t, `{"success":false,"skipped":true}`, msg.Content)
	})

	t.Run("handle assistant tool calls requires generated file before completion", func(t *testing.T) {
		stream := newAgentStream(agentStreamOptions{
			ctx:                      context.Background(),
			requireGeneratedFileTool: true,
			handlerDeps:              &ToolCallHandlerDeps{DiscoveredTools: map[string]tools.ITool{}},
		})
		messages := []ChatCompletionMessage{}
		result := stream.handleAssistantToolCalls([]ToolCall{{
			ID:       "done",
			Function: ToolCallFunction{Name: "mark_task_complete", Arguments: `{}`},
		}}, &messages, false)

		assert.False(t, result.finished)
		require.Len(t, messages, 2)
		assert.Equal(t, RoleTool, messages[0].Role)
		assert.Equal(t, RoleUser, messages[1].Role)
	})

	t.Run("handle assistant tool calls stops after task completion", func(t *testing.T) {
		stream := newAgentStream(agentStreamOptions{
			ctx:         context.Background(),
			handlerDeps: &ToolCallHandlerDeps{DiscoveredTools: map[string]tools.ITool{}},
		})
		messages := []ChatCompletionMessage{}

		result := stream.handleAssistantToolCalls([]ToolCall{
			{ID: "done", Function: ToolCallFunction{Name: "mark_task_complete", Arguments: `{}`}},
			{ID: "skipped", Function: ToolCallFunction{Name: "missing", Arguments: `{}`}},
		}, &messages, false)

		assert.True(t, result.finished)
		require.Len(t, stream.events, 1)
		assert.Equal(t, enginecore.EventFinishStep, stream.events[0].Type)
		assert.Empty(t, messages)
	})

	t.Run("append task complete falls back to task summary and ignores invalid json", func(t *testing.T) {
		stream := newAgentStream(agentStreamOptions{ctx: context.Background()})
		stream.appendTaskCompleteEvents(`{"task_summary":"summary only"}`)
		require.Len(t, stream.events, 2)
		assert.Equal(t, "summary only", stream.events[0].Text)

		stream.events = nil
		stream.appendTaskCompleteEvents(`not-json`)
		require.Len(t, stream.events, 1)
		assert.Equal(t, enginecore.EventFinishStep, stream.events[0].Type)
	})

	t.Run("tool result sanitizer helper variants", func(t *testing.T) {
		assert.False(t, metadataContainsGeneratedFile("not-map"))
		assert.Equal(t, "not-map", sanitizeToolMetadata("not-map"))
		assert.Equal(t, "not-map", sanitizeGeneratedFileValue("not-map"))
		metadataOnly := tools.ToolResult{"metadata": map[string]any{"safe": true}}
		sanitizedMetadataOnly := sanitizeToolResult(metadataOnly)
		sanitizedMetadataOnly["extra"] = true
		assert.Equal(t, true, metadataOnly["extra"])
		nestedGeneratedFileOnly := sanitizeToolResult(tools.ToolResult{
			"metadata": map[string]any{
				"generated_file": map[string]any{
					"filename":   "chart.png",
					"local_path": "/tmp/chart.png",
				},
			},
		})
		nestedFile := nestedGeneratedFileOnly["metadata"].(map[string]any)["generated_file"].(map[string]any)
		assert.NotContains(t, nestedFile, "local_path")
		assert.Nil(t, generatedFileFromToolResult("create_csv", nil))
		assert.Nil(t, generatedFileFromToolResult("search_web", tools.ToolResult{"generated_file": map[string]any{"filename": "x"}}))
		assert.Nil(t, generatedFileFromToolResult("create_csv", tools.ToolResult{"generated_file": "bad"}))
		assert.Nil(t, generatedFileFromToolResult("create_csv", tools.ToolResult{"generated_file": map[string]any{"filename": " "}}))
	})

	t.Run("generated file metadata and search source variants", func(t *testing.T) {
		assert.Equal(t, int64(1), int64FromAny(1))
		assert.Equal(t, int64(2), int64FromAny(int32(2)))
		assert.Equal(t, int64(3), int64FromAny(int64(3)))
		assert.Equal(t, int64(4), int64FromAny(float64(4.5)))

		file := generatedFileFromToolResult("create_chart", tools.ToolResult{"generated_file": map[string]any{
			"filename": "chart.png",
			"bytes":    json.Number("42"),
		}})
		require.NotNil(t, file)
		assert.Equal(t, int64(42), file.Bytes)

		file = generatedFileFromToolResult("create_chart", tools.ToolResult{"generated_file": map[string]any{
			"filename": "chart.png",
			"bytes":    json.Number("bad"),
		}})
		require.NotNil(t, file)
		assert.Zero(t, file.Bytes)

		assert.Nil(t, sourcesFromSearchResult("grep", tools.ToolResult{}))
		assert.Nil(t, sourcesFromSearchResult("search_web", nil))
		assert.Nil(t, sourcesFromSearchResult("search_web", tools.ToolResult{"results": "bad"}))
		sources := sourcesFromSearchResult("search_web", tools.ToolResult{"results": []tools.SearchResultItem{
			{Title: "missing url"},
			{Title: "one", URL: "https://example.com", Snippet: "s"},
			{Title: "duplicate", URL: "https://example.com"},
		}})
		require.Len(t, sources, 1)
		assert.Equal(t, "one", sources[0].Title)
	})
}
