package sync

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestService_getCounts_WithOrg(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()
	orgID := int32(10)

	mockRepo.On("CountConversationsByOrg", mock.Anything, orgID).Return(int64(1), nil).Once()
	mockRepo.On("CountMessagesByOrg", mock.Anything, orgID).Return(int64(4), nil).Once()

	convCount, msgCount, err := svc.getCounts(ctx, "user", &orgID)
	require.NoError(t, err)
	assert.Equal(t, int64(1), convCount)
	assert.Equal(t, int64(4), msgCount)
}

func TestService_handleConversationPatchWithConversation(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	patch := []byte(`[{"op":"replace","path":"/user_input","value":"updated"}]`)
	incoming := ConversationSyncPayload{ID: 1, Patches: patch}
	full := db.Conversation{ID: 1, UserInput: "old", LastSyncedAt: pgtype.Timestamp{Time: time.Now(), Valid: true}, Timestamp: pgtype.Timestamp{Time: time.Now(), Valid: true}, UpdatedAt: pgtype.Timestamp{Time: time.Now(), Valid: true}}

	mockRepo.On("GetConversation", ctx, int32(1)).Return(full, nil).Once()

	updated, err := svc.handleConversationPatchWithConversation(ctx, mockRepo, incoming, nil)
	require.NoError(t, err)
	assert.Equal(t, "updated", updated.UserInput)
}

func TestService_handleConversationPatch_Error(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	// 1. GetConversation error
	mockRepo.On("GetConversation", ctx, int32(1)).Return(db.Conversation{}, errors.New("fail")).Once()
	_, err := svc.handleConversationPatchWithConversation(ctx, mockRepo, ConversationSyncPayload{ID: 1, Patches: []byte("{}")}, nil)
	require.Error(t, err)

	// 2. Invalid patch
	mockRepo.On("GetConversation", ctx, int32(2)).Return(db.Conversation{ID: 2}, nil).Once()
	_, err = svc.handleConversationPatchWithConversation(ctx, mockRepo, ConversationSyncPayload{ID: 2, Patches: []byte("invalid-json")}, nil)
	assert.Error(t, err)
}

func TestService_handleConversationPatch_UnmarshalError(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	patch := []byte(`[{"op":"replace","path":"/timestamp","value":{"bad":true}}]`)
	mockRepo.On("GetConversation", ctx, int32(1)).Return(db.Conversation{ID: 1}, nil).Once()

	_, err := svc.handleConversationPatchWithConversation(ctx, mockRepo, ConversationSyncPayload{ID: 1, Patches: patch}, nil)

	require.ErrorContains(t, err, "unmarshal patched conversation")
	mockRepo.AssertExpectations(t)
}

func TestService_handleConversationPatch_PreservesIdentityAndScope(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	orgID := int32(7)
	owner := "owner@example.com"
	patch := []byte(`[{"op":"replace","path":"/id","value":42},{"op":"replace","path":"/organization_id","value":99},{"op":"replace","path":"/user_input","value":"updated"}]`)
	incoming := ConversationSyncPayload{ID: 1, OrganizationID: &orgID, Patches: patch}
	full := db.Conversation{
		ID:             1,
		OrganizationID: &orgID,
		UserID:         &owner,
		UserInput:      "old",
		LastSyncedAt:   pgtype.Timestamp{Time: time.Now(), Valid: true},
		Timestamp:      pgtype.Timestamp{Time: time.Now(), Valid: true},
		UpdatedAt:      pgtype.Timestamp{Time: time.Now(), Valid: true},
	}

	mockRepo.On("GetConversationWithOrg", ctx, int32(1), orgID).Return(full, nil).Once()

	updated, err := svc.handleConversationPatchWithConversation(ctx, mockRepo, incoming, nil)
	require.NoError(t, err)
	assert.Equal(t, int32(1), updated.ID)
	require.NotNil(t, updated.OrganizationID)
	assert.Equal(t, orgID, *updated.OrganizationID)
	assert.Equal(t, "updated", updated.UserInput)
}

