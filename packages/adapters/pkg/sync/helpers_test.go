package sync

import (
	"errors"
	"fmt"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/utils"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestSyncHelpers(t *testing.T) {
	t.Run("ToMessageRole", func(t *testing.T) {
		assert.Equal(t, "user", string(toMessageRole("user")))
		assert.Equal(t, "assistant", string(toMessageRole("unknown")))
	})

	t.Run("BuildPushPayload", func(t *testing.T) {
		p := []PendingChange{
			{Type: "conversation", EntityID: "c1", Operation: "create", CreatedAt: 1000},
			{Type: "deletion", EntityID: "c2", CreatedAt: 2000},
			{Type: "conversation", EntityID: "c3", Operation: "delete", CreatedAt: 3000},
		}
		req := BuildPushPayload(p, "dev1")
		assert.Equal(t, "dev1", req.DeviceID)
		assert.Len(t, req.Conversations, 1)
		assert.Len(t, req.Deletions, 2)
		assert.Equal(t, "conversation", req.Deletions[0].Type)
		assert.Equal(t, "conversation", req.Deletions[1].Type)
		assert.Equal(t, "c2", req.Deletions[0].ID)
		assert.Equal(t, "c3", req.Deletions[1].ID)
	})

	t.Run("ApplyPullResponse", func(t *testing.T) {
		storage := &MockSyncStorage{}
		longTitle := strings.Repeat("a", 150)
		resp := SyncPullResponse{
			Conversations: []ConversationSyncPayload{
				{ID: new(1), UserInput: longTitle, Timestamp: "2025-01-01T00:00:00Z", UpdatedAt: "2025-01-01T00:00:00Z"},
				{ID: new(2), IsDeleted: true},
			},
			Messages: []MessageSyncPayload{
				{MessageID: "m1", ConversationID: 1, Role: "user", Content: "hi", CreatedAt: "2025-01-01T00:00:00Z", UpdatedAt: "2025-01-01T00:00:00Z"},
			},
			Deletions: []DeletionRecord{
				{Type: "message", ID: "m2", DeletedAt: "2025-01-01T00:00:00Z"},
			},
			LatestVersion: 10,
		}

		storage.On("UpsertConversation", mock.MatchedBy(func(c StorageConversation) bool {
			return len(c.Title) == 120
		})).Return(nil)
		storage.On("DeleteConversation", "remote-2").Return(nil)
		storage.On("UpsertMessage", mock.Anything).Return(nil)
		storage.On("DeleteMessage", "m2").Return(nil)
		storage.On("SetLastSyncVersion", 10).Return(nil)

		err := ApplyPullResponse(storage, resp)
		require.NoError(t, err)
		storage.AssertExpectations(t)
	})

	t.Run("MapConflicts", func(t *testing.T) {
		resp := SyncPushResponse{
			Conflicts: []ConflictRecord{
				{Type: "msg", ID: "1", Reason: "older"},
			},
		}
		conflicts := MapConflicts(resp)
		assert.Len(t, conflicts, 1)
		assert.Equal(t, "older", conflicts[0].Reason)
	})

	t.Run("parseTimestamp", func(t *testing.T) {
		ts := parseTimestamp("2025-01-01T12:00:00Z")
		assert.NotZero(t, ts)

		ts2 := parseTimestamp("invalid")
		assert.Zero(t, ts2)
	})

	t.Run("ApplyConversationIDMappings", func(t *testing.T) {
		storage := &MockSyncStorage{}
		mappings := map[string]int{"local1": 123}

		storage.On("GetConversation", "local1").Return(utils.Ok(StorageConversation{ConversationID: "local1"}))
		storage.On("UpsertConversation", mock.MatchedBy(func(c StorageConversation) bool {
			return c.ConversationID == "remote-123"
		})).Return(nil)
		storage.On("GetMessages", "local1").Return([]StorageMessage{}, nil)
		storage.On("DeleteConversation", "local1").Return(nil)

		err := ApplyConversationIDMappings(storage, mappings)
		require.NoError(t, err)
		storage.AssertExpectations(t)
	})

	t.Run("ApplyPullResponse - Long Result", func(t *testing.T) {
		storage := &MockSyncStorage{}
		longResult := strings.Repeat("b", 300)
		resp := SyncPullResponse{
			Conversations: []ConversationSyncPayload{
				{ID: new(1), UserInput: "h", Result: longResult, Timestamp: "2025-01-01T00:00:00Z", UpdatedAt: "2025-01-01T00:00:00Z"},
			},
		}
		storage.On("UpsertConversation", mock.MatchedBy(func(c StorageConversation) bool {
			return len(*c.LastMessagePreview) == 240
		})).Return(nil)
		storage.On("SetLastSyncVersion", 0).Return(nil)

		err := ApplyPullResponse(storage, resp)
		assert.NoError(t, err)
	})

	t.Run("ApplyConversationIDMappings - Missing", func(t *testing.T) {
		storage := &MockSyncStorage{}
		mappings := map[string]int{"missing": 123}
		storage.On("GetConversation", "missing").Return(utils.Result[StorageConversation]{Ok: false})

		err := ApplyConversationIDMappings(storage, mappings)
		assert.NoError(t, err)
	})

	t.Run("ApplyPullResponse - Empty Title and Message Deleted", func(t *testing.T) {
		storage := &MockSyncStorage{}
		resp := SyncPullResponse{
			Conversations: []ConversationSyncPayload{
				{ID: new(1), UserInput: "", Timestamp: "2025-01-01T00:00:00Z", UpdatedAt: "2025-01-01T00:00:00Z"},
			},
			Messages: []MessageSyncPayload{
				{MessageID: "m1", IsDeleted: true},
			},
		}
		storage.On("UpsertConversation", mock.MatchedBy(func(c StorageConversation) bool {
			return c.Title == "Remote Conversation"
		})).Return(nil)
		storage.On("DeleteMessage", "m1").Return(nil)
		storage.On("SetLastSyncVersion", 0).Return(nil)

		err := ApplyPullResponse(storage, resp)
		assert.NoError(t, err)
	})

	t.Run("ApplyPullResponse - Message with Error and Elapsed", func(t *testing.T) {
		storage := &MockSyncStorage{}
		resp := SyncPullResponse{
			Messages: []MessageSyncPayload{
				{
					MessageID: "m1", ConversationID: 1, Role: "user", Content: "hi",
					Error: "some error", ElapsedSeconds: 5.5,
					CreatedAt: "2025-01-01T00:00:00Z", UpdatedAt: "2025-01-01T00:00:00Z",
				},
			},
		}
		storage.On("UpsertMessage", mock.MatchedBy(func(m StorageMessage) bool {
			return *m.Error == "some error" && *m.ElapsedSeconds == 5.5
		})).Return(nil)
		storage.On("SetLastSyncVersion", 0).Return(nil)

		err := ApplyPullResponse(storage, resp)
		assert.NoError(t, err)
	})

	t.Run("ApplyPullResponse - Deletion Records", func(t *testing.T) {
		storage := &MockSyncStorage{}
		resp := SyncPullResponse{
			Deletions: []DeletionRecord{
				{Type: "conversation", ID: "c1"},
				{Type: "message", ID: "m1"},
			},
		}
		storage.On("DeleteConversation", "c1").Return(nil)
		storage.On("DeleteMessage", "m1").Return(nil)
		storage.On("SetLastSyncVersion", 0).Return(nil)

		err := ApplyPullResponse(storage, resp)
		assert.NoError(t, err)
	})

	t.Run("ClearAcceptedPendingChanges - Simple EntityID", func(t *testing.T) {
		storage := &MockSyncStorage{}
		pending := []PendingChange{
			{ID: new(1), Type: "conversation", EntityID: "c1"},
		}
		accepted := []string{"c1"} // Not prefixed

		storage.On("RemovePendingChange", 1).Return(nil)

		err := ClearAcceptedPendingChanges(storage, pending, accepted)
		require.NoError(t, err)
		storage.AssertExpectations(t)
	})

	t.Run("BuildPushPayload - With Prompt", func(t *testing.T) {
		p := []PendingChange{
			{Type: "conversation", EntityID: "c1", Operation: "create", Data: map[string]any{"prompt": "hello"}},
		}
		req := BuildPushPayload(p, "dev1")
		assert.Equal(t, "hello", req.Conversations[0].UserInput)
	})

	t.Run("BuildPushPayload - Message Deletion Type", func(t *testing.T) {
		p := []PendingChange{
			{Type: "message", EntityID: "m1", Operation: "delete", CreatedAt: 4000},
			{Type: "deletion", EntityID: "m2", CreatedAt: 5000, Data: map[string]any{"type": "message"}},
		}

		req := BuildPushPayload(p, "dev1")
		assert.Len(t, req.Deletions, 2)
		assert.Equal(t, "message", req.Deletions[0].Type)
		assert.Equal(t, "message", req.Deletions[1].Type)
	})

	t.Run("BuildPushPayload - Includes Message Changes", func(t *testing.T) {
		p := []PendingChange{
			{
				Type:      "message",
				EntityID:  "m1",
				Operation: "create",
				CreatedAt: 1700000000000,
				Data: map[string]any{
					"messageId":           "m1",
					"conversationId":      "remote-42",
					"conversationLocalId": "local-conv",
					"role":                "user",
					"content":             "hello",
					"isStreaming":         true,
					"isAgentStatus":       false,
					"elapsedSeconds":      1.25,
					"syncVersion":         9,
					"createdAt":           "2025-01-01T00:00:00Z",
					"updatedAt":           "2025-01-01T00:00:01Z",
					"lastSyncedAt":        "2025-01-01T00:00:02Z",
				},
			},
		}

		req := BuildPushPayload(p, "dev1")
		assert.Len(t, req.Messages, 1)
		assert.Equal(t, "m1", req.Messages[0].MessageID)
		assert.Equal(t, 42, req.Messages[0].ConversationID)
		assert.Equal(t, "local-conv", req.Messages[0].ConversationLocalID)
		assert.Equal(t, "user", req.Messages[0].Role)
		assert.Equal(t, "hello", req.Messages[0].Content)
		assert.True(t, req.Messages[0].IsStreaming)
		assert.Equal(t, 1.25, req.Messages[0].ElapsedSeconds)
		assert.Equal(t, 9, req.Messages[0].SyncVersion)
		assert.Equal(t, "dev1", req.Messages[0].DeviceID)
		assert.Equal(t, "2025-01-01T00:00:00Z", req.Messages[0].CreatedAt)
		assert.Equal(t, "2025-01-01T00:00:01Z", req.Messages[0].UpdatedAt)
		assert.Equal(t, "2025-01-01T00:00:02Z", req.Messages[0].LastSyncedAt)
	})

	t.Run("BuildPushPayload - Drops Invalid Message Changes", func(t *testing.T) {
		p := []PendingChange{
			{
				Type:      "message",
				EntityID:  "m1",
				Operation: "create",
				CreatedAt: 1700000000000,
				Data: map[string]any{
					"role":    "user",
					"content": "hello",
				},
			},
		}

		req := BuildPushPayload(p, "dev1")
		assert.Empty(t, req.Messages)
	})

	t.Run("parseTimestamp - RFC3339 without offset", func(t *testing.T) {
		ts := parseTimestamp("2025-01-01T12:00:00")
		assert.Zero(t, ts)

		ts2 := parseTimestamp("2025-01-01T15:04:05Z")
		assert.NotZero(t, ts2)
	})

	t.Run("ApplyConversationIDMappings - Upsert Error", func(t *testing.T) {
		storage := &MockSyncStorage{}
		mappings := map[string]int{"local1": 123}
		storage.On("GetConversation", "local1").Return(utils.Ok(StorageConversation{ConversationID: "local1"}))
		storage.On("UpsertConversation", mock.Anything).Return(errors.New("upsert fail"))

		err := ApplyConversationIDMappings(storage, mappings)
		assert.Error(t, err)
	})

	t.Run("ApplyConversationIDMappings - Delete Error", func(t *testing.T) {
		storage := &MockSyncStorage{}
		mappings := map[string]int{"local1": 123}
		storage.On("GetConversation", "local1").Return(utils.Ok(StorageConversation{ConversationID: "local1"}))
		storage.On("UpsertConversation", mock.Anything).Return(nil)
		storage.On("GetMessages", "local1").Return([]StorageMessage{}, nil)
		storage.On("DeleteConversation", "local1").Return(errors.New("delete fail"))

		err := ApplyConversationIDMappings(storage, mappings)
		assert.Error(t, err)
	})

	t.Run("ApplyConversationIDMappings - Message Upsert Error", func(t *testing.T) {
		storage := &MockSyncStorage{}
		mappings := map[string]int{"local1": 123}

		storage.On("GetConversation", "local1").Return(utils.Ok(StorageConversation{ConversationID: "local1"}))
		storage.On("UpsertConversation", mock.Anything).Return(nil)
		storage.On("GetMessages", "local1").Return([]StorageMessage{
			{MessageID: "m1", ConversationID: "local1"},
		}, nil)
		storage.On("UpsertMessage", mock.Anything).Return(errors.New("message upsert fail"))

		err := ApplyConversationIDMappings(storage, mappings)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "message upsert fail")
	})

	t.Run("ClearAcceptedPendingChanges - Remove Error", func(t *testing.T) {
		storage := &MockSyncStorage{}
		pending := []PendingChange{
			{ID: new(1), Type: "conversation", EntityID: "c1"},
		}
		accepted := []string{"conversation:c1"}
		storage.On("RemovePendingChange", 1).Return(errors.New("remove fail"))

		err := ClearAcceptedPendingChanges(storage, pending, accepted)
		assert.Error(t, err)
	})

	t.Run("ApplyPullResponse - Storage Errors", func(t *testing.T) {
		storage := &MockSyncStorage{}
		resp := SyncPullResponse{
			Conversations: []ConversationSyncPayload{
				{ID: new(1), UserInput: "h", Timestamp: "2025-01-01T00:00:00Z", UpdatedAt: "2025-01-01T00:00:00Z"},
			},
		}
		storage.On("UpsertConversation", mock.Anything).Return(errors.New("fail"))

		err := ApplyPullResponse(storage, resp)
		assert.Error(t, err)
	})

	t.Run("ApplyPullResponse - Message Delete Error", func(t *testing.T) {
		storage := &MockSyncStorage{}
		resp := SyncPullResponse{
			Messages: []MessageSyncPayload{{MessageID: "m1", IsDeleted: true}},
		}
		storage.On("DeleteMessage", "m1").Return(errors.New("fail"))
		err := ApplyPullResponse(storage, resp)
		assert.Error(t, err)
	})

	t.Run("ApplyPullResponse - Deletion Records Error", func(t *testing.T) {
		storage := &MockSyncStorage{}
		resp := SyncPullResponse{
			Deletions: []DeletionRecord{{Type: "conversation", ID: "c1"}},
		}
		storage.On("DeleteConversation", "c1").Return(errors.New("fail"))
		err := ApplyPullResponse(storage, resp)
		assert.Error(t, err)
	})

	t.Run("ApplyPullResponse - Message Deletion Record Error", func(t *testing.T) {
		storage := &MockSyncStorage{}
		resp := SyncPullResponse{
			Deletions: []DeletionRecord{{Type: "message", ID: "m1"}},
		}
		storage.On("DeleteMessage", "m1").Return(errors.New("fail"))
		err := ApplyPullResponse(storage, resp)
		assert.Error(t, err)
	})

	t.Run("ApplyPullResponse - SetLastSyncVersion Error", func(t *testing.T) {
		storage := &MockSyncStorage{}
		storage.On("SetLastSyncVersion", 5).Return(errors.New("fail"))
		err := ApplyPullResponse(storage, SyncPullResponse{LatestVersion: 5})
		assert.Error(t, err)
	})

	t.Run("ApplyPullResponse - Individual Delete Error", func(t *testing.T) {
		storage := &MockSyncStorage{}
		resp := SyncPullResponse{
			Conversations: []ConversationSyncPayload{
				{ID: new(1), IsDeleted: true},
			},
		}
		storage.On("DeleteConversation", "remote-1").Return(errors.New("fail"))
		err := ApplyPullResponse(storage, resp)
		assert.Error(t, err)
	})

	t.Run("ApplyPullResponse - UpsertMessage Error", func(t *testing.T) {
		storage := &MockSyncStorage{}
		resp := SyncPullResponse{
			Messages: []MessageSyncPayload{{
				MessageID:      "m1",
				ConversationID: 1,
				Role:           "user",
				Content:        "h",
				CreatedAt:      "2025-01-01T00:00:00Z",
				UpdatedAt:      "2025-01-01T00:00:00Z",
			}},
		}
		storage.On("UpsertMessage", mock.Anything).Return(errors.New("fail"))
		err := ApplyPullResponse(storage, resp)
		assert.Error(t, err)
	})

	t.Run("ApplyPullResponse - Nil ID and Unknown Deletion Type", func(t *testing.T) {
		storage := &MockSyncStorage{}
		resp := SyncPullResponse{
			Conversations: []ConversationSyncPayload{
				{ID: nil, IsDeleted: true},
			},
			Deletions: []DeletionRecord{
				{Type: "unknown", ID: "x"},
			},
		}
		storage.On("SetLastSyncVersion", 0).Return(nil)

		err := ApplyPullResponse(storage, resp)
		assert.NoError(t, err)
	})

	t.Run("ApplyPullResponse - Nil ID for Non-Deleted Conversation", func(t *testing.T) {
		storage := &MockSyncStorage{}
		resp := SyncPullResponse{
			Conversations: []ConversationSyncPayload{
				{ID: nil, UserInput: "hello", Timestamp: "2025-01-01T00:00:00Z", UpdatedAt: "2025-01-01T00:00:00Z"},
			},
		}

		err := ApplyPullResponse(storage, resp)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "conversation id is required")
	})

	t.Run("ApplyPullResponse - Invalid Conversation Timestamp", func(t *testing.T) {
		storage := &MockSyncStorage{}
		resp := SyncPullResponse{
			Conversations: []ConversationSyncPayload{
				{ID: new(1), UserInput: "hello", Timestamp: "invalid", UpdatedAt: "2025-01-01T00:00:00Z"},
			},
		}

		err := ApplyPullResponse(storage, resp)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "invalid conversation timestamp")
	})

	t.Run("ApplyPullResponse - Invalid Message Timestamp", func(t *testing.T) {
		storage := &MockSyncStorage{}
		resp := SyncPullResponse{
			Messages: []MessageSyncPayload{
				{MessageID: "m1", ConversationID: 1, Role: "user", Content: "hi", CreatedAt: "invalid", UpdatedAt: "2025-01-01T00:00:00Z"},
			},
		}

		err := ApplyPullResponse(storage, resp)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "invalid message createdAt")
	})

	t.Run("ClearAcceptedPendingChanges - Ambiguous Untyped IDs Are Not Removed", func(t *testing.T) {
		storage := &MockSyncStorage{}
		pending := []PendingChange{
			{ID: new(1), Type: "conversation", EntityID: "shared-id"},
			{ID: new(2), Type: "message", EntityID: "shared-id"},
		}

		storage.On("RemovePendingChange", mock.Anything).Return(nil).Maybe()

		err := ClearAcceptedPendingChanges(storage, pending, []string{"shared-id"})
		require.NoError(t, err)
		storage.AssertNotCalled(t, "RemovePendingChange", 1)
		storage.AssertNotCalled(t, "RemovePendingChange", 2)
	})

	t.Run("ClearAcceptedPendingChanges - Typed IDs Remove Matching Type Only", func(t *testing.T) {
		storage := &MockSyncStorage{}
		pending := []PendingChange{
			{ID: new(1), Type: "conversation", EntityID: "shared-id"},
			{ID: new(2), Type: "message", EntityID: "shared-id"},
		}

		storage.On("RemovePendingChange", 1).Return(nil)

		err := ClearAcceptedPendingChanges(storage, pending, []string{"conversation:shared-id"})
		require.NoError(t, err)
		storage.AssertCalled(t, "RemovePendingChange", 1)
		storage.AssertNotCalled(t, "RemovePendingChange", 2)
	})

	t.Run("ClearAcceptedPendingChanges - Deletion Accepted IDs Remove Delete Operations", func(t *testing.T) {
		storage := &MockSyncStorage{}
		pending := []PendingChange{
			{ID: new(1), Type: "conversation", EntityID: "remote-1", Operation: "delete"},
			{ID: new(2), Type: "message", EntityID: "msg-2", Operation: "delete"},
			{ID: new(3), Type: "deletion", EntityID: "legacy-3"},
		}

		storage.On("RemovePendingChange", 1).Return(nil)
		storage.On("RemovePendingChange", 2).Return(nil)
		storage.On("RemovePendingChange", 3).Return(nil)

		err := ClearAcceptedPendingChanges(storage, pending, []string{
			"deletion:remote-1",
			"deletion:msg-2",
			"deletion:legacy-3",
		})
		require.NoError(t, err)
		storage.AssertCalled(t, "RemovePendingChange", 1)
		storage.AssertCalled(t, "RemovePendingChange", 2)
		storage.AssertCalled(t, "RemovePendingChange", 3)
	})
}

