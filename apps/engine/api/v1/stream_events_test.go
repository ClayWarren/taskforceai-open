package stream

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/go-engine/pkg/run"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func withStreamAuth(t *testing.T, userID int) {
	t.Helper()

	withStreamUser(t, &auth.AuthenticatedUser{ID: userID, Email: "test@example.com"})
}

func withUnauthenticatedStream(t *testing.T) {
	t.Helper()

	swap(t, &getQueries, func(ctx context.Context) (*db.Queries, error) { return &db.Queries{}, nil })
	swap(t, &authWrapper, func(q *db.Queries, next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) { next(w, r) }
	})
}

func TestStreamHandler_SendCompleteEvent(t *testing.T) {
	resp := httptest.NewRecorder()
	h := &streamHandler{
		w:      resp,
		taskID: "task-complete",
		userID: 1,
		rc:     http.NewResponseController(resp),
	}
	assert.False(t, h.sendCompleteEvent(&run.TaskState{
		Result:         "done",
		ConversationID: 99,
		TraceID:        "trace-1",
		ToolEvents:     []any{map[string]any{"tool": "search"}},
		AgentStatuses:  []any{map[string]any{"status": "DONE"}},
	}))
	assert.Contains(t, resp.Body.String(), `"type":"complete"`)
	assert.Contains(t, resp.Body.String(), `"conversation_id":99`)
}

func TestStreamHandler_SendCompleteEventCompactsToolEvents(t *testing.T) {
	resp := httptest.NewRecorder()
	h := &streamHandler{
		w:      resp,
		taskID: "task-complete-tools-compact",
		userID: 1,
		rc:     http.NewResponseController(resp),
	}

	assert.False(t, h.sendCompleteEvent(&run.TaskState{
		Result: "done",
		ToolEvents: []any{map[string]any{
			"tool_name":    "computer_use",
			"tool_input":   `{"action":"click","coordinate_x":10,"coordinate_y":20,"unused":"omit"}`,
			"tool_output":  strings.Repeat("large terminal output ", 80),
			"image_base64": strings.Repeat("screen", 200),
		}},
		AgentStatuses: []any{map[string]any{"status": "DONE"}},
	}))

	body := resp.Body.String()
	assert.Contains(t, body, `"type":"complete"`)
	assert.Contains(t, body, `"toolName":"computer_use"`)
	assert.Contains(t, body, `"arguments":{"action":"click"`)
	assert.Contains(t, body, `"resultPreview"`)
	assert.NotContains(t, body, `"tool_output"`)
	assert.NotContains(t, body, `"image_base64"`)
	assert.NotContains(t, body, "omit")
	assert.LessOrEqual(t, strings.Count(body, "large terminal output"), 51)
}

func TestCompactCompleteToolEventsStripsImagesFromCompactedEvents(t *testing.T) {
	mapEvents := compactCompleteToolEvents([]map[string]any{{
		"invocationId": "call-1",
		"toolName":     "search_web",
		"image_base64": "screen",
	}}).([]compactedMapToolEvent)
	require.Len(t, mapEvents, 1)
	assert.Nil(t, mapEvents[0].ImageBase64)

	agentID := 3
	agentEvents := compactCompleteToolEvents([]agent.ToolEvent{{
		InvocationID:  "call-2",
		AgentID:       &agentID,
		AgentLabel:    "Analyst",
		ToolName:      "search_web",
		ImageBase64:   "screen",
		Sources:       []agent.SourceReference{{URL: "https://example.com", Title: "Example"}},
		ResultPreview: "result",
	}}).([]compactedAgentToolEvent)
	require.Len(t, agentEvents, 1)
	assert.Empty(t, agentEvents[0].ImageBase64)
	assert.Equal(t, []agent.SourceReference{{URL: "https://example.com", Title: "Example"}}, agentEvents[0].Sources)

	mixed := compactCompleteToolEvents([]any{
		compactedMapToolEvent{InvocationID: "call-3", ImageBase64: func() {}},
		compactedAgentToolEvent{InvocationID: "call-4", ImageBase64: "screen", Arguments: func() {}},
		"unchanged",
	}).([]any)
	require.Len(t, mixed, 3)
	assert.Nil(t, mixed[0].(compactedMapToolEvent).ImageBase64)
	assert.Empty(t, mixed[1].(compactedAgentToolEvent).ImageBase64)
	assert.Equal(t, "unchanged", mixed[2])
}