func TestService_handleMessagePatch_Error(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	// 1. GetMessageByMessageID error
	mockRepo.On("GetMessageByMessageID", ctx, "msg-1").Return(db.Message{}, errors.New("fail")).Once()
	_, err := svc.handleMessagePatchWithMessage(ctx, mockRepo, MessageSyncPayload{MessageID: "msg-1", Patches: []byte("{}")}, "user", nil, nil)
	require.Error(t, err)

	// 2. Invalid patch
	mockRepo.On("GetMessageByMessageID", ctx, "msg-2").Return(db.Message{MessageID: "msg-2"}, nil).Once()
	_, err = svc.handleMessagePatchWithMessage(ctx, mockRepo, MessageSyncPayload{MessageID: "msg-2", Patches: []byte("invalid-json")}, "user", nil, nil)
	assert.Error(t, err)
}

func TestService_handleMessagePatch_UnmarshalError(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	patch := []byte(`[{"op":"replace","path":"/created_at","value":{"bad":true}}]`)
	mockRepo.On("GetMessageByMessageID", ctx, "msg-1").Return(db.Message{
		MessageID: "msg-1",
	}, nil).Once()

	_, err := svc.handleMessagePatchWithMessage(ctx, mockRepo, MessageSyncPayload{MessageID: "msg-1", Patches: patch}, "user", nil, nil)

	require.ErrorContains(t, err, "unmarshal patched message")
	mockRepo.AssertExpectations(t)
}

func TestService_handleMessagePatch_PreservesIdentityFields(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	patch := []byte(`[{"op":"replace","path":"/message_id","value":"msg-2"},{"op":"replace","path":"/conversation_id","value":999},{"op":"replace","path":"/content","value":"updated"}]`)
	mockRepo.On("GetMessageByMessageID", ctx, "msg-1").Return(db.Message{
		MessageID:      "msg-1",
		ConversationID: 7,
		Content:        "old",
	}, nil).Once()

	updated, err := svc.handleMessagePatchWithMessage(ctx, mockRepo, MessageSyncPayload{MessageID: "msg-1", Patches: patch}, "user", nil, nil)
	require.NoError(t, err)
	assert.Equal(t, "msg-1", updated.MessageID)
	assert.Equal(t, int32(7), updated.ConversationID)
	assert.Equal(t, "updated", updated.Content)
}

func TestService_handleMessageUpdate_NoPatch(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	incoming := MessageSyncPayload{
		MessageID: "msg-1",
		Content:   "old",
		CreatedAt: time.Now(),
	}
	mockRepo.On("UpdateMessageSync", ctx, mock.Anything).Return(nil).Once()

	err := svc.handleMessageUpdateWithMessage(ctx, mockRepo, "user-1", "device", 2, nil, incoming)
	assert.NoError(t, err)
}

func TestService_handleMessageUpdate_WithPatch(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	patch := []byte(`[{"op":"replace","path":"/content","value":"updated"}]`)
	incoming := MessageSyncPayload{
		MessageID: "msg-1",
		Content:   "old",
		Patches:   patch,
		CreatedAt: time.Now(),
	}
	mockRepo.On("GetMessageByMessageID", ctx, "msg-1").Return(db.Message{
		MessageID: "msg-1",
		Content:   "old",
	}, nil).Once()
	mockRepo.On("UpdateMessageSync", ctx, mock.MatchedBy(func(params UpdateMessageInput) bool {
		return params.Content == "updated"
	})).Return(nil).Once()

	err := svc.handleMessageUpdateWithMessage(ctx, mockRepo, "user-1", "device", 2, nil, incoming)
	assert.NoError(t, err)
}

func TestService_handleMessageUpdate_PatchError(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	incoming := MessageSyncPayload{
		MessageID: "msg-1",
		Content:   "old",
		Patches:   []byte(`[{"op":"replace","path":"/content","value":"updated"}]`),
		CreatedAt: time.Now(),
	}
	// The patch handler loads the server message; a load failure must propagate
	// out of handleMessageUpdateWithMessage.
	mockRepo.On("GetMessageByMessageID", ctx, "msg-1").
		Return(db.Message{}, errors.New("load failed")).Once()

	err := svc.handleMessageUpdateWithMessage(ctx, mockRepo, "user-1", "device", 2, nil, incoming)
	require.Error(t, err)
	assert.ErrorContains(t, err, "load failed")
}