func TestSyncPrimitiveConversionHelpers(t *testing.T) {
	t.Run("intValue covers integer and floating inputs", func(t *testing.T) {
		assert.Equal(t, 7, intValue(int8(7), 0))
		assert.Equal(t, 8, intValue(int16(8), 0))
		assert.Equal(t, 9, intValue(int32(9), 0))
		assert.Equal(t, 10, intValue(int64(10), 0))
		assert.Equal(t, 11, intValue(float32(11.9), 0))
		assert.Equal(t, 99, intValue(float32(math.NaN()), 99))
		assert.Equal(t, 99, intValue(float32(math.Inf(1)), 99))
		assert.Equal(t, 12, intValue(float64(12.9), 0))
		assert.Equal(t, 99, intValue(math.NaN(), 99))
		assert.Equal(t, 99, intValue(math.Inf(1), 99))
		assert.Equal(t, 99, intValue("12", 99))
	})

	t.Run("toISOTimestamp covers numeric string and fallback inputs", func(t *testing.T) {
		assert.Equal(t, "1970-01-01T00:00:01Z", toISOTimestamp(int(1000), 0))
		assert.Equal(t, "1970-01-01T00:00:00Z", toISOTimestamp(int8(2), 0))
		assert.Equal(t, "1970-01-01T00:00:03Z", toISOTimestamp(int16(3000), 0))
		assert.Equal(t, "1970-01-01T00:00:04Z", toISOTimestamp(int32(4000), 0))
		assert.Equal(t, "1970-01-01T00:00:05Z", toISOTimestamp(int64(5000), 0))
		assert.Equal(t, "1970-01-01T00:00:06Z", toISOTimestamp(float32(6000), 0))
		assert.Equal(t, "1970-01-01T00:00:07Z", toISOTimestamp(float64(7000), 0))
		assert.Equal(t, "2025-01-01T00:00:00Z", toISOTimestamp("2025-01-01T00:00:00Z", 0))
		assert.Equal(t, "1970-01-01T00:00:08Z", toISOTimestamp(math.NaN(), 8000))
		assert.Equal(t, "1970-01-01T00:00:08Z", toISOTimestamp(math.Inf(1), 8000))
		assert.Equal(t, "1970-01-01T00:00:08Z", toISOTimestamp("not a time", 8000))
	})

	t.Run("toSyncID accepts positive numeric and remote string forms", func(t *testing.T) {
		for _, value := range []any{1, int8(2), int16(3), int32(4), int64(5), float32(6), float64(7), "remote-8", "9"} {
			got, ok := toSyncID(value)
			assert.Truef(t, ok, "value %v should parse", value)
			assert.Positive(t, got)
		}
		for _, value := range []any{0, int8(0), int16(-1), int32(0), int64(-2), float32(0), math.NaN(), math.Inf(1), "remote-0", "bad", nil} {
			got, ok := toSyncID(value)
			assert.Falsef(t, ok, "value %v should not parse", value)
			assert.Zero(t, got)
		}
	})

	t.Run("extractPrompt handles marshal and unmarshal fallbacks", func(t *testing.T) {
		assert.Equal(t, "direct", extractPrompt(map[string]any{"prompt": "direct"}))
		assert.Equal(t, "struct", extractPrompt(struct {
			Prompt string `json:"prompt"`
		}{Prompt: "struct"}))
		assert.Empty(t, extractPrompt(make(chan int)))
		assert.Empty(t, extractPrompt("not object json"))
	})

	t.Run("deletionTypeForChange falls back safely", func(t *testing.T) {
		assert.Equal(t, "message", deletionTypeForChange(PendingChange{Type: "message"}))
		assert.Equal(t, "conversation", deletionTypeForChange(PendingChange{Type: "conversation"}))
		assert.Equal(t, "message", deletionTypeForChange(PendingChange{Type: "deletion", Data: map[string]any{"type": "message"}}))
		assert.Equal(t, "conversation", deletionTypeForChange(PendingChange{Type: "deletion", Data: map[string]any{"type": "other"}}))
	})

	t.Run("parseOptionalTimestamp accepts empty and alternate strict format", func(t *testing.T) {
		got, err := parseOptionalTimestamp("field", " ")
		require.NoError(t, err)
		assert.Zero(t, got)

		got, err = parseOptionalTimestamp("field", "2025-01-01T00:00:00Z")
		require.NoError(t, err)
		assert.Equal(t, time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC).UnixMilli(), got)
	})

	t.Run("ApplyPullResponse handles additional timestamp and message validation errors", func(t *testing.T) {
		storage := &MockSyncStorage{}

		err := ApplyPullResponse(storage, SyncPullResponse{
			Conversations: []ConversationSyncPayload{
				{ID: new(1), UserInput: "hello", Timestamp: "2025-01-01T00:00:00Z", UpdatedAt: "invalid"},
			},
		})
		require.ErrorContains(t, err, "invalid conversation updatedAt")

		err = ApplyPullResponse(storage, SyncPullResponse{
			Conversations: []ConversationSyncPayload{
				{ID: new(1), UserInput: "hello", Timestamp: "2025-01-01T00:00:00Z", UpdatedAt: "2025-01-01T00:00:00Z", LastSyncedAt: "invalid"},
			},
		})
		require.ErrorContains(t, err, "invalid conversation lastSyncedAt")

		err = ApplyPullResponse(storage, SyncPullResponse{
			Messages: []MessageSyncPayload{
				{MessageID: "m1", ConversationID: 0, Role: "user", Content: "hi", CreatedAt: "2025-01-01T00:00:00Z", UpdatedAt: "2025-01-01T00:00:00Z"},
			},
		})
		require.ErrorContains(t, err, "conversation id is required")

		err = ApplyPullResponse(storage, SyncPullResponse{
			Messages: []MessageSyncPayload{
				{MessageID: "m1", ConversationID: 1, Role: "user", Content: "hi", CreatedAt: "2025-01-01T00:00:00Z", UpdatedAt: "invalid"},
			},
		})
		require.ErrorContains(t, err, "invalid message updatedAt")

		err = ApplyPullResponse(storage, SyncPullResponse{
			Messages: []MessageSyncPayload{
				{MessageID: "m1", ConversationID: 1, Role: "user", Content: "hi", CreatedAt: "2025-01-01T00:00:00Z", UpdatedAt: "2025-01-01T00:00:00Z", LastSyncedAt: "invalid"},
			},
		})
		assert.ErrorContains(t, err, "invalid message lastSyncedAt")
	})

	t.Run("ApplyPullResponse stores message error field", func(t *testing.T) {
		storage := &MockSyncStorage{}
		storage.On("UpsertMessage", mock.MatchedBy(func(msg StorageMessage) bool {
			return msg.Error != nil && *msg.Error == "failed"
		})).Return(nil)
		storage.On("SetLastSyncVersion", 0).Return(nil)

		err := ApplyPullResponse(storage, SyncPullResponse{
			Messages: []MessageSyncPayload{
				{
					MessageID:      "m1",
					ConversationID: 1,
					Role:           "assistant",
					Content:        "oops",
					Error:          "failed",
					CreatedAt:      "2025-01-01T00:00:00Z",
					UpdatedAt:      "2025-01-01T00:00:00Z",
				},
			},
		})
		assert.NoError(t, err)
	})

	t.Run("toMessagePayload covers optional fields", func(t *testing.T) {
		changeID := 1
		payload, ok := toMessagePayload(PendingChange{
			ID:       &changeID,
			EntityID: "m-local",
			Data: map[string]any{
				"messageId":           "m-local",
				"content":             "hello",
				"role":                "user",
				"conversationId":      float64(3),
				"conversationLocalId": "local-3",
				"elapsedSeconds":      float64(1.5),
				"error":               "failed",
				"sources":             []any{"source"},
				"toolEvents":          []any{"tool"},
				"agentStatuses":       []any{"running"},
				"isStreaming":         true,
				"isAgentStatus":       true,
			},
			CreatedAt: 1000,
		}, "device-1")

		assert.True(t, ok)
		assert.Equal(t, "m-local", payload.MessageID)
		assert.Equal(t, 3, payload.ConversationID)
		assert.Equal(t, "local-3", payload.ConversationLocalID)
		assert.Equal(t, 1.5, payload.ElapsedSeconds)
		assert.Equal(t, "failed", payload.Error)
		assert.True(t, payload.IsStreaming)
		assert.True(t, payload.IsAgentStatus)
		assert.NotNil(t, payload.Sources)
		assert.NotNil(t, payload.ToolEvents)
		assert.NotNil(t, payload.AgentStatuses)
	})

	t.Run("toMessagePayload rejects invalid payloads", func(t *testing.T) {
		_, ok := toMessagePayload(PendingChange{Data: "not-a-map"}, "device-1")
		assert.False(t, ok)

		_, ok = toMessagePayload(PendingChange{EntityID: "", Data: map[string]any{"content": "hello", "conversationId": float64(1)}}, "device-1")
		assert.False(t, ok)

		payload, ok := toMessagePayload(PendingChange{EntityID: "m1", Data: map[string]any{"content": " ", "conversationId": float64(1), "isDeleted": true}}, "device-1")
		assert.True(t, ok)
		assert.True(t, payload.IsDeleted)

		_, ok = toMessagePayload(PendingChange{EntityID: "m1", Data: map[string]any{"content": " ", "conversationId": float64(1)}}, "device-1")
		assert.False(t, ok)

		_, ok = toMessagePayload(PendingChange{EntityID: "m1", Data: map[string]any{"content": "hello", "conversationId": float64(0)}}, "device-1")
		assert.False(t, ok)
	})

	t.Run("extractPrompt returns empty for map without prompt", func(t *testing.T) {
		assert.Empty(t, extractPrompt(map[string]any{"other": "value"}))
	})

	t.Run("deletionTypeForChange prefers conversation type from data", func(t *testing.T) {
		assert.Equal(t, "conversation", deletionTypeForChange(PendingChange{
			Type: "deletion",
			Data: map[string]any{"type": "conversation"},
		}))
	})

	t.Run("ApplyConversationIDMappings propagates storage errors", func(t *testing.T) {
		storage := &MockSyncStorage{}
		storage.On("GetConversation", "local-1").Return(utils.Ok(StorageConversation{
			ConversationID: "local-1",
			Title:          "title",
		}))
		storage.On("UpsertConversation", mock.Anything).Return(nil)
		storage.On("GetMessages", "local-1").Return(nil, errors.New("messages failed"))

		err := ApplyConversationIDMappings(storage, map[string]int{"local-1": 9})
		assert.ErrorContains(t, err, "messages failed")
	})

	t.Run("ClearAcceptedPendingChanges skips duplicate removals", func(t *testing.T) {
		storage := &MockSyncStorage{}
		pending := []PendingChange{
			{ID: new(1), Type: "conversation", EntityID: "entity-1"},
			{ID: new(1), Type: "conversation", EntityID: "entity-1"},
		}

		storage.On("RemovePendingChange", 1).Return(nil).Once()

		err := ClearAcceptedPendingChanges(storage, pending, []string{"conversation:entity-1"})
		require.NoError(t, err)
		storage.AssertNumberOfCalls(t, "RemovePendingChange", 1)
	})

	t.Run("hasAmbiguousPendingTypes skips nil IDs", func(t *testing.T) {
		id := 1
		assert.False(t, hasAmbiguousPendingTypes([]PendingChange{
			{ID: nil, Type: "conversation", EntityID: "same"},
			{ID: &id, Type: "conversation", EntityID: "other"},
		}, "same"))
	})
}

