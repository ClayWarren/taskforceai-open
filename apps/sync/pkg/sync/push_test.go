package sync

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

type unknownIdempotencyLookup struct{}

func (unknownIdempotencyLookup) idempotencyLookup() {}

func TestSyncPushIdempotencyKey(t *testing.T) {
	req := SyncPushRequest{
		Messages: []MessageSyncPayload{{MessageID: "msg-1", Content: "hello"}},
	}

	first, err := syncPushIdempotencyKey("user-1", "device-1", "", req)
	require.NoError(t, err)
	second, err := syncPushIdempotencyKey("user-1", "device-1", "", req)
	require.NoError(t, err)
	require.NotEmpty(t, first)
	require.Equal(t, first, second)

	otherDevice, err := syncPushIdempotencyKey("user-1", "device-2", "", req)
	require.NoError(t, err)
	require.NotEqual(t, first, otherDevice)

	explicit, err := syncPushIdempotencyKey("user-1", "device-1", "request-123", req)
	require.NoError(t, err)
	require.Equal(t, "request-123", explicit)

	empty, err := syncPushIdempotencyKey("user-1", "device-1", "", SyncPushRequest{})
	require.NoError(t, err)
	require.Empty(t, empty)
}

func TestSyncPushIdempotencyKeyRejectsUnencodablePayload(t *testing.T) {
	_, err := syncPushIdempotencyKey("user-1", "device-1", "", SyncPushRequest{
		Messages: []MessageSyncPayload{{MessageID: "msg-1", Trace: make(chan struct{})}},
	})
	require.ErrorContains(t, err, "derive sync push idempotency key")
}

func TestPushChangesRejectsUnencodableIdempotencyPayload(t *testing.T) {
	svc := NewService(nil, nil, nil, nil, nil, nil)
	result, err := svc.PushChanges(context.Background(), "user-1", "device-1", "agent", "", SyncPushRequest{
		Messages: []MessageSyncPayload{{MessageID: "msg-1", Trace: make(chan struct{})}},
	})
	require.ErrorContains(t, err, "derive sync push idempotency key")
	require.Nil(t, result)
}

func TestResolveMessageConversationIDs(t *testing.T) {
	localID := " local-conversation "
	messages := []MessageSyncPayload{
		{MessageID: "local-message", ConversationLocalID: &localID},
		{MessageID: "remote-message", ConversationID: 7},
	}

	resolved, err := resolveMessageConversationIDs(messages, map[string]int32{"local-conversation": 42})
	require.NoError(t, err)
	require.Equal(t, int32(42), resolved[0].ConversationID)
	require.Equal(t, int32(7), resolved[1].ConversationID)
	require.Zero(t, messages[0].ConversationID, "input payload must not be mutated")

	_, err = resolveMessageConversationIDs(
		[]MessageSyncPayload{{MessageID: "missing", ConversationLocalID: &localID}},
		map[string]int32{},
	)
	require.ErrorContains(t, err, "unresolved local conversation")

	unchanged, err := resolveMessageConversationIDs(
		[]MessageSyncPayload{{MessageID: "existing-update"}},
		nil,
	)
	require.NoError(t, err)
	require.Zero(t, unchanged[0].ConversationID)
}

func TestApplyPushTransactionRejectsUnresolvedMessageConversation(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()
	localID := "missing-local-conversation"
	mockRepo.On("GetLatestSyncVersion", ctx, "user-1").Return(int32(0), nil).Once()
	mockRepo.On("GetSyncDevices", ctx, "user-1").Return([]db.SyncDevice{}, nil).Once()

	response, _, err := svc.applyPushTransaction(ctx, "user-1", "device-1", "", SyncPushRequest{
		Messages: []MessageSyncPayload{{MessageID: "message-1", ConversationLocalID: &localID}},
	})

	require.Nil(t, response)
	require.ErrorContains(t, err, "unresolved local conversation")
	mockRepo.AssertExpectations(t)
}

func TestMessageSyncPayloadDecodesLocalConversationID(t *testing.T) {
	var payload MessageSyncPayload
	require.NoError(t, json.Unmarshal([]byte(`{
		"message_id":"local-message",
		"conversation_id":0,
		"conversation_local_id":"local-conversation"
	}`), &payload))
	require.NotNil(t, payload.ConversationLocalID)
	require.Equal(t, "local-conversation", *payload.ConversationLocalID)
}

func TestPushChangesResolvesLocalMessageParentFromCreatedConversation(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()
	userID := "user-1"
	localID := "local-conversation"

	mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
	mockRepo.On("GetLatestSyncVersion", ctx, userID).Return(int32(0), nil).Once()
	mockRepo.On("GetSyncDevices", ctx, userID).Return([]db.SyncDevice{}, nil).Once()
	mockRepo.On("CreateConversationSync", ctx, mock.Anything).Return(db.Conversation{ID: 42}, nil).Once()
	mockRepo.On("GetMessageVersion", ctx, "local-message").Return(db.GetMessageVersionRow{}, ErrNotFound).Once()
	mockRepo.On("GetConversationVersion", ctx, int32(42), mock.Anything).Return(db.GetConversationVersionRow{ID: 42}, nil).Once()
	mockRepo.On("GetConversation", ctx, int32(42)).Return(db.Conversation{ID: 42, UserID: &userID}, nil).Once()
	mockRepo.On("CreateMessageSync", ctx, mock.MatchedBy(func(input CreateMessageInput) bool {
		return input.MessageID == "local-message" && input.ConversationID == 42
	})).Return(db.Message{}, nil).Once()
	mockRepo.On("CreateSyncAuditLog", mock.Anything, mock.Anything).Return(db.SyncAuditLog{}, nil).Once()

	result, err := svc.PushChanges(ctx, userID, "device-1", "agent", "", SyncPushRequest{
		Conversations: []ConversationSyncPayload{{LocalID: &localID}},
		Messages: []MessageSyncPayload{{
			MessageID:           "local-message",
			ConversationLocalID: &localID,
			Role:                "user",
			Content:             "hello",
		}},
	})

	require.NoError(t, err)
	require.Equal(t, int32(42), result.ConversationIDMappings[localID])
	require.Contains(t, result.Accepted, "message:local-message")
	mockRepo.AssertExpectations(t)
}

func TestLoadCachedPush_IgnoresUnknownLookupVariants(t *testing.T) {
	store := new(MockIdempotencyStore)
	store.On("GetResult", mock.Anything, "user-1", "scoped-key").Return(unknownIdempotencyLookup{}, nil).Once()
	svc := NewService(nil, nil, nil, nil, store, nil)

	result, cached, err := svc.loadCachedPush(context.Background(), "user-1", "request-key", "scoped-key")

	require.NoError(t, err)
	require.Nil(t, result)
	require.False(t, cached)
	store.AssertExpectations(t)
}