func TestService_handleNewMessage_FailsClosedOnCrossOrgProbeError(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	orgID := int32(3)
	mockRepo.On("GetMessageVersion", ctx, "msg-1").Return(db.GetMessageVersionRow{}, errors.New("db timeout")).Once()

	_, err := svc.handleNewMessage(
		ctx,
		mockRepo,
		"user-1",
		"device-1",
		1,
		&orgID,
		MessageSyncPayload{
			MessageID:      "msg-1",
			ConversationID: 11,
			Role:           "user",
			Content:        "hello",
			CreatedAt:      time.Now(),
		},
		&[]string{},
	)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "verify org message uniqueness")
}

func TestService_pruneVectorClock(t *testing.T) {
	svc := NewService(nil, nil, nil, nil, nil, nil)
	vc := VectorClock{"a": 1, "b": 2}
	active := map[string]struct{}{"a": {}}
	svc.pruneVectorClock(vc, active)
	_, ok := vc["b"]
	assert.False(t, ok)
}

func TestService_pruneVectorClock_NilActiveDevicesIsNoOp(t *testing.T) {
	svc := NewService(nil, nil, nil, nil, nil, nil)
	vc := VectorClock{"a": 1, "b": 2}
	svc.pruneVectorClock(vc, nil)
	assert.Len(t, vc, 2)
}

func TestService_resolveConversationConflict_AutoMerge(t *testing.T) {
	mockRepo := new(MockSyncRepository)
	mockResolver := new(MockConflictResolver)
	svc := NewService(mockRepo, nil, mockResolver, nil, nil, nil)
	ctx := context.Background()

	incoming := ConversationSyncPayload{ID: 1}
	full := db.Conversation{ID: 1, UserInput: "server"}

	mockRepo.On("GetConversation", ctx, int32(1)).Return(full, nil).Once()
	mockResolver.On("ResolveConversation", mock.Anything, incoming).Return(incoming, nil).Once()

	resolved, ok, err := svc.resolveConversationConflictWithConversation(ctx, mockRepo, incoming, StrategyAutoMerge, nil)
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, int32(1), resolved.ID)
}

func TestService_resolveConversationConflict_LoadError(t *testing.T) {
	mockRepo := new(MockSyncRepository)
	mockResolver := new(MockConflictResolver)
	svc := NewService(mockRepo, nil, mockResolver, nil, nil, nil)
	ctx := context.Background()

	incoming := ConversationSyncPayload{ID: 1}
	mockRepo.On("GetConversation", ctx, int32(1)).Return(db.Conversation{}, errors.New("load failed")).Once()

	_, ok, err := svc.resolveConversationConflictWithConversation(ctx, mockRepo, incoming, StrategyAutoMerge, nil)

	require.ErrorContains(t, err, "get conversation")
	assert.False(t, ok)
	mockRepo.AssertExpectations(t)
}

func TestService_resolveMessageConflict_AutoMerge(t *testing.T) {
	mockRepo := new(MockSyncRepository)
	mockResolver := new(MockConflictResolver)
	svc := NewService(mockRepo, nil, mockResolver, nil, nil, nil)
	ctx := context.Background()

	incoming := MessageSyncPayload{MessageID: "msg-1"}
	full := db.Message{MessageID: "msg-1", Content: "server"}

	mockRepo.On("GetMessageByMessageID", ctx, "msg-1").Return(full, nil).Once()
	mockResolver.On("ResolveMessage", mock.Anything, incoming).Return(incoming, nil).Once()

	resolved, ok, err := svc.resolveMessageConflictWithMessage(ctx, mockRepo, incoming, "user-1", nil, StrategyAutoMerge, nil)
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, "msg-1", resolved.MessageID)
}