func TestStripCompleteToolEventImagesHandlesDefensiveMapValues(t *testing.T) {
	stripped := stripCompleteToolEventImages([]any{
		map[string]any{"image_base64": "screen", "toolName": "shell"},
		"unchanged",
	}).([]any)
	require.Len(t, stripped, 2)
	assert.NotContains(t, stripped[0].(map[string]any), "image_base64")
	assert.Equal(t, "unchanged", stripped[1])
}

func TestStreamHandler_SendCompleteEventDisconnect(t *testing.T) {
	w := &writeFailResponseWriter{}
	h := &streamHandler{
		w:      w,
		taskID: "task-complete-disconnect",
		userID: 1,
		rc:     http.NewResponseController(w),
	}
	assert.False(t, h.sendCompleteEvent(&run.TaskState{
		Result:        "done",
		AgentStatuses: []any{map[string]any{"status": "DONE"}},
	}))
}

func TestStreamHandler_SendCompleteEventMarshalFailure(t *testing.T) {
	resp := httptest.NewRecorder()
	h := &streamHandler{w: resp, taskID: "task-complete-fail", userID: 1, rc: http.NewResponseController(resp)}
	assert.False(t, h.sendCompleteEvent(&run.TaskState{
		Result:        "done",
		AgentStatuses: []any{streamBadJSON{}},
	}))
}

func TestStreamHandler_SendErrorAndFailedEvent(t *testing.T) {
	resp := httptest.NewRecorder()
	h := &streamHandler{w: resp, taskID: "task-direct", userID: 1, rc: http.NewResponseController(resp)}

	assert.False(t, h.sendError("bad news"))
	assert.Contains(t, resp.Body.String(), `"type":"error"`)
	assert.Contains(t, resp.Body.String(), "bad news")

	resp = httptest.NewRecorder()
	h = &streamHandler{w: resp, taskID: "task-direct", userID: 1, rc: http.NewResponseController(resp)}
	assert.False(t, h.sendFailedEvent(&run.TaskState{Error: "failed"}))
	assert.Contains(t, resp.Body.String(), "failed")
}

func TestStreamHandler_SendErrorAndFailedEvents(t *testing.T) {
	resp := httptest.NewRecorder()
	h := &streamHandler{
		w:      resp,
		taskID: "task-events",
		userID: 1,
		rc:     http.NewResponseController(resp),
	}
	assert.False(t, h.sendError("boom"))
	assert.Contains(t, resp.Body.String(), `"type":"error"`)

	resp2 := httptest.NewRecorder()
	h2 := &streamHandler{w: resp2, taskID: "task-failed", userID: 1, rc: http.NewResponseController(resp2)}
	assert.False(t, h2.sendFailedEvent(&run.TaskState{Error: "failed hard"}))
	assert.Contains(t, resp2.Body.String(), `"type":"error"`)
}

func TestStreamHandler_SendErrorClientDisconnect(t *testing.T) {
	w := &writeFailResponseWriter{}
	h := &streamHandler{
		w:      w,
		taskID: "task-error-disconnect",
		userID: 1,
		rc:     http.NewResponseController(w),
	}
	assert.False(t, h.sendError("boom"))
}

func TestStreamHandler_SendFailedEventDisconnect(t *testing.T) {
	w := &writeFailResponseWriter{}
	h := &streamHandler{
		w:      w,
		taskID: "task-failed-disconnect",
		userID: 1,
		rc:     http.NewResponseController(w),
	}
	assert.False(t, h.sendFailedEvent(&run.TaskState{Error: "boom"}))
}

func TestStreamHandler_SendProgressPulseDirect(t *testing.T) {
	resp := httptest.NewRecorder()
	h := &streamHandler{
		w:      resp,
		taskID: "task-progress",
		userID: 1,
		rc:     http.NewResponseController(resp),
	}
	assert.True(t, h.sendProgressPulse(&run.TaskState{
		AgentStatuses: []any{map[string]any{"status": "RUNNING"}},
		BudgetUsage:   &run.BudgetUsage{ConsumedUSD: 0.5},
	}))
	assert.Contains(t, resp.Body.String(), `"type":"progress"`)
	assert.Contains(t, resp.Body.String(), `"pending_approval":null`)
}

