package sync

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestService_PatchAndConflictRemainingBranches(t *testing.T) {
	ctx := context.Background()

	t.Run("conversation patch apply error through sync", func(t *testing.T) {
		mockRepo := new(MockSyncRepository)
		svc := NewService(mockRepo, nil, nil, nil, nil, NewTelemetry())
		incoming := ConversationSyncPayload{
			ID:          1,
			SyncVersion: 5,
			VectorClock: VectorClock{"device": 1}.Encode(),
			Patches:     []byte(`not-json`),
		}
		mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{
			ID:          1,
			SyncVersion: 5,
			VectorClock: VectorClock{"device": 1}.Encode(),
		}, nil).Once()
		mockRepo.On("GetConversation", ctx, int32(1)).Return(db.Conversation{ID: 1}, nil).Once()
		_, _, _, _, err := svc.syncConversations(ctx, mockRepo, "user-1", "device", nil, 5, StrategyServerWins, []ConversationSyncPayload{incoming})
		require.ErrorContains(t, err, "apply conversation patch")
		mockRepo.AssertExpectations(t)
	})

	t.Run("message patch apply error through sync", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		incoming := MessageSyncPayload{
			MessageID:   "msg-1",
			VectorClock: VectorClock{"device": 1}.Encode(),
			Patches:     []byte(`not-json`),
		}
		mockRepo.On("GetMessageVersion", ctx, "msg-1").Return(db.GetMessageVersionRow{
			MessageID:   "msg-1",
			SyncVersion: 5,
			VectorClock: VectorClock{"device": 1}.Encode(),
		}, nil).Once()
		mockRepo.On("GetMessageByMessageID", ctx, "msg-1").Return(db.Message{MessageID: "msg-1"}, nil).Once()
		_, _, _, err := svc.syncMessages(ctx, mockRepo, "user-1", "device", nil, 5, nil, StrategyServerWins, []MessageSyncPayload{incoming})
		require.ErrorContains(t, err, "apply message patch")
		mockRepo.AssertExpectations(t)
	})

	t.Run("auto merge success records telemetry", func(t *testing.T) {
		mockRepo := new(MockSyncRepository)
		mockResolver := new(MockConflictResolver)
		svc := NewService(mockRepo, nil, mockResolver, nil, nil, NewTelemetry())
		incoming := ConversationSyncPayload{ID: 1, UserInput: "client", VectorClock: VectorClock{"client": 1}.Encode()}
		resolved := incoming
		resolved.UserInput = "resolved"
		mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{
			ID:          1,
			SyncVersion: 5,
			VectorClock: VectorClock{"server": 1}.Encode(),
		}, nil).Once()
		mockRepo.On("GetConversation", ctx, int32(1)).Return(db.Conversation{ID: 1, UserInput: "server"}, nil).Once()
		mockResolver.On("ResolveConversation", mock.Anything, incoming).Return(resolved, nil).Once()
		mockRepo.On("UpdateConversationSync", ctx, mock.Anything).Return(nil).Once()

		_, conflicts, accepted, _, err := svc.syncConversations(ctx, mockRepo, "user-1", "device", map[string]struct{}{"client": {}, "server": {}, "device": {}}, 5, StrategyAutoMerge, []ConversationSyncPayload{incoming})
		require.NoError(t, err)
		assert.Empty(t, conflicts)
		assert.Equal(t, []string{"conversation:1"}, accepted)
		mockRepo.AssertExpectations(t)
		mockResolver.AssertExpectations(t)
	})

	t.Run("auto merge message success records telemetry", func(t *testing.T) {
		mockRepo := new(MockSyncRepository)
		mockResolver := new(MockConflictResolver)
		svc := NewService(mockRepo, nil, mockResolver, nil, nil, NewTelemetry())
		incoming := MessageSyncPayload{MessageID: "msg-1", Content: "client", VectorClock: VectorClock{"client": 1}.Encode()}
		resolved := incoming
		resolved.Content = "resolved"
		mockRepo.On("GetMessageVersion", ctx, "msg-1").Return(db.GetMessageVersionRow{
			MessageID:   "msg-1",
			SyncVersion: 5,
			VectorClock: VectorClock{"server": 1}.Encode(),
		}, nil).Once()
		mockRepo.On("GetMessageByMessageID", ctx, "msg-1").Return(db.Message{MessageID: "msg-1", Content: "server"}, nil).Once()
		mockResolver.On("ResolveMessage", mock.Anything, incoming).Return(resolved, nil).Once()
		mockRepo.On("UpdateMessageSync", ctx, mock.Anything).Return(nil).Once()

		_, conflicts, accepted, err := svc.syncMessages(ctx, mockRepo, "user-1", "device", map[string]struct{}{"client": {}, "server": {}, "device": {}}, 5, nil, StrategyAutoMerge, []MessageSyncPayload{incoming})
		require.NoError(t, err)
		assert.Empty(t, conflicts)
		assert.Equal(t, []string{"message:msg-1"}, accepted)
		mockRepo.AssertExpectations(t)
		mockResolver.AssertExpectations(t)
	})

	t.Run("conversation patch is merged instead of overwriting server edit", func(t *testing.T) {
		mockRepo := new(MockSyncRepository)
		svc := NewService(mockRepo, nil, NewAutoMergeResolver(), nil, nil, nil)
		incoming := ConversationSyncPayload{
			ID:          1,
			SyncVersion: 5,
			VectorClock: VectorClock{"client": 1}.Encode(),
			Patches:     []byte(`[{"op":"replace","path":"/user_input","value":"client edit"}]`),
		}
		mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{
			ID:          1,
			SyncVersion: 5,
			VectorClock: VectorClock{"server": 1}.Encode(),
		}, nil).Once()
		mockRepo.On("GetConversation", ctx, int32(1)).Return(db.Conversation{
			ID:        1,
			UserInput: "server edit",
		}, nil).Once()
		mockRepo.On("UpdateConversationSync", ctx, mock.MatchedBy(func(params UpdateConversationInput) bool {
			return strings.Contains(params.UserInput, "server edit") &&
				strings.Contains(params.UserInput, "client edit") &&
				params.UserInput != "client edit"
		})).Return(nil).Once()

		version, conflicts, accepted, _, err := svc.syncConversations(ctx, mockRepo, "user-1", "device", nil, 5, StrategyAutoMerge, []ConversationSyncPayload{incoming})

		require.NoError(t, err)
		assert.Equal(t, int32(6), version)
		assert.Empty(t, conflicts)
		assert.Equal(t, []string{"conversation:1"}, accepted)
		mockRepo.AssertExpectations(t)
	})

	t.Run("message patch is merged instead of overwriting server edit", func(t *testing.T) {
		mockRepo := new(MockSyncRepository)
		svc := NewService(mockRepo, nil, NewAutoMergeResolver(), nil, nil, nil)
		incoming := MessageSyncPayload{
			MessageID:   "msg-1",
			SyncVersion: 5,
			VectorClock: VectorClock{"client": 1}.Encode(),
			Patches:     []byte(`[{"op":"replace","path":"/content","value":"client edit"}]`),
		}
		mockRepo.On("GetMessageVersion", ctx, "msg-1").Return(db.GetMessageVersionRow{
			MessageID:   "msg-1",
			SyncVersion: 5,
			VectorClock: VectorClock{"server": 1}.Encode(),
		}, nil).Once()
		mockRepo.On("GetMessageByMessageID", ctx, "msg-1").Return(db.Message{
			MessageID: "msg-1",
			Content:   "server edit",
		}, nil).Once()
		mockRepo.On("UpdateMessageSync", ctx, mock.MatchedBy(func(params UpdateMessageInput) bool {
			return strings.Contains(params.Content, "server edit") &&
				strings.Contains(params.Content, "client edit") &&
				params.Content != "client edit"
		})).Return(nil).Once()

		version, conflicts, accepted, err := svc.syncMessages(ctx, mockRepo, "user-1", "device", nil, 5, nil, StrategyAutoMerge, []MessageSyncPayload{incoming})

		require.NoError(t, err)
		assert.Equal(t, int32(6), version)
		assert.Empty(t, conflicts)
		assert.Equal(t, []string{"message:msg-1"}, accepted)
		mockRepo.AssertExpectations(t)
	})
}