func TestService_resolveMessageConflict_LoadError(t *testing.T) {
	mockRepo := new(MockSyncRepository)
	mockResolver := new(MockConflictResolver)
	svc := NewService(mockRepo, nil, mockResolver, nil, nil, nil)
	ctx := context.Background()

	incoming := MessageSyncPayload{MessageID: "msg-1"}
	mockRepo.On("GetMessageByMessageID", ctx, "msg-1").Return(db.Message{}, errors.New("load failed")).Once()

	_, ok, err := svc.resolveMessageConflictWithMessage(ctx, mockRepo, incoming, "user-1", nil, StrategyAutoMerge, nil)

	require.ErrorContains(t, err, "get message")
	assert.False(t, ok)
	mockRepo.AssertExpectations(t)
}

func TestService_syncConversations_ConcurrentClientWins_AppliesIncoming(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	serverVC := VectorClock{"server": 1}.Encode()
	clientVC := VectorClock{"client": 1}.Encode()
	incoming := ConversationSyncPayload{
		ID:          1,
		UserInput:   "hi",
		AgentCount:  1,
		VectorClock: clientVC,
	}

	mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{
		ID:          1,
		SyncVersion: 2,
		VectorClock: serverVC,
	}, nil).Once()
	mockRepo.On("UpdateConversationSync", ctx, mock.Anything).Return(nil).Once()

	version, conflicts, _, _, err := svc.syncConversations(
		ctx,
		mockRepo,
		"user",
		"device",
		map[string]struct{}{"server": {}, "client": {}, "device": {}},
		2,
		StrategyClientWins,
		[]ConversationSyncPayload{incoming},
	)
	require.NoError(t, err)
	assert.Equal(t, int32(3), version)
	assert.Empty(t, conflicts)
}

func TestService_syncConversations_ConcurrentServerWins_DropsIncomingWithoutConflict(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	serverVC := VectorClock{"server": 1}.Encode()
	clientVC := VectorClock{"client": 1}.Encode()
	incoming := ConversationSyncPayload{
		ID:          1,
		UserInput:   "hi",
		AgentCount:  1,
		VectorClock: clientVC,
	}

	mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{
		ID:          1,
		SyncVersion: 2,
		VectorClock: serverVC,
	}, nil).Once()

	version, conflicts, _, _, err := svc.syncConversations(
		ctx,
		mockRepo,
		"user",
		"device",
		map[string]struct{}{},
		2,
		StrategyServerWins,
		[]ConversationSyncPayload{incoming},
	)
	require.NoError(t, err)
	assert.Equal(t, int32(2), version)
	assert.Empty(t, conflicts)
}

func TestService_syncConversations_Create(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	incoming := ConversationSyncPayload{
		ID:         0,
		UserInput:  "hello",
		AgentCount: 1,
		Timestamp:  time.Now(),
	}

	mockRepo.On("CreateConversationSync", ctx, mock.Anything).Return(db.Conversation{}, nil).Once()

	version, conflicts, _, _, err := svc.syncConversations(
		ctx,
		mockRepo,
		"user",
		"device",
		map[string]struct{}{},
		0,
		StrategyServerWins,
		[]ConversationSyncPayload{incoming},
	)
	require.NoError(t, err)
	assert.Equal(t, int32(1), version)
	assert.Empty(t, conflicts)
	mockRepo.AssertExpectations(t)
}

func TestService_syncConversations_GetVersionError(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	incoming := ConversationSyncPayload{ID: 1}
	mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{}, errors.New("fail")).Once()

	_, _, _, _, err := svc.syncConversations(ctx, mockRepo, "user", "device", nil, 0, StrategyServerWins, []ConversationSyncPayload{incoming})
	assert.Error(t, err)
}

func TestService_syncConversations_OrgScopedUpdate_AllowsMemberWrite(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	orgID := int32(12)
	serverVC := VectorClock{"device-1": 1}.Encode()
	incoming := ConversationSyncPayload{
		ID:             1,
		OrganizationID: &orgID,
		UserInput:      "updated",
		AgentCount:     1,
		VectorClock:    serverVC,
	}

	mockRepo.On("GetConversationVersionWithOrg", ctx, int32(1), (*string)(nil), orgID).Return(db.GetConversationVersionRow{
		ID:          1,
		SyncVersion: 5,
		VectorClock: serverVC,
	}, nil).Once()
	mockRepo.On("UpdateConversationSync", ctx, mock.MatchedBy(func(params UpdateConversationInput) bool {
		return params.ID == 1 &&
			params.OrganizationID != nil && *params.OrganizationID == orgID &&
			params.ScopeOrganizationID != nil && *params.ScopeOrganizationID == orgID
	})).Return(nil).Once()

	version, conflicts, _, _, err := svc.syncConversations(
		ctx,
		mockRepo,
		"member@example.com",
		"device-1",
		map[string]struct{}{"device-1": {}},
		5,
		StrategyClientWins,
		[]ConversationSyncPayload{incoming},
	)
	require.NoError(t, err)
	assert.Equal(t, int32(6), version)
	assert.Empty(t, conflicts)
}