func TestStreamHandler_ProgressPulseCompactsActiveAgentResults(t *testing.T) {
	resp := httptest.NewRecorder()
	h := &streamHandler{
		w:      resp,
		taskID: "task-progress-compact",
		userID: 1,
		rc:     http.NewResponseController(resp),
	}

	assert.True(t, h.sendProgressPulse(&run.TaskState{
		AgentStatuses: []any{
			map[string]any{
				"agent_id":  0,
				"status":    "PROCESSING...",
				"progress":  0.72,
				"model":     "model-a",
				"result":    "large active result should not be repeated in stream progress",
				"reasoning": strings.Repeat("active reasoning ", 80),
			},
			map[string]any{
				"agent_id": 1,
				"status":   "COMPLETED",
				"progress": 1,
				"model":    "model-b",
				"result":   "completed preview is okay",
			},
		},
	}))

	body := resp.Body.String()
	assert.Contains(t, body, `"type":"progress"`)
	assert.Contains(t, body, `"model":"model-a"`)
	assert.Contains(t, body, "large active result should not be repeated")
	assert.Contains(t, body, "active reasoning")
	assert.LessOrEqual(t, strings.Count(body, "active reasoning"), 51)
	assert.Contains(t, body, "completed preview is okay")
}

func TestStreamHandler_ProgressPulseCompactsToolEvents(t *testing.T) {
	resp := httptest.NewRecorder()
	h := &streamHandler{
		w:      resp,
		taskID: "task-progress-tools",
		userID: 1,
		rc:     http.NewResponseController(resp),
	}

	assert.True(t, h.sendProgressPulse(&run.TaskState{
		AgentStatuses: []any{map[string]any{"agent_id": 0, "status": "PROCESSING..."}},
		ToolEvents: []any{
			map[string]any{
				"invocationId":  "call-search-1",
				"agentId":       0,
				"agentLabel":    "Analyst",
				"toolName":      "search_web",
				"arguments":     map[string]any{"query": "latest AI news", "unused": strings.Repeat("large argument ", 80)},
				"success":       true,
				"durationMs":    123,
				"resultPreview": strings.Repeat("large preview ", 80),
				"image_base64":  "screen-a",
				"sources":       []any{map[string]any{"url": "https://news.example/story", "title": "Story"}},
			},
			map[string]any{
				"agent_id":    1,
				"agent_label": "Researcher",
				"tool_name":   "search_web",
				"status":      "complete",
				"duration_ms": 456,
			},
		},
	}))

	body := resp.Body.String()
	assert.Contains(t, body, `"type":"progress"`)
	assert.Contains(t, body, `"tool_usage"`)
	assert.NotContains(t, body, `"tool_events"`)
	assert.Contains(t, body, `"invocationId":"call-search-1"`)
	assert.Contains(t, body, `"toolName":"search_web"`)
	assert.Contains(t, body, `"arguments":{"query":"latest AI news"}`)
	assert.Contains(t, body, `"status":"complete"`)
	assert.NotContains(t, body, `"success":"complete"`)
	assert.Contains(t, body, `"image_base64":"screen-a"`)
	assert.Contains(t, body, `"sources":[{"title":"Story","url":"https://news.example/story"}]`)
	assert.NotContains(t, body, "large argument")
	assert.LessOrEqual(t, strings.Count(body, "large preview"), 51)
}

func TestStreamHandler_ProgressPulsePreservesSearchQueryFromJSONArguments(t *testing.T) {
	resp := httptest.NewRecorder()
	h := &streamHandler{
		w:      resp,
		taskID: "task-progress-json-tools",
		userID: 1,
		rc:     http.NewResponseController(resp),
	}

	assert.True(t, h.sendProgressPulse(&run.TaskState{
		AgentStatuses: []any{map[string]any{"agent_id": 0, "status": "PROCESSING..."}},
		ToolEvents: []any{
			map[string]any{
				"agentId":       0,
				"toolName":      "search_web",
				"arguments":     `{"query":"current model benchmark news","unused":"omit this"}`,
				"success":       true,
				"durationMs":    75,
				"resultPreview": "ok",
			},
		},
	}))

	body := resp.Body.String()
	assert.Contains(t, body, `"arguments":{"query":"current model benchmark news"}`)
	assert.NotContains(t, body, "omit this")
}

