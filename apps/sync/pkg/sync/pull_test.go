package sync

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestMapMessageToPayloadDecodesJSONMetadata(t *testing.T) {
	msg := MessageRecord{
		MessageID:      "msg-1",
		ConversationID: 7,
		Role:           "assistant",
		Content:        "",
		IsAgentStatus:  true,
		ElapsedSeconds: ptrFloat64(42),
		CreatedAt:      Timestamp{Time: time.Unix(10, 0), Valid: true},
		Sources:        []byte(`[{"url":"https://example.com","title":"Example"}]`),
		ToolEvents: []byte(`[
			{
				"agentLabel":"Gemini",
				"toolName":"search",
				"success":true,
				"durationMs":14,
				"arguments":{"q":"news"},
				"sources":[{"url":"https://news.example"}]
			}
		]`),
		AgentStatuses: []byte(`[
			{
				"agent_id":0,
				"status":"COMPLETED",
				"progress":1,
				"model":"gemini-3.1-pro",
				"reasoning":"searched"
			}
		]`),
		Trace:        []byte(`{"steps":[{"tool":"secret"}]}`),
		LastSyncedAt: Timestamp{Time: time.Unix(11, 0), Valid: true},
		UpdatedAt:    Timestamp{Time: time.Unix(12, 0), Valid: true},
	}

	payload := mapMessageToPayload(msg)
	require.IsType(t, json.RawMessage{}, payload.Sources)
	require.IsType(t, json.RawMessage{}, payload.ToolEvents)
	require.IsType(t, json.RawMessage{}, payload.AgentStatuses)

	encoded, err := json.Marshal(payload)
	require.NoError(t, err)

	var decoded map[string]any
	require.NoError(t, json.Unmarshal(encoded, &decoded))
	require.IsType(t, []any{}, decoded["sources"])
	require.IsType(t, []any{}, decoded["tool_events"])
	require.IsType(t, []any{}, decoded["agent_statuses"])
	require.NotContains(t, decoded, "trace")

	statuses := decoded["agent_statuses"].([]any)
	status := statuses[0].(map[string]any)
	require.Equal(t, "gemini-3.1-pro", status["model"])
	require.Equal(t, "searched", status["reasoning"])
}

func TestJsonColumnValue_InvalidAndEmpty(t *testing.T) {
	require.Nil(t, jsonColumnValue(nil))
	require.Nil(t, jsonColumnValue([]byte(`{"bad"`)))

	raw := []byte(`{"ok":true}`)
	value := jsonColumnValue(raw)
	require.IsType(t, json.RawMessage{}, value)
	raw[0] = '['
	require.JSONEq(t, `{"ok":true}`, string(value.(json.RawMessage)))
}

func TestSortedChangeRefsTieBreakers(t *testing.T) {
	updatedAt := timestampForTest(time.Unix(1_700_000_000, 0))
	conversations := []ConversationRecord{
		{ID: 2, SyncVersion: 5, UpdatedAt: updatedAt},
		{ID: 1, SyncVersion: 5, UpdatedAt: updatedAt},
	}
	messages := []MessageRecord{
		{MessageID: "msg-1", SyncVersion: 5, UpdatedAt: updatedAt},
	}

	refs := sortedChangeRefs(conversations, messages)

	require.Equal(t, []changeRef{
		{kind: 0, index: 0, version: 5, updatedAt: updatedAt.Time},
		{kind: 0, index: 1, version: 5, updatedAt: updatedAt.Time},
		{kind: 1, index: 0, version: 5, updatedAt: updatedAt.Time},
	}, refs)
}

func TestTrimPullResponseToJSONBudget_TrimToSingleFits(t *testing.T) {
	conversations, messages := makeBenchmarkPullRows(1, 1, 64)
	one := buildPullResponse(0, conversations, nil, true, "state")
	oneMessage := buildPullResponse(0, nil, messages, true, "state")
	budget := max(jsonPayloadSize(one), jsonPayloadSize(oneMessage))

	response, trimmed, err := trimPullResponseToJSONBudget(0, conversations, messages, false, "state", budget)

	require.NoError(t, err)
	require.True(t, trimmed)
	require.Equal(t, 1, len(response.Conversations)+len(response.Messages))
}