func TestService_syncConversations_RejectDivergedPatch_DoesNotAdvanceVersion(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	incoming := ConversationSyncPayload{
		ID:          1,
		UserInput:   "hi",
		AgentCount:  1,
		SyncVersion: 10,
		VectorClock: VectorClock{"device": 1}.Encode(),
		Patches:     []byte(`[{"op":"replace","path":"/user_input","value":"updated"}]`),
	}

	mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{
		ID:          1,
		SyncVersion: 100,
		VectorClock: VectorClock{"device": 1}.Encode(),
	}, nil).Once()
	mockRepo.On("GetConversation", ctx, int32(1)).Return(db.Conversation{
		ID: 1,
	}, nil).Once()

	version, conflicts, accepted, _, err := svc.syncConversations(
		ctx,
		mockRepo,
		"user",
		"device",
		map[string]struct{}{"device": {}},
		100,
		StrategyClientWins,
		[]ConversationSyncPayload{incoming},
	)
	require.NoError(t, err)
	assert.Equal(t, int32(100), version)
	assert.Len(t, conflicts, 1)
	assert.Equal(t, "patch_base_diverged", conflicts[0].Reason)
	assert.Empty(t, accepted)
	mockRepo.AssertNotCalled(t, "UpdateConversationSync", mock.Anything, mock.Anything)
}

func TestService_syncConversations_SequentialUpdate(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	serverVC := VectorClock{"device": 1}.Encode()
	incoming := ConversationSyncPayload{
		ID:          1,
		UserInput:   "hi",
		AgentCount:  1,
		VectorClock: serverVC,
	}

	mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{
		ID:          1,
		SyncVersion: 2,
		VectorClock: serverVC,
	}, nil).Once()
	mockRepo.On("UpdateConversationSync", ctx, mock.Anything).Return(nil).Once()

	version, conflicts, _, _, err := svc.syncConversations(
		ctx,
		mockRepo,
		"user",
		"device",
		map[string]struct{}{},
		2,
		StrategyServerWins,
		[]ConversationSyncPayload{incoming},
	)
	require.NoError(t, err)
	assert.Equal(t, int32(3), version)
	assert.Empty(t, conflicts)
}

func TestService_syncConversations_WithPatch(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	serverVC := VectorClock{"device": 1}.Encode()
	patch := []byte(`[{"op":"replace","path":"/user_input","value":"updated"}]`)
	incoming := ConversationSyncPayload{
		ID:           1,
		UserInput:    "old",
		AgentCount:   1,
		VectorClock:  serverVC,
		Patches:      patch,
		Timestamp:    time.Now(),
		UpdatedAt:    time.Now(),
		LastSyncedAt: time.Now(),
	}
	full := db.Conversation{
		ID:           1,
		UserInput:    "old",
		Timestamp:    pgtype.Timestamp{Time: time.Now(), Valid: true},
		UpdatedAt:    pgtype.Timestamp{Time: time.Now(), Valid: true},
		LastSyncedAt: pgtype.Timestamp{Time: time.Now(), Valid: true},
	}

	mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{
		ID:          1,
		SyncVersion: 2,
		VectorClock: serverVC,
	}, nil).Once()
	mockRepo.On("GetConversation", ctx, int32(1)).Return(full, nil).Once()
	mockRepo.On("UpdateConversationSync", ctx, mock.Anything).Return(nil).Once()

	version, conflicts, _, _, err := svc.syncConversations(
		ctx,
		mockRepo,
		"user",
		"device",
		map[string]struct{}{"device": {}},
		2,
		StrategyServerWins,
		[]ConversationSyncPayload{incoming},
	)
	require.NoError(t, err)
	assert.Equal(t, int32(3), version)
	assert.Empty(t, conflicts)
}