type MockSyncStorage struct {
	mock.Mock
}

func (m *MockSyncStorage) GetConversations(limit int) ([]StorageConversation, error) { return nil, nil }
func (m *MockSyncStorage) GetConversation(id string) utils.Result[StorageConversation] {
	args := m.Called(id)
	result, ok := args.Get(0).(utils.Result[StorageConversation])
	if !ok {
		return utils.Err[StorageConversation](fmt.Errorf("unexpected conversation result type: %T", args.Get(0)))
	}
	return result
}
func (m *MockSyncStorage) UpsertConversation(c StorageConversation) error {
	return m.Called(c).Error(0)
}
func (m *MockSyncStorage) DeleteConversation(id string) error { return m.Called(id).Error(0) }
func (m *MockSyncStorage) GetMessages(id string) ([]StorageMessage, error) {
	args := m.Called(id)
	if messages, ok := args.Get(0).([]StorageMessage); ok {
		return messages, args.Error(1)
	}
	return nil, args.Error(1)
}
func (m *MockSyncStorage) GetMessage(id string) utils.Result[StorageMessage] {
	return utils.Result[StorageMessage]{}
}
func (m *MockSyncStorage) UpsertMessage(msg StorageMessage) error             { return m.Called(msg).Error(0) }
func (m *MockSyncStorage) DeleteMessage(id string) error                      { return m.Called(id).Error(0) }
func (m *MockSyncStorage) GetPendingChanges() ([]PendingChange, error)        { return nil, nil }
func (m *MockSyncStorage) AddPendingChange(c PendingChange) error             { return nil }
func (m *MockSyncStorage) UpdatePendingChange(id int, d map[string]any) error { return nil }
func (m *MockSyncStorage) RemovePendingChange(id int) error                   { return m.Called(id).Error(0) }
func (m *MockSyncStorage) ClearPendingChanges() error                         { return nil }
func (m *MockSyncStorage) UpdatePendingChangeData(id int, d any) error        { return nil }
func (m *MockSyncStorage) GetLastSyncVersion() (int, error)                   { return 0, nil }
func (m *MockSyncStorage) SetLastSyncVersion(v int) error                     { return m.Called(v).Error(0) }
func (m *MockSyncStorage) GetDeviceID() (string, error)                       { return "", nil }
func (m *MockSyncStorage) SetDeviceID(id string) error                        { return nil }