func TestTrimPullResponseToJSONBudget_RejectsWhenEveryChangeTooLarge(t *testing.T) {
	conversations, _ := makeBenchmarkPullRows(2, 0, 2048)

	response, trimmed, err := trimPullResponseToJSONBudget(0, conversations, nil, false, "state", 1)

	require.True(t, trimmed)
	require.ErrorIs(t, err, errSyncPullChangeExceedsBudget)
	require.Empty(t, response.Conversations)
}

func TestTrimPullResponseToJSONBudget_EmptyResponseOverBudget(t *testing.T) {
	stateHash := strings.Repeat("x", 128)

	response, trimmed, err := trimPullResponseToJSONBudget(0, nil, nil, false, stateHash, 1)

	require.NoError(t, err)
	require.True(t, trimmed)
	require.Equal(t, stateHash, response.StateHash)
}

func TestTrimPullResponseRowsToJSONBudget_CapsHugeSearchHigh(t *testing.T) {
	conversations, _ := makeBenchmarkPullRows(1, 0, 16)
	refs := sortedChangeRefs(conversations, nil)

	response, ok := trimPullResponseRowsToJSONBudget(0, conversations, nil, refs, "", math.MaxInt, math.MaxInt32+10)

	require.True(t, ok)
	require.Len(t, response.Conversations, 1)
}

func TestTrimPullResponseRowsToJSONBudget_ReducesWhenCandidateTooLarge(t *testing.T) {
	conversations, _ := makeBenchmarkPullRows(3, 0, 128)
	refs := sortedChangeRefs(conversations, nil)
	one := buildPullResponse(0, conversations[:1], nil, true, "state")
	two := buildPullResponse(0, conversations[:2], nil, true, "state")
	budget := jsonPayloadSize(two) - 1
	require.LessOrEqual(t, jsonPayloadSize(one), budget)

	response, ok := trimPullResponseRowsToJSONBudget(0, conversations, nil, refs, "state", budget, len(conversations))

	require.True(t, ok)
	require.Len(t, response.Conversations, 1)
}

func TestJSONPayloadSize_MarshalError(t *testing.T) {
	response := SyncPullResponse{
		Messages: []MessageSyncPayload{{
			MessageID: "msg-1",
			Sources:   math.Inf(1),
		}},
	}

	require.Positive(t, jsonPayloadSize(response))
}

func TestJSONUpperBoundHelpers(t *testing.T) {
	require.False(t, pullResponseFitsJSONBudget(SyncPullResponse{
		Messages: []MessageSyncPayload{{MessageID: "msg-1", Sources: json.RawMessage(`{`)}},
	}, 1))

	size, ok := jsonAnyUpperBound(json.RawMessage(`{`))
	require.False(t, ok)
	require.Zero(t, size)

	size, ok = jsonAnyUpperBound([]byte("abc"))
	require.True(t, ok)
	require.Equal(t, jsonByteStringUpperBound([]byte("abc")), size)

	size, ok = jsonAnyUpperBound("abc")
	require.True(t, ok)
	require.Equal(t, jsonStringUpperBound("abc"), size)

	require.Equal(t, 6, jsonByteStringUpperBound([]byte("a")))
	require.Equal(t, math.MaxInt, jsonRawMessageUpperBoundLength((math.MaxInt-2)/6+1))
	require.Equal(t, math.MaxInt, addBounded(math.MaxInt-1, 2))
}

func TestBoundedInt32Count(t *testing.T) {
	require.Equal(t, int32(math.MaxInt32), boundedInt32Count(math.MaxInt32+1))
	require.Equal(t, int32(math.MinInt32), boundedInt32Count(math.MinInt32-1))
	require.Equal(t, int32(42), boundedInt32Count(42))
}