func TestStreamHandler_ProgressPulseSkipsOversizedJSONArguments(t *testing.T) {
	resp := httptest.NewRecorder()
	h := &streamHandler{
		w:      resp,
		taskID: "task-progress-large-json-tools",
		userID: 1,
		rc:     http.NewResponseController(resp),
	}

	assert.True(t, h.sendProgressPulse(&run.TaskState{
		AgentStatuses: []any{map[string]any{"agent_id": 0, "status": "PROCESSING..."}},
		ToolEvents: []any{
			map[string]any{
				"agentId":       0,
				"toolName":      "search_web",
				"arguments":     `{"query":"hidden query","unused":"` + strings.Repeat("x", progressArgumentJSONParseLimit) + `"}`,
				"success":       true,
				"durationMs":    75,
				"resultPreview": "ok",
			},
		},
	}))

	body := resp.Body.String()
	assert.Contains(t, body, `"toolName":"search_web"`)
	assert.NotContains(t, body, `"arguments"`)
	assert.NotContains(t, body, "hidden query")
}

func TestStreamHandler_ProgressPulsePreservesComputerUseActionArguments(t *testing.T) {
	resp := httptest.NewRecorder()
	h := &streamHandler{
		w:      resp,
		taskID: "task-progress-computer-use-tools",
		userID: 1,
		rc:     http.NewResponseController(resp),
	}

	assert.True(t, h.sendProgressPulse(&run.TaskState{
		AgentStatuses: []any{map[string]any{"agent_id": 0, "status": "PROCESSING..."}},
		ToolEvents: []any{
			map[string]any{
				"agentId":      0,
				"toolName":     "computer_use",
				"arguments":    `{"action":"click","coordinate_x":269,"coordinate_y":372,"scroll_direction":"down","scroll_amount":0,"text":"","unused":"omit this"}`,
				"status":       "completed",
				"success":      true,
				"durationMs":   85,
				"image_base64": "screen-a",
			},
		},
	}))

	body := resp.Body.String()
	assert.Contains(t, body, `"toolName":"computer_use"`)
	assert.Contains(t, body, `"arguments":{"action":"click"`)
	assert.Contains(t, body, `"coordinate_x":269`)
	assert.Contains(t, body, `"coordinate_y":372`)
	assert.Contains(t, body, `"image_base64":"screen-a"`)
	assert.NotContains(t, body, "omit this")
}

func TestStreamHandler_ProgressPulseCompactsTypedAgentToolEvents(t *testing.T) {
	resp := httptest.NewRecorder()
	h := &streamHandler{
		w:      resp,
		taskID: "task-progress-typed-tools",
		userID: 1,
		rc:     http.NewResponseController(resp),
	}
	agentID := 2

	assert.True(t, h.sendProgressPulse(&run.TaskState{
		AgentStatuses: []any{map[string]any{"agent_id": 0, "status": "PROCESSING..."}},
		ToolEvents: []agent.ToolEvent{{
			InvocationID:  "call-typed-search",
			AgentID:       &agentID,
			AgentLabel:    "Researcher",
			ToolName:      "search_web",
			Arguments:     map[string]any{"query": "typed tool event query", "unused": strings.Repeat("large argument ", 80)},
			Status:        "completed",
			Success:       true,
			DurationMs:    88,
			ResultPreview: strings.Repeat("typed preview ", 80),
			Sources:       []agent.SourceReference{{URL: "https://example.com/typed", Title: "Typed"}},
		}},
	}))

	body := resp.Body.String()
	assert.Contains(t, body, `"tool_usage"`)
	assert.Contains(t, body, `"invocationId":"call-typed-search"`)
	assert.Contains(t, body, `"agentId":2`)
	assert.Contains(t, body, `"toolName":"search_web"`)
	assert.Contains(t, body, `"arguments":{"query":"typed tool event query"}`)
	assert.Contains(t, body, `"sources":[{"url":"https://example.com/typed","title":"Typed"}]`)
	assert.NotContains(t, body, "large argument")
	assert.LessOrEqual(t, strings.Count(body, "typed preview"), 51)
}