func TestService_syncMessages_ConcurrentResolved(t *testing.T) {
	mockRepo := new(MockSyncRepository)
	mockResolver := new(MockConflictResolver)
	svc := NewService(mockRepo, nil, mockResolver, nil, nil, nil)
	ctx := context.Background()

	serverVC := VectorClock{"server": 1}.Encode()
	clientVC := VectorClock{"client": 1}.Encode()
	incoming := MessageSyncPayload{
		MessageID:   "msg-1",
		Content:     "client",
		VectorClock: clientVC,
		CreatedAt:   time.Now(),
	}
	full := db.Message{MessageID: "msg-1", Content: "server"}

	mockRepo.On("GetMessageVersion", ctx, "msg-1").Return(db.GetMessageVersionRow{
		MessageID:   "msg-1",
		SyncVersion: 2,
		VectorClock: serverVC,
	}, nil).Once()
	mockRepo.On("GetMessageByMessageID", ctx, "msg-1").Return(full, nil).Once()
	mockResolver.On("ResolveMessage", mock.Anything, incoming).Return(incoming, nil).Once()
	mockRepo.On("UpdateMessageSync", ctx, mock.Anything).Return(nil).Once()

	version, conflicts, _, err := svc.syncMessages(
		ctx,
		mockRepo,
		"user-1",
		"device",
		map[string]struct{}{"server": {}, "client": {}},
		2,
		nil,
		StrategyAutoMerge,
		[]MessageSyncPayload{incoming},
	)
	require.NoError(t, err)
	assert.Equal(t, int32(3), version)
	assert.Empty(t, conflicts)
}

func TestService_syncMessages_ConcurrentServerWins_DropsIncomingWithoutConflict(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	serverVC := VectorClock{"server": 1}.Encode()
	clientVC := VectorClock{"client": 1}.Encode()
	incoming := MessageSyncPayload{
		MessageID:   "msg-1",
		VectorClock: clientVC,
		CreatedAt:   time.Now(),
	}

	mockRepo.On("GetMessageVersion", ctx, "msg-1").Return(db.GetMessageVersionRow{
		MessageID:   "msg-1",
		SyncVersion: 2,
		VectorClock: serverVC,
	}, nil).Once()

	version, conflicts, accepted, err := svc.syncMessages(
		ctx,
		mockRepo,
		"user-1",
		"device",
		map[string]struct{}{"server": {}, "client": {}, "device": {}},
		2,
		nil,
		StrategyServerWins,
		[]MessageSyncPayload{incoming},
	)
	require.NoError(t, err)
	assert.Equal(t, int32(2), version)
	assert.Empty(t, conflicts)
	assert.Equal(t, []string{"message:msg-1"}, accepted)
}

func TestService_syncMessages_Create(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	incoming := MessageSyncPayload{
		MessageID:      "msg-1",
		ConversationID: 1,
		Role:           "user",
		Content:        "hi",
		CreatedAt:      time.Now(),
	}

	mockRepo.On("GetMessageVersion", ctx, "msg-1").Return(db.GetMessageVersionRow{}, pgx.ErrNoRows).Once()
	mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{
		ID:          1,
		SyncVersion: 0,
		VectorClock: VectorClock{"device": 1}.Encode(),
	}, nil).Once()
	mockRepo.On("GetConversation", ctx, int32(1)).Return(db.Conversation{ID: 1}, nil).Once()
	mockRepo.On("CreateMessageSync", ctx, mock.Anything).Return(db.Message{}, nil).Once()

	version, conflicts, _, err := svc.syncMessages(
		ctx,
		mockRepo,
		"user-1",
		"device",
		map[string]struct{}{},
		0,
		nil,
		StrategyServerWins,
		[]MessageSyncPayload{incoming},
	)
	require.NoError(t, err)
	assert.Equal(t, int32(1), version)
	assert.Empty(t, conflicts)
	mockRepo.AssertExpectations(t)
}