func TestService_ApplyDeletions_RemainingBranches(t *testing.T) {
	ctx := context.Background()
	userID := "user-1"

	t.Run("conversation version error", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{}, errors.New("version failed")).Once()
		_, _, err := svc.applyDeletions(ctx, mockRepo, userID, "device-1", nil, 5, []DeletionRecord{{Type: "conversation", ID: "1"}})
		require.ErrorContains(t, err, "get conversation version for deletion")
		mockRepo.AssertExpectations(t)
	})

	t.Run("conversation load no rows skips", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{ID: 1, SyncVersion: 5}, nil).Once()
		mockRepo.On("GetConversation", ctx, int32(1)).Return(db.Conversation{}, pgx.ErrNoRows).Once()
		version, accepted, err := svc.applyDeletions(ctx, mockRepo, userID, "device-1", nil, 5, []DeletionRecord{{Type: "conversation", ID: "1"}})
		require.NoError(t, err)
		assert.Equal(t, int32(5), version)
		assert.Equal(t, []string{"deletion:1"}, accepted)
		mockRepo.AssertExpectations(t)
	})

	t.Run("conversation load error", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{ID: 1, SyncVersion: 5}, nil).Once()
		mockRepo.On("GetConversation", ctx, int32(1)).Return(db.Conversation{}, errors.New("load failed")).Once()
		_, _, err := svc.applyDeletions(ctx, mockRepo, userID, "device-1", nil, 5, []DeletionRecord{{Type: "conversation", ID: "1"}})
		require.ErrorContains(t, err, "get conversation for deletion")
		mockRepo.AssertExpectations(t)
	})

	t.Run("conversation update error", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{
			ID:          1,
			SyncVersion: 5,
			VectorClock: VectorClock{"device-1": 1}.Encode(),
		}, nil).Once()
		mockRepo.On("GetConversation", ctx, int32(1)).Return(db.Conversation{ID: 1}, nil).Once()
		mockRepo.On("UpdateConversationSync", ctx, mock.Anything).Return(errors.New("update failed")).Once()
		_, _, err := svc.applyDeletions(ctx, mockRepo, userID, "device-1", nil, 5, []DeletionRecord{{Type: "conversation", ID: "1"}})
		require.ErrorContains(t, err, "update deleted conversation")
		mockRepo.AssertExpectations(t)
	})

	t.Run("conversation verify error and no-op", func(t *testing.T) {
		for _, verifyErr := range []error{errors.New("verify failed"), nil} {
			svc, mockRepo, _ := newSyncTest()
			mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{
				ID:          1,
				SyncVersion: 5,
				VectorClock: VectorClock{"device-1": 1}.Encode(),
			}, nil).Once()
			mockRepo.On("GetConversation", ctx, int32(1)).Return(db.Conversation{ID: 1}, nil).Once()
			mockRepo.On("UpdateConversationSync", ctx, mock.Anything).Return(nil).Once()
			if verifyErr != nil {
				mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{}, verifyErr).Once()
				_, _, err := svc.applyDeletions(ctx, mockRepo, userID, "device-1", nil, 5, []DeletionRecord{{Type: "conversation", ID: "1"}})
				require.ErrorContains(t, err, "verify deleted conversation update")
			} else {
				mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{ID: 1, SyncVersion: 5}, nil).Once()
				_, _, err := svc.applyDeletions(ctx, mockRepo, userID, "device-1", nil, 5, []DeletionRecord{{Type: "conversation", ID: "1"}})
				require.ErrorContains(t, err, "no-op for conversation")
			}
			mockRepo.AssertExpectations(t)
		}
	})

	t.Run("message version and load errors", func(t *testing.T) {
		for _, tc := range []struct {
			name string
			err  error
		}{
			{name: "version", err: errors.New("version failed")},
			{name: "load", err: errors.New("load failed")},
		} {
			svc, mockRepo, _ := newSyncTest()
			if tc.name == "version" {
				mockRepo.On("GetMessageVersion", ctx, "msg-1").Return(db.GetMessageVersionRow{}, tc.err).Once()
				_, _, err := svc.applyDeletions(ctx, mockRepo, userID, "device-1", nil, 5, []DeletionRecord{{Type: "message", ID: "msg-1"}})
				require.ErrorContains(t, err, "get message version for deletion")
			} else {
				mockRepo.On("GetMessageVersion", ctx, "msg-1").Return(db.GetMessageVersionRow{MessageID: "msg-1", SyncVersion: 5}, nil).Once()
				mockRepo.On("GetMessageByMessageID", ctx, "msg-1").Return(db.Message{}, tc.err).Once()
				_, _, err := svc.applyDeletions(ctx, mockRepo, userID, "device-1", nil, 5, []DeletionRecord{{Type: "message", ID: "msg-1"}})
				require.ErrorContains(t, err, "get message for deletion")
			}
			mockRepo.AssertExpectations(t)
		}
	})

	t.Run("message load no rows skips", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		mockRepo.On("GetMessageVersion", ctx, "msg-1").Return(db.GetMessageVersionRow{MessageID: "msg-1", SyncVersion: 5}, nil).Once()
		mockRepo.On("GetMessageByMessageID", ctx, "msg-1").Return(db.Message{}, pgx.ErrNoRows).Once()
		version, accepted, err := svc.applyDeletions(ctx, mockRepo, userID, "device-1", nil, 5, []DeletionRecord{{Type: "message", ID: "msg-1"}})
		require.NoError(t, err)
		assert.Equal(t, int32(5), version)
		assert.Equal(t, []string{"deletion:msg-1"}, accepted)
		mockRepo.AssertExpectations(t)
	})

	t.Run("message update and verify errors", func(t *testing.T) {
		for _, tc := range []struct {
			name      string
			updateErr error
			verifyErr error
		}{
			{name: "update", updateErr: errors.New("update failed")},
			{name: "verify", verifyErr: errors.New("verify failed")},
		} {
			svc, mockRepo, _ := newSyncTest()
			mockRepo.On("GetMessageVersion", ctx, "msg-1").Return(db.GetMessageVersionRow{
				MessageID:   "msg-1",
				SyncVersion: 5,
				VectorClock: VectorClock{"device-1": 1}.Encode(),
			}, nil).Once()
			mockRepo.On("GetMessageByMessageID", ctx, "msg-1").Return(db.Message{MessageID: "msg-1"}, nil).Once()
			mockRepo.On("UpdateMessageSync", ctx, mock.Anything).Return(tc.updateErr).Once()
			if tc.updateErr == nil {
				mockRepo.On("GetMessageVersion", ctx, "msg-1").Return(db.GetMessageVersionRow{}, tc.verifyErr).Once()
			}
			_, _, err := svc.applyDeletions(ctx, mockRepo, userID, "device-1", nil, 5, []DeletionRecord{{Type: "message", ID: "msg-1"}})
			require.Error(t, err)
			mockRepo.AssertExpectations(t)
		}
	})
}

func timestampForTest(t time.Time) Timestamp {
	return Timestamp{Time: t, Valid: true}
}