func TestCompactProgressAgentStatusesFallbacks(t *testing.T) {
	assert.Equal(t, "raw", compactProgressAgentStatuses("raw"))

	nonMap := []any{"still-raw"}
	assert.Equal(t, nonMap, compactProgressAgentStatuses(nonMap))

	unchanged := []any{map[string]any{"agent_id": 1, "status": "RUNNING"}}
	assert.Equal(t, unchanged, compactProgressAgentStatuses(unchanged))

	withNil := []any{map[string]any{
		"agent_id": 1,
		"status":   "RUNNING",
		"result":   strings.Repeat("result ", 100),
		"extra":    nil,
	}}
	compacted := compactProgressAgentStatuses(withNil).([]any)
	require.Len(t, compacted, 1)
	compactedMap := compacted[0].(map[string]any)
	assert.Contains(t, compactedMap["result"], "...")
	assert.Contains(t, compactedMap, "extra")

	resultOnly, ok := compactAgentStatusMap(map[string]any{
		"agent_id":  1,
		"status":    "RUNNING",
		"result":    "short",
		"reasoning": "short reasoning",
	}, "new result", true, "new reasoning", true)
	require.True(t, ok)
	assert.Equal(t, "new result", resultOnly.Result)
	assert.Equal(t, "new reasoning", resultOnly.Reasoning)

	withUnknownKey := []any{map[string]any{
		"agent_id":  2,
		"status":    "RUNNING",
		"reasoning": strings.Repeat("reasoning ", 100),
		"extra":     "kept",
	}}
	fallback := compactProgressAgentStatuses(withUnknownKey).([]any)
	require.Len(t, fallback, 1)
	fallbackMap := fallback[0].(map[string]any)
	assert.Contains(t, fallbackMap["reasoning"], "...")
	assert.Equal(t, "kept", fallbackMap["extra"])

	resultChangedReasoningKept, ok := compactAgentStatusMap(map[string]any{
		"agent_id":  3,
		"status":    "RUNNING",
		"result":    "short",
		"reasoning": "keep me",
	}, "new result", true, nil, false)
	require.True(t, ok)
	assert.Equal(t, "new result", resultChangedReasoningKept.Result)
	assert.Equal(t, "keep me", resultChangedReasoningKept.Reasoning)

	_, ok = compactAgentStatusMap(map[string]any{"unexpected": "field"}, nil, false, nil, false)
	assert.False(t, ok)
}

func TestCompactArgumentsFallbacks(t *testing.T) {
	assert.Empty(t, normalizeToolName(123))

	_, ok := compactArgumentsMapForNormalized("other", "search_web", map[string]any{"query": "ignored"})
	assert.False(t, ok)

	_, ok = compactArgumentsMapForNormalized("search_web", "search_web", 42)
	assert.False(t, ok)

	_, ok = compactArgumentsMapForNormalized("search_web", "search_web", "{")
	assert.False(t, ok)

	_, ok = compactSearchArgumentsForNormalized("search_web", map[string]any{"query": "   "})
	assert.False(t, ok)

	_, ok = compactSearchArgumentsForNormalized("search_web", map[string]any{"query": 42})
	assert.False(t, ok)

	_, ok = compactComputerUseArgumentsForNormalized("computer_use", map[string]any{})
	assert.False(t, ok)

	args, ok := compactComputerUseArgumentsForNormalized("computer_use", map[string]any{
		"action":           strings.Repeat("click ", 130),
		"coordinate_x":     10,
		"coordinate_y":     20,
		"scroll_direction": "down",
		"scroll_amount":    5,
		"text":             "hello",
		"duration":         1.5,
		"end_x":            11,
		"end_y":            21,
	})
	require.True(t, ok)
	compacted := args.(compactedComputerUseArguments)
	assert.Contains(t, compacted.Action, "...")
	assert.Equal(t, 10, compacted.CoordinateX)
	assert.Equal(t, 21, compacted.EndY)
}