func BenchmarkTrimChangesByGlobalLimit_MixedRows(b *testing.B) {
	conversations, messages := makeBenchmarkPullRows(1000, 1000, 256)

	b.ReportAllocs()
	for b.Loop() {
		trimmedConversations, trimmedMessages, hasMore := trimChangesByGlobalLimit(conversations, messages, 100)
		if !hasMore || len(trimmedConversations)+len(trimmedMessages) != 100 {
			b.Fatalf("trimmed rows = %d, hasMore = %t", len(trimmedConversations)+len(trimmedMessages), hasMore)
		}
	}
}

func BenchmarkTrimPullResponseToJSONBudget_MixedRows(b *testing.B) {
	conversations, messages := makeBenchmarkPullRows(500, 500, 512)
	oneHundred := buildPullResponse(0, conversations[:50], messages[:50], true, "500:500")
	budget := jsonPayloadSize(oneHundred)

	b.ReportAllocs()
	for b.Loop() {
		response, trimmed, err := trimPullResponseToJSONBudget(0, conversations, messages, false, "500:500", budget)
		if err != nil {
			b.Fatal(err)
		}
		if !trimmed || len(response.Conversations)+len(response.Messages) == 0 {
			b.Fatalf("trimmed = %t, rows = %d", trimmed, len(response.Conversations)+len(response.Messages))
		}
	}
}

func TestConservativePullResponseJSONUpperBoundCoversEncodedSize(t *testing.T) {
	conversations, messages := makeBenchmarkPullRows(3, 3, 128)
	response := buildPullResponse(0, conversations, messages, false, "3:3")

	upperBound, ok := conservativePullResponseJSONUpperBound(response)
	require.True(t, ok)
	require.GreaterOrEqual(t, upperBound, jsonPayloadSize(response))
	require.True(t, pullResponseFitsJSONBudget(response, upperBound))
}

func TestConservativePullResponseJSONUpperBoundCoversEscapedRawMessage(t *testing.T) {
	rawSources := json.RawMessage(`["` + strings.Repeat("<>&", 256) + `"]`)
	response := SyncPullResponse{
		Messages: []MessageSyncPayload{{
			MessageID: "msg-1",
			Sources:   rawSources,
		}},
	}

	upperBound, ok := conservativePullResponseJSONUpperBound(response)
	require.True(t, ok)
	require.GreaterOrEqual(t, upperBound, jsonPayloadSize(response))
	require.True(t, pullResponseFitsJSONBudget(response, upperBound))
}

func TestConservativePullResponseJSONUpperBoundRequiresKnownJSONShapes(t *testing.T) {
	response := SyncPullResponse{
		Messages: []MessageSyncPayload{{
			MessageID: "msg-1",
			Sources:   map[string]any{"dynamic": true},
		}},
	}

	_, ok := conservativePullResponseJSONUpperBound(response)
	require.False(t, ok)
	require.True(t, pullResponseFitsJSONBudget(response, jsonPayloadSize(response)))
}

func makeBenchmarkPullRows(conversationCount, messageCount, contentBytes int) ([]ConversationRecord, []MessageRecord) {
	conversations := make([]ConversationRecord, conversationCount)
	messages := make([]MessageRecord, messageCount)
	updatedAt := timestampForTest(time.Unix(1_700_000_000, 0))
	content := strings.Repeat("x", contentBytes)

	for i := range conversations {
		conversations[i] = ConversationRecord{
			ID:          int32(i + 1),
			UserInput:   content,
			SyncVersion: int32(i*2 + 2),
			UpdatedAt:   updatedAt,
			Timestamp:   updatedAt,
		}
	}
	for i := range messages {
		messages[i] = MessageRecord{
			MessageID:      fmt.Sprintf("msg-%04d", i),
			ConversationID: int32((i % max(1, conversationCount)) + 1),
			Content:        content,
			SyncVersion:    int32(i*2 + 1),
			UpdatedAt:      updatedAt,
			CreatedAt:      updatedAt,
		}
	}

	return conversations, messages
}

//go:fix inline
func ptrFloat64(value float64) *float64 {
	return new(value)
}