func TestService_syncMessages_Stale(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	serverVC := VectorClock{"device": 2}.Encode()
	clientVC := VectorClock{"device": 1}.Encode()
	incoming := MessageSyncPayload{
		MessageID:   "msg-1",
		VectorClock: clientVC,
		CreatedAt:   time.Now(),
	}

	mockRepo.On("GetMessageVersion", ctx, "msg-1").Return(db.GetMessageVersionRow{
		MessageID:   "msg-1",
		SyncVersion: 2,
		VectorClock: serverVC,
	}, nil).Once()

	version, conflicts, accepted, err := svc.syncMessages(
		ctx,
		mockRepo,
		"user-1",
		"device",
		map[string]struct{}{},
		2,
		nil,
		StrategyServerWins,
		[]MessageSyncPayload{incoming},
	)
	require.NoError(t, err)
	assert.Equal(t, int32(2), version)
	assert.Empty(t, conflicts)
	assert.Equal(t, []string{"message:msg-1"}, accepted)
}

func TestService_updateMessage_MarshalError(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	incoming := MessageSyncPayload{
		MessageID: "msg-1",
		Sources:   func() {},
	}

	err := svc.updateMessage(ctx, mockRepo, "user-1", "device", 1, nil, incoming)
	assert.Error(t, err)
}

func TestService_validateParentConversation(t *testing.T) {
	ctx := context.Background()

	t.Run("organization conversation rejected for personal scope", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		orgID := int32(3)
		mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{ID: 1}, nil).Once()
		mockRepo.On("GetConversation", ctx, int32(1)).Return(db.Conversation{ID: 1, OrganizationID: &orgID}, nil).Once()
		require.ErrorContains(t, svc.validateParentConversation(ctx, mockRepo, 1, "user-1"), "personal-scope")
		mockRepo.AssertExpectations(t)
	})

	t.Run("deleted", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{ID: 1}, nil).Once()
		mockRepo.On("GetConversation", ctx, int32(1)).Return(db.Conversation{ID: 1, IsDeleted: true}, nil).Once()
		require.ErrorContains(t, svc.validateParentConversation(ctx, mockRepo, 1, "user-1"), "parent conversation 1 is deleted")
		mockRepo.AssertExpectations(t)
	})
}

func TestService_validateParentConversationWithOrg(t *testing.T) {
	ctx := context.Background()
	orgID := int32(7)

	t.Run("active", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		mockRepo.On("GetConversationWithOrg", ctx, int32(1), orgID).Return(db.Conversation{ID: 1}, nil).Once()
		require.NoError(t, svc.validateParentConversationWithOrg(ctx, mockRepo, 1, "user-1", orgID))
		mockRepo.AssertExpectations(t)
	})

	t.Run("deleted", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		mockRepo.On("GetConversationWithOrg", ctx, int32(1), orgID).Return(db.Conversation{ID: 1, IsDeleted: true}, nil).Once()
		require.ErrorContains(t, svc.validateParentConversationWithOrg(ctx, mockRepo, 1, "user-1", orgID), "parent conversation 1 is deleted")
		mockRepo.AssertExpectations(t)
	})

	t.Run("load error", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		mockRepo.On("GetConversationWithOrg", ctx, int32(1), orgID).Return(db.Conversation{}, errors.New("db down")).Once()
		require.ErrorContains(t, svc.validateParentConversationWithOrg(ctx, mockRepo, 1, "user-1", orgID), "get conversation for message create validation")
		mockRepo.AssertExpectations(t)
	})
}

func TestService_validateParentConversation_RejectsOrganizationConversation(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	userID := "user-1"
	orgID := int32(9)
	mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{
		ID:          1,
		SyncVersion: 1,
		VectorClock: VectorClock{"device-1": 1}.Encode(),
	}, nil).Once()
	mockRepo.On("GetConversation", ctx, int32(1)).Return(db.Conversation{
		ID:             1,
		OrganizationID: &orgID,
	}, nil).Once()

	err := svc.validateParentConversation(ctx, mockRepo, 1, userID)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "personal-scope message")
}
