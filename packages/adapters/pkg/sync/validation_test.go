package sync

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSyncValidation(t *testing.T) {
	t.Run("Conversation - Valid", func(t *testing.T) {
		c := ConversationSyncPayload{
			Timestamp: "2025-01-01T00:00:00Z",
			UserInput: "hi",
			UpdatedAt: "2025-01-01T00:00:00Z",
		}
		assert.NoError(t, c.Validate())
	})

	t.Run("Conversation - Invalid Fields", func(t *testing.T) {
		require.Error(t, ConversationSyncPayload{UserInput: "h", UpdatedAt: "u"}.Validate()) // Missing Timestamp
		require.Error(t, ConversationSyncPayload{Timestamp: "t", UpdatedAt: "u"}.Validate()) // Missing UserInput
		assert.Error(t, ConversationSyncPayload{Timestamp: "t", UserInput: "h"}.Validate())  // Missing UpdatedAt
	})

	t.Run("Message - Invalid Fields", func(t *testing.T) {
		m := MessageSyncPayload{}
		require.Error(t, m.Validate())
		require.Error(t, MessageSyncPayload{MessageID: "m1"}.Validate())
		require.Error(t, MessageSyncPayload{MessageID: "m1", Role: "user"}.Validate())
		require.Error(t, MessageSyncPayload{MessageID: "m1", Role: "user", Content: "c"}.Validate())
		assert.Error(t, MessageSyncPayload{MessageID: "m1", Role: "user", Content: "c", CreatedAt: "t"}.Validate())
	})

	t.Run("Deletion - Invalid Fields", func(t *testing.T) {
		require.Error(t, DeletionRecord{Type: "invalid", ID: "c1", DeletedAt: "t"}.Validate())
		require.Error(t, DeletionRecord{Type: "conversation", DeletedAt: "t"}.Validate())
		assert.Error(t, DeletionRecord{Type: "conversation", ID: "c1"}.Validate())
	})

	t.Run("SyncPullResponse - Nested Invalid", func(t *testing.T) {
		require.Error(t, SyncPullResponse{Messages: []MessageSyncPayload{{MessageID: "m1"}}}.Validate())
		assert.Error(t, SyncPullResponse{Deletions: []DeletionRecord{{Type: "invalid"}}}.Validate())
	})

	t.Run("Message - Valid", func(t *testing.T) {
		m := MessageSyncPayload{
			MessageID: "m1",
			Role:      "user",
			Content:   "hi",
			CreatedAt: "2025-01-01T00:00:00Z",
			UpdatedAt: "2025-01-01T00:00:00Z",
		}
		assert.NoError(t, m.Validate())
	})

	t.Run("Message - Deleted Allows Empty Content", func(t *testing.T) {
		m := MessageSyncPayload{
			MessageID: "m1",
			Role:      "user",
			IsDeleted: true,
			CreatedAt: "2025-01-01T00:00:00Z",
			UpdatedAt: "2025-01-01T00:00:00Z",
		}
		assert.NoError(t, m.Validate())
	})

	t.Run("Deletion - Valid", func(t *testing.T) {
		d := DeletionRecord{Type: "conversation", ID: "c1", DeletedAt: "2025-01-01T00:00:00Z"}
		assert.NoError(t, d.Validate())
	})

	t.Run("SyncPullResponse - Valid", func(t *testing.T) {
		r := SyncPullResponse{
			Conversations: []ConversationSyncPayload{
				{Timestamp: "t", UserInput: "q", UpdatedAt: "u"},
			},
		}
		assert.NoError(t, r.Validate())
	})

	t.Run("SyncPullResponse - Invalid", func(t *testing.T) {
		r := SyncPullResponse{
			Conversations: []ConversationSyncPayload{
				{Timestamp: "t"}, // Missing fields
			},
		}
		assert.Error(t, r.Validate())
	})
}