func TestCompactProgressToolEventsFallbacks(t *testing.T) {
	assert.Nil(t, compactProgressToolEvents(nil))
	assert.Equal(t, "raw", compactProgressToolEvents("raw"))

	var nilAnyEvents []any
	assert.Nil(t, compactProgressToolEvents(nilAnyEvents))

	var nilMapEvents []map[string]any
	assert.Nil(t, compactProgressToolEvents(nilMapEvents))

	var nilTypedEvents []agent.ToolEvent
	assert.Nil(t, compactProgressToolEvents(nilTypedEvents))

	type customToolEvent struct {
		ToolName  string         `json:"toolName"`
		ToolInput map[string]any `json:"tool_input"`
	}
	fromStruct := compactProgressToolEvents([]customToolEvent{{
		ToolName:  "search_web",
		ToolInput: map[string]any{"query": "from struct", "ignored": strings.Repeat("x", 80)},
	}}).([]any)
	require.Len(t, fromStruct, 1)
	assert.Equal(t, compactedSearchArguments("from struct"), fromStruct[0].(compactedMapToolEvent).Arguments)

	fromBadSlice := compactProgressToolEvents([]int{1}).([]any)
	require.Len(t, fromBadSlice, 1)
	assert.Equal(t, 1, fromBadSlice[0])

	var nilCustomEvents []customToolEvent
	assert.Nil(t, compactProgressToolEvents(nilCustomEvents))

	mixed := compactAnyToolEvents([]any{
		map[string]any{"toolName": "search_web", "arguments": map[string]any{"query": "first"}},
		make(chan int),
		map[string]any{"toolName": "search_web", "tool_output": "preview"},
	}).([]any)
	require.Len(t, mixed, 3)
	assert.Equal(t, compactedSearchArguments("first"), mixed[0].(compactedMapToolEvent).Arguments)

	events := compactMapToolEvents([]map[string]any{{
		"invocation_id": "call",
		"tool_name":     "computer_use",
		"tool_input":    map[string]any{"action": "drag"},
		"tool_output":   strings.Repeat("preview ", 80),
	}})
	compacted := events.([]compactedMapToolEvent)
	require.Len(t, compacted, 1)
	assert.Equal(t, "call", compacted[0].InvocationID)
	assert.NotNil(t, compacted[0].Arguments)
	assert.Contains(t, compacted[0].ResultPreview, "...")
}

var benchmarkCompactedToolEvents any
var benchmarkCompactedAgentStatuses any
var benchmarkCompactedSearchArgumentsJSON []byte

func TestCompactedSearchArgumentsMarshalJSONEscapesControlBytes(t *testing.T) {
	args := compactedSearchArguments("bad\x00query\nnext")
	data, err := args.MarshalJSON()
	require.NoError(t, err)
	require.True(t, json.Valid(data), string(data))

	var decoded map[string]string
	require.NoError(t, json.Unmarshal(data, &decoded))
	assert.Equal(t, "bad\x00query\nnext", decoded["query"])
	assert.NotContains(t, string(data), `\x00`)
}

func BenchmarkCompactedSearchArgumentsMarshalJSON(b *testing.B) {
	args := compactedSearchArguments("latest taskforce progress item with enough text to exercise quoting")

	b.ReportAllocs()
	for b.Loop() {
		data, err := args.MarshalJSON()
		if err != nil {
			b.Fatal(err)
		}
		benchmarkCompactedSearchArgumentsJSON = data
	}
}

func BenchmarkCompactProgressAgentStatuses(b *testing.B) {
	unchanged := make([]any, 0, 32)
	for i := range 32 {
		unchanged = append(unchanged, map[string]any{
			"agent_id": i,
			"status":   "PROCESSING...",
			"progress": 0.5,
			"model":    "gpt-5.6-sol",
		})
	}
	truncated := make([]any, 0, 32)
	for i := range 32 {
		truncated = append(truncated, map[string]any{
			"agent_id":  i,
			"status":    "PROCESSING...",
			"progress":  0.5,
			"model":     "gpt-5.6-sol",
			"reasoning": strings.Repeat("active reasoning ", 80),
		})
	}

	b.Run("unchanged", func(b *testing.B) {
		b.ReportAllocs()
		for b.Loop() {
			benchmarkCompactedAgentStatuses = compactProgressAgentStatuses(unchanged)
		}
	})
	b.Run("truncated", func(b *testing.B) {
		b.ReportAllocs()
		for b.Loop() {
			benchmarkCompactedAgentStatuses = compactProgressAgentStatuses(truncated)
		}
	})
}

func BenchmarkCompactProgressToolEventsTypedAgentEvents(b *testing.B) {
	events := make([]agent.ToolEvent, 0, 160)
	for i := range 160 {
		toolName := "search_web"
		args := any(map[string]any{
			"query":  fmt.Sprintf("latest taskforce progress item %d", i),
			"unused": strings.Repeat("large unused search argument ", 8),
		})
		if i%4 == 0 {
			toolName = "computer_use"
			args = map[string]any{
				"action":       "click",
				"coordinate_x": i,
				"coordinate_y": i + 10,
				"text":         strings.Repeat("typed text ", 8),
				"unused":       strings.Repeat("large unused computer argument ", 8),
			}
		}
		agentID := i % 8
		events = append(events, agent.ToolEvent{
			InvocationID:  fmt.Sprintf("call-%d", i),
			AgentID:       &agentID,
			AgentLabel:    fmt.Sprintf("Agent %d", agentID),
			ToolName:      toolName,
			Arguments:     args,
			Status:        "completed",
			Success:       true,
			DurationMs:    int64(i * 3),
			ResultPreview: strings.Repeat("large result preview ", 20),
			Sources:       []agent.SourceReference{{URL: "https://example.com/source", Title: "Example"}},
		})
	}

	b.ReportAllocs()
	for b.Loop() {
		benchmarkCompactedToolEvents = compactProgressToolEvents(events)
	}
}

func BenchmarkCompactProgressToolEventsPersistedMaps(b *testing.B) {
	events := make([]any, 0, 160)
	for i := range 160 {
		toolName := "search_web"
		args := any(map[string]any{
			"query":  fmt.Sprintf("latest taskforce progress item %d", i),
			"unused": strings.Repeat("large unused search argument ", 8),
		})
		if i%4 == 0 {
			toolName = "computer_use"
			args = map[string]any{
				"action":       "click",
				"coordinate_x": float64(i),
				"coordinate_y": float64(i + 10),
				"text":         strings.Repeat("persisted text ", 8),
				"unused":       strings.Repeat("large unused computer argument ", 8),
			}
		}
		agentID := float64(i % 8)
		events = append(events, map[string]any{
			"invocation_id":  fmt.Sprintf("call-%d", i),
			"agent_id":       agentID,
			"agent_label":    fmt.Sprintf("Agent %d", int(agentID)),
			"tool_name":      toolName,
			"arguments":      args,
			"status":         "completed",
			"success":        true,
			"duration_ms":    float64(i * 3),
			"tool_output":    strings.Repeat("large result preview ", 20),
			"sources":        []any{map[string]any{"url": "https://example.com/source", "title": "Example"}},
			"ignored_detail": strings.Repeat("large ignored persisted field ", 8),
		})
	}

	b.ReportAllocs()
	for b.Loop() {
		benchmarkCompactedToolEvents = compactProgressToolEvents(events)
	}
}

func BenchmarkStreamHandlerDuplicateProgressPulse(b *testing.B) {
	events := make([]agent.ToolEvent, 0, 80)
	for i := range 80 {
		agentID := i % 4
		events = append(events, agent.ToolEvent{
			InvocationID:  fmt.Sprintf("call-%d", i),
			AgentID:       &agentID,
			AgentLabel:    fmt.Sprintf("Agent %d", agentID),
			ToolName:      "search_web",
			Arguments:     map[string]any{"query": fmt.Sprintf("latest taskforce progress item %d", i)},
			Status:        "completed",
			Success:       true,
			DurationMs:    int64(i * 3),
			ResultPreview: strings.Repeat("large result preview ", 8),
			Sources:       []agent.SourceReference{{URL: "https://example.com/source", Title: "Example"}},
		})
	}
	task := &run.TaskState{
		AgentStatuses:   []any{map[string]any{"agent_id": 0, "status": "PROCESSING...", "progress": 0.5}},
		ToolEvents:      events,
		UpdatedAt:       time.Now().Unix(),
		ProgressVersion: time.Now().UnixMicro(),
	}
	resp := httptest.NewRecorder()
	h := &streamHandler{w: resp, taskID: "task-progress-bench", userID: 1, rc: http.NewResponseController(resp)}
	if !h.sendProgressPulse(task) {
		b.Fatal("expected initial progress pulse")
	}

	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		if !h.sendProgressPulse(task) {
			b.Fatal("expected duplicate progress pulse to remain connected")
		}
	}
}

func TestStreamHandler_DuplicateProgressPulseSendsSmallHeartbeat(t *testing.T) {
	resp := httptest.NewRecorder()
	h := &streamHandler{
		w:      resp,
		taskID: "task-progress-duplicate",
		userID: 1,
		rc:     http.NewResponseController(resp),
	}
	task := &run.TaskState{
		AgentStatuses: []any{map[string]any{"agent_id": 0, "status": "PROCESSING...", "progress": 0.5}},
		ToolEvents:    []any{map[string]any{"toolName": "search"}},
	}

	assert.True(t, h.sendProgressPulse(task))
	h.lastProgressSentAt = time.Now().Add(-progressRepeatHeartbeatInterval)
	assert.True(t, h.sendProgressPulse(task))

	body := resp.Body.String()
	assert.Equal(t, 1, strings.Count(body, `"type":"progress"`))
	assert.Equal(t, 1, strings.Count(body, `"type":"pulse"`))
	assert.Contains(t, body, `"reason":"unchanged-progress"`)
}

func TestStreamHandler_DuplicateProgressPulseWithoutHeartbeat(t *testing.T) {
	resp := httptest.NewRecorder()
	h := &streamHandler{
		w:      resp,
		taskID: "task-progress-duplicate-no-heartbeat",
		userID: 1,
		rc:     http.NewResponseController(resp),
	}
	task := &run.TaskState{
		AgentStatuses: []any{map[string]any{"agent_id": 0, "status": "PROCESSING..."}},
	}

	assert.True(t, h.sendProgressPulse(task))
	assert.True(t, h.sendProgressPulse(task))
	body := resp.Body.String()
	assert.Equal(t, 1, strings.Count(body, `"type":"progress"`))
	assert.NotContains(t, body, `"type":"pulse"`)
}

func TestStreamHandler_DuplicateVersionProgressPulseBranches(t *testing.T) {
	resp := httptest.NewRecorder()
	h := &streamHandler{
		w:      resp,
		taskID: "task-progress-version-duplicate",
		userID: 1,
		rc:     http.NewResponseController(resp),
	}
	task := &run.TaskState{
		AgentStatuses:   []any{map[string]any{"agent_id": 0, "status": "PROCESSING..."}},
		ProgressVersion: 7,
		UpdatedAt:       time.Now().Unix(),
	}

	assert.True(t, h.sendProgressPulse(task))
	assert.True(t, h.sendProgressPulse(task))
	h.lastProgressSentAt = time.Now().Add(-progressRepeatHeartbeatInterval)
	assert.True(t, h.sendProgressPulse(task))

	body := resp.Body.String()
	assert.Equal(t, 1, strings.Count(body, `"type":"progress"`))
	assert.Equal(t, 1, strings.Count(body, `"type":"pulse"`))
}

func TestStreamHandler_SendProgressPulseDisconnect(t *testing.T) {
	w := &writeFailResponseWriter{}
	h := &streamHandler{
		w:      w,
		taskID: "task-progress-disconnect",
		userID: 1,
		rc:     http.NewResponseController(w),
	}
	assert.False(t, h.sendProgressPulse(&run.TaskState{
		AgentStatuses: []any{map[string]any{"status": "RUNNING"}},
	}))
}

func TestStreamHandler_SendProgressPulseMarshalFailure(t *testing.T) {
	resp := httptest.NewRecorder()
	h := &streamHandler{w: resp, taskID: "task-pulse-fail", userID: 1, rc: http.NewResponseController(resp)}
	assert.True(t, h.sendProgressPulse(&run.TaskState{AgentStatuses: []any{streamBadJSON{}}}))
}

func TestStreamHandler_SendSSEFlushFailure(t *testing.T) {
	base := httptest.NewRecorder()
	w := &flushFailResponseWriter{ResponseRecorder: base}
	h := &streamHandler{
		w:      w,
		taskID: "task-flush-fail",
		userID: 1,
		rc:     http.NewResponseController(w),
	}
	err := h.sendSSE([]byte(`{"type":"ping"}`))
	require.NoError(t, err)
	assert.Contains(t, base.Body.String(), `data: {"type":"ping"}`)
}

func TestStreamHandler_SendSSEWriteFailure(t *testing.T) {
	w := &writeFailResponseWriter{}
	h := &streamHandler{
		w:      w,
		taskID: "task-write-fail",
		userID: 1,
		rc:     http.NewResponseController(w),
	}
	assert.False(t, h.sendError("boom"))
	assert.False(t, h.sendFailedEvent(&run.TaskState{Error: "failed"}))
}

func TestStreamHandler_SendStartEventClientDisconnectStillMarksStarted(t *testing.T) {
	w := &writeFailResponseWriter{}
	h := &streamHandler{
		w:      w,
		taskID: "task-start-disconnect",
		userID: 1,
		rc:     http.NewResponseController(w),
	}
	h.sendStartEvent(&run.TaskState{ModelID: "gpt-4", AgentStatuses: []any{map[string]any{"status": "RUNNING"}}})
	assert.True(t, h.hasStarted)
}
