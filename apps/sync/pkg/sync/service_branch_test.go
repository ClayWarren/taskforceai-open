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

func TestService_PullChanges_TelemetryAndErrorBranches(t *testing.T) {
	ctx := context.Background()

	t.Run("heartbeat revoked with telemetry", func(t *testing.T) {
		mockRepo := new(MockSyncRepository)
		svc := NewService(mockRepo, nil, nil, nil, nil, NewTelemetry())
		mockRepo.On("IsSyncDeviceRevoked", mock.Anything, "user-1", "device-1").Return(true, nil).Once()

		_, err := svc.PullChanges(ctx, "user-1", "device-1", "agent", SyncPullRequest{})
		require.ErrorIs(t, err, ErrDeviceRevoked)
		mockRepo.AssertExpectations(t)
	})

	t.Run("fetch messages error", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
		mockRepo.On("GetConversationsAfterVersion", ctx, "user-1", int32(0), int32(101)).Return([]ConversationRecord{}, nil).Once()
		mockRepo.On("GetMessagesAfterVersion", ctx, "user-1", int32(0), int32(101)).Return(nil, errors.New("messages failed")).Once()

		_, err := svc.PullChanges(ctx, "user-1", "device-1", "agent", SyncPullRequest{})
		require.ErrorContains(t, err, "get messages")
		mockRepo.AssertExpectations(t)
	})

	t.Run("org count message error", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		orgID := int32(7)
		mockRepo.On("GetSyncCounts", mock.Anything, "user-1", &orgID).Return(int64(0), int64(0), errors.New("count messages failed")).Once()

		_, err := svc.calculateStateHash(ctx, "user-1", &orgID)
		require.ErrorContains(t, err, "get sync counts")
		mockRepo.AssertExpectations(t)
	})

	t.Run("deleted message and telemetry", func(t *testing.T) {
		mockRepo := new(MockSyncRepository)
		svc := NewService(mockRepo, nil, nil, nil, nil, NewTelemetry())
		svc.runAsync = func(fn func()) { fn() }
		updated := time.Unix(100, 0)
		mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
		mockRepo.On("GetConversationsAfterVersion", mock.Anything, "user-1", int32(0), int32(101)).Return([]ConversationRecord{}, nil).Once()
		mockRepo.On("GetMessagesAfterVersion", mock.Anything, "user-1", int32(0), int32(101)).Return([]MessageRecord{
			{MessageID: "msg-deleted", SyncVersion: 2, IsDeleted: true, UpdatedAt: timestampForTest(updated)},
		}, nil).Once()
		mockRepo.On("GetConversationsCount", mock.Anything, "user-1").Return(int64(0), nil).Once()
		mockRepo.On("GetMessagesCount", mock.Anything, "user-1").Return(int64(1), nil).Once()
		mockRepo.On("CreateSyncAuditLog", mock.Anything, mock.Anything).Return(db.SyncAuditLog{}, nil).Once()

		resp, err := svc.PullChanges(ctx, "user-1", "device-1", "agent", SyncPullRequest{})
		require.NoError(t, err)
		require.Len(t, resp.Deletions, 1)
		assert.Equal(t, "message", resp.Deletions[0].Type)
		mockRepo.AssertExpectations(t)
	})
}

func TestService_PullChanges_JSONBudgetBranches(t *testing.T) {
	ctx := context.Background()
	originalBudget := pullResponseBudgetBytes
	t.Cleanup(func() { pullResponseBudgetBytes = originalBudget })

	t.Run("trims to budget and succeeds", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		conversations, _ := makeBenchmarkPullRows(2, 0, 256)
		one := buildPullResponse(0, conversations[:1], nil, true, "2:0")
		pullResponseBudgetBytes = jsonPayloadSize(one)

		mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
		mockRepo.On("GetConversationsAfterVersion", ctx, "user-1", int32(0), int32(101)).Return(conversations, nil).Once()
		mockRepo.On("GetMessagesAfterVersion", ctx, "user-1", int32(0), int32(101)).Return([]MessageRecord{}, nil).Once()
		mockRepo.On("GetConversationsCount", mock.Anything, "user-1").Return(int64(2), nil).Once()
		mockRepo.On("GetMessagesCount", mock.Anything, "user-1").Return(int64(0), nil).Once()
		mockRepo.On("CreateSyncAuditLog", mock.Anything, mock.Anything).Return(db.SyncAuditLog{}, nil).Once()

		resp, err := svc.PullChanges(ctx, "user-1", "device-1", "agent", SyncPullRequest{})

		require.NoError(t, err)
		require.Len(t, resp.Conversations, 1)
		assert.True(t, resp.HasMore)
		mockRepo.AssertExpectations(t)
	})

	t.Run("returns error when one change exceeds budget", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		conversations, _ := makeBenchmarkPullRows(1, 0, 2048)
		pullResponseBudgetBytes = 1

		mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
		mockRepo.On("GetConversationsAfterVersion", ctx, "user-1", int32(0), int32(101)).Return(conversations, nil).Once()
		mockRepo.On("GetMessagesAfterVersion", ctx, "user-1", int32(0), int32(101)).Return([]MessageRecord{}, nil).Once()
		mockRepo.On("GetConversationsCount", mock.Anything, "user-1").Return(int64(1), nil).Once()
		mockRepo.On("GetMessagesCount", mock.Anything, "user-1").Return(int64(0), nil).Once()

		_, err := svc.PullChanges(ctx, "user-1", "device-1", "agent", SyncPullRequest{})

		require.ErrorIs(t, err, errSyncPullChangeExceedsBudget)
		mockRepo.AssertExpectations(t)
	})
}

func TestService_SyncConversations_Branches(t *testing.T) {
	ctx := context.Background()

	t.Run("stale update skipped", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		incoming := ConversationSyncPayload{ID: 1, VectorClock: VectorClock{"device": 1}.Encode()}
		mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{
			ID:          1,
			SyncVersion: 5,
			VectorClock: VectorClock{"device": 2}.Encode(),
		}, nil).Once()

		version, conflicts, accepted, mappings, err := svc.syncConversations(ctx, mockRepo, "user-1", "device", nil, 5, StrategyServerWins, []ConversationSyncPayload{incoming})
		require.NoError(t, err)
		assert.Equal(t, int32(5), version)
		require.Len(t, conflicts, 1)
		assert.Equal(t, "server_newer", conflicts[0].Reason)
		assert.Empty(t, accepted)
		assert.Empty(t, mappings)
		mockRepo.AssertExpectations(t)
	})

	t.Run("version lookup error", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{}, errors.New("db down")).Once()

		_, _, _, _, err := svc.syncConversations(ctx, mockRepo, "user-1", "device", nil, 5, StrategyServerWins, []ConversationSyncPayload{{ID: 1}})
		require.ErrorContains(t, err, "get conversation version")
		mockRepo.AssertExpectations(t)
	})

	t.Run("missing conversation records conflict", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{}, pgx.ErrNoRows).Once()

		version, conflicts, accepted, _, err := svc.syncConversations(ctx, mockRepo, "user-1", "device", nil, 5, StrategyServerWins, []ConversationSyncPayload{{ID: 1, SyncVersion: 4}})

		require.NoError(t, err)
		assert.Equal(t, int32(5), version)
		require.Len(t, conflicts, 1)
		assert.Equal(t, "missing_conversation", conflicts[0].Reason)
		assert.Empty(t, accepted)
		mockRepo.AssertExpectations(t)
	})

	t.Run("unsupported strategy", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		incoming := ConversationSyncPayload{ID: 1, VectorClock: VectorClock{"client": 1}.Encode()}
		mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{
			ID:          1,
			SyncVersion: 5,
			VectorClock: VectorClock{"server": 1}.Encode(),
		}, nil).Once()

		_, _, _, _, err := svc.syncConversations(ctx, mockRepo, "user-1", "device", nil, 5, ResolutionStrategy("bad"), []ConversationSyncPayload{incoming})
		require.ErrorContains(t, err, "unsupported resolution strategy")
		mockRepo.AssertExpectations(t)
	})

	t.Run("auto merge unresolved records conflict", func(t *testing.T) {
		mockRepo := new(MockSyncRepository)
		svc := NewService(mockRepo, nil, nil, nil, nil, NewTelemetry())
		incoming := ConversationSyncPayload{ID: 1, SyncVersion: 4, VectorClock: VectorClock{"client": 1}.Encode()}
		mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{
			ID:          1,
			SyncVersion: 5,
			VectorClock: VectorClock{"server": 1}.Encode(),
		}, nil).Once()

		version, conflicts, accepted, _, err := svc.syncConversations(ctx, mockRepo, "user-1", "device", nil, 5, StrategyAutoMerge, []ConversationSyncPayload{incoming})
		require.NoError(t, err)
		assert.Equal(t, int32(5), version)
		require.Len(t, conflicts, 1)
		assert.Equal(t, "concurrent_update", conflicts[0].Reason)
		assert.Empty(t, accepted)
		mockRepo.AssertExpectations(t)
	})

	t.Run("auto merge resolver error", func(t *testing.T) {
		mockRepo := new(MockSyncRepository)
		mockResolver := new(MockConflictResolver)
		svc := NewService(mockRepo, nil, mockResolver, nil, nil, NewTelemetry())
		incoming := ConversationSyncPayload{ID: 1, VectorClock: VectorClock{"client": 1}.Encode()}
		mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{
			ID:          1,
			SyncVersion: 5,
			VectorClock: VectorClock{"server": 1}.Encode(),
		}, nil).Once()
		mockRepo.On("GetConversation", ctx, int32(1)).Return(db.Conversation{ID: 1}, nil).Once()
		mockResolver.On("ResolveConversation", mock.Anything, incoming).Return(ConversationSyncPayload{}, errors.New("merge failed")).Once()

		_, _, _, _, err := svc.syncConversations(ctx, mockRepo, "user-1", "device", nil, 5, StrategyAutoMerge, []ConversationSyncPayload{incoming})
		require.ErrorContains(t, err, "resolve conversation conflict")
		mockRepo.AssertExpectations(t)
		mockResolver.AssertExpectations(t)
	})

	t.Run("patch load error", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		incoming := ConversationSyncPayload{ID: 1, VectorClock: VectorClock{"device": 1}.Encode(), Patches: []byte(`[]`)}
		mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{
			ID:          1,
			SyncVersion: 5,
			VectorClock: VectorClock{"device": 1}.Encode(),
		}, nil).Once()
		mockRepo.On("GetConversation", ctx, int32(1)).Return(db.Conversation{}, errors.New("load failed")).Once()

		_, _, _, _, err := svc.syncConversations(ctx, mockRepo, "user-1", "device", nil, 5, StrategyServerWins, []ConversationSyncPayload{incoming})
		require.ErrorContains(t, err, "get conversation")
		mockRepo.AssertExpectations(t)
	})

	t.Run("unavailable conversation for patch records conflict", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		incoming := ConversationSyncPayload{ID: 1, SyncVersion: 5, VectorClock: VectorClock{"device": 1}.Encode(), Patches: []byte(`[]`)}
		mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{
			ID:          1,
			SyncVersion: 5,
			VectorClock: VectorClock{"device": 1}.Encode(),
		}, nil).Once()
		mockRepo.On("GetConversation", ctx, int32(1)).Return(db.Conversation{}, pgx.ErrNoRows).Once()

		version, conflicts, accepted, _, err := svc.syncConversations(ctx, mockRepo, "user-1", "device", nil, 5, StrategyServerWins, []ConversationSyncPayload{incoming})

		require.NoError(t, err)
		assert.Equal(t, int32(5), version)
		require.Len(t, conflicts, 1)
		assert.Equal(t, "conversation_unavailable", conflicts[0].Reason)
		assert.Empty(t, accepted)
		mockRepo.AssertExpectations(t)
	})

	t.Run("update error", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		incoming := ConversationSyncPayload{ID: 1, VectorClock: VectorClock{"device": 1}.Encode()}
		mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{
			ID:          1,
			SyncVersion: 5,
			VectorClock: VectorClock{"device": 1}.Encode(),
		}, nil).Once()
		mockRepo.On("UpdateConversationSync", ctx, mock.Anything).Return(errors.New("update failed")).Once()

		_, _, _, _, err := svc.syncConversations(ctx, mockRepo, "user-1", "device", map[string]struct{}{"device": {}}, 5, StrategyServerWins, []ConversationSyncPayload{incoming})
		require.ErrorContains(t, err, "update conversation")
		mockRepo.AssertExpectations(t)
	})
}

func TestService_PropagatesSyncVersionAllocationFailures(t *testing.T) {
	ctx := context.Background()
	allocationErr := errors.New("sequence unavailable")

	t.Run("existing conversation", func(t *testing.T) {
		svc, repo, _ := newSyncTest()
		repo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{ID: 1}, nil).Once()
		repo.On("NextSyncVersion", ctx, int32(5)).Return(int32(5), allocationErr).Once()

		_, _, _, _, err := svc.syncConversations(ctx, repo, "user-1", "device-1", nil, 5, StrategyServerWins, []ConversationSyncPayload{{ID: 1}})
		require.ErrorContains(t, err, "allocate sync version")
		repo.AssertExpectations(t)
	})

	t.Run("existing message", func(t *testing.T) {
		svc, repo, _ := newSyncTest()
		repo.On("GetMessageVersion", ctx, "message-1").Return(db.GetMessageVersionRow{MessageID: "message-1"}, nil).Once()
		repo.On("NextSyncVersion", ctx, int32(5)).Return(int32(5), allocationErr).Once()

		_, _, _, err := svc.syncMessages(ctx, repo, "user-1", "device-1", nil, 5, nil, StrategyServerWins, []MessageSyncPayload{{MessageID: "message-1"}})
		require.ErrorContains(t, err, "allocate sync version")
		repo.AssertExpectations(t)
	})

	t.Run("new message", func(t *testing.T) {
		svc, repo, _ := newSyncTest()
		repo.On("GetMessageVersion", ctx, "message-new").Return(db.GetMessageVersionRow{}, pgx.ErrNoRows).Once()
		repo.On("NextSyncVersion", ctx, int32(5)).Return(int32(5), allocationErr).Once()

		_, _, _, err := svc.syncMessages(ctx, repo, "user-1", "device-1", nil, 5, nil, StrategyServerWins, []MessageSyncPayload{{MessageID: "message-new"}})
		require.ErrorContains(t, err, "allocate sync version")
		repo.AssertExpectations(t)
	})

	t.Run("conversation deletion", func(t *testing.T) {
		svc, repo, _ := newSyncTest()
		repo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{ID: 1}, nil).Once()
		repo.On("GetConversation", ctx, int32(1)).Return(db.Conversation{ID: 1}, nil).Once()
		repo.On("NextSyncVersion", ctx, int32(5)).Return(int32(5), allocationErr).Once()

		_, _, err := svc.applyDeletions(ctx, repo, "user-1", "device-1", nil, 5, []DeletionRecord{{Type: "conversation", ID: "1"}})
		require.ErrorContains(t, err, "allocate sync version")
		repo.AssertExpectations(t)
	})

	t.Run("message deletion", func(t *testing.T) {
		svc, repo, _ := newSyncTest()
		repo.On("GetMessageVersion", ctx, "message-1").Return(db.GetMessageVersionRow{MessageID: "message-1"}, nil).Once()
		repo.On("GetMessageByMessageID", ctx, "message-1").Return(db.Message{MessageID: "message-1"}, nil).Once()
		repo.On("NextSyncVersion", ctx, int32(5)).Return(int32(5), allocationErr).Once()

		_, _, err := svc.applyDeletions(ctx, repo, "user-1", "device-1", nil, 5, []DeletionRecord{{Type: "message", ID: "message-1"}})
		require.ErrorContains(t, err, "allocate sync version")
		repo.AssertExpectations(t)
	})

	t.Run("non-advancing allocation", func(t *testing.T) {
		_, repo, _ := newSyncTest()
		repo.On("NextSyncVersion", ctx, int32(5)).Return(int32(5), nil).Once()

		version, err := nextSyncVersion(ctx, repo, 5)
		require.ErrorContains(t, err, "does not advance")
		assert.Equal(t, int32(5), version)
		repo.AssertExpectations(t)
	})
}

func TestService_SyncMessages_Branches(t *testing.T) {
	ctx := context.Background()

	t.Run("new message create error", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		incoming := MessageSyncPayload{MessageID: "msg-1", ConversationID: 1, CreatedAt: time.Now()}
		mockRepo.On("GetMessageVersion", ctx, "msg-1").Return(db.GetMessageVersionRow{}, pgx.ErrNoRows).Once()
		mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{ID: 1}, nil).Once()
		mockRepo.On("GetConversation", ctx, int32(1)).Return(db.Conversation{ID: 1}, nil).Once()
		mockRepo.On("CreateMessageSync", ctx, mock.Anything).Return(db.Message{}, errors.New("create failed")).Once()

		_, _, _, err := svc.syncMessages(ctx, mockRepo, "user-1", "device", nil, 5, nil, StrategyServerWins, []MessageSyncPayload{incoming})
		require.ErrorContains(t, err, "create message")
		mockRepo.AssertExpectations(t)
	})

	t.Run("version lookup error", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		mockRepo.On("GetMessageVersion", ctx, "msg-1").Return(db.GetMessageVersionRow{}, errors.New("db down")).Once()

		_, _, _, err := svc.syncMessages(ctx, mockRepo, "user-1", "device", nil, 5, nil, StrategyServerWins, []MessageSyncPayload{{MessageID: "msg-1"}})
		require.ErrorContains(t, err, "get message version")
		mockRepo.AssertExpectations(t)
	})

	t.Run("full message load error", func(t *testing.T) {
		mockRepo := new(MockSyncRepository)
		svc := NewService(mockRepo, nil, NewAutoMergeResolver(), nil, nil, nil)
		incoming := MessageSyncPayload{MessageID: "msg-1", VectorClock: VectorClock{"client": 1}.Encode()}
		mockRepo.On("GetMessageVersion", ctx, "msg-1").Return(db.GetMessageVersionRow{
			MessageID:   "msg-1",
			SyncVersion: 5,
			VectorClock: VectorClock{"server": 1}.Encode(),
		}, nil).Once()
		mockRepo.On("GetMessageByMessageID", ctx, "msg-1").Return(db.Message{}, errors.New("load failed")).Once()

		_, _, _, err := svc.syncMessages(ctx, mockRepo, "user-1", "device", nil, 5, nil, StrategyAutoMerge, []MessageSyncPayload{incoming})
		require.ErrorContains(t, err, "get message")
		mockRepo.AssertExpectations(t)
	})

	t.Run("auto merge unresolved records conflict", func(t *testing.T) {
		mockRepo := new(MockSyncRepository)
		svc := NewService(mockRepo, nil, nil, nil, nil, NewTelemetry())
		incoming := MessageSyncPayload{MessageID: "msg-1", SyncVersion: 4, VectorClock: VectorClock{"client": 1}.Encode()}
		mockRepo.On("GetMessageVersion", ctx, "msg-1").Return(db.GetMessageVersionRow{
			MessageID:   "msg-1",
			SyncVersion: 5,
			VectorClock: VectorClock{"server": 1}.Encode(),
		}, nil).Once()

		version, conflicts, accepted, err := svc.syncMessages(ctx, mockRepo, "user-1", "device", nil, 5, nil, StrategyAutoMerge, []MessageSyncPayload{incoming})
		require.NoError(t, err)
		assert.Equal(t, int32(5), version)
		require.Len(t, conflicts, 1)
		assert.Equal(t, "concurrent_update", conflicts[0].Reason)
		assert.Empty(t, accepted)
		mockRepo.AssertExpectations(t)
	})

	t.Run("auto merge resolver error", func(t *testing.T) {
		mockRepo := new(MockSyncRepository)
		mockResolver := new(MockConflictResolver)
		svc := NewService(mockRepo, nil, mockResolver, nil, nil, NewTelemetry())
		incoming := MessageSyncPayload{MessageID: "msg-1", VectorClock: VectorClock{"client": 1}.Encode()}
		mockRepo.On("GetMessageVersion", ctx, "msg-1").Return(db.GetMessageVersionRow{
			MessageID:   "msg-1",
			SyncVersion: 5,
			VectorClock: VectorClock{"server": 1}.Encode(),
		}, nil).Once()
		mockRepo.On("GetMessageByMessageID", ctx, "msg-1").Return(db.Message{MessageID: "msg-1"}, nil).Once()
		mockResolver.On("ResolveMessage", mock.Anything, incoming).Return(MessageSyncPayload{}, errors.New("merge failed")).Once()

		_, _, _, err := svc.syncMessages(ctx, mockRepo, "user-1", "device", nil, 5, nil, StrategyAutoMerge, []MessageSyncPayload{incoming})
		require.ErrorContains(t, err, "resolve message conflict")
		mockRepo.AssertExpectations(t)
		mockResolver.AssertExpectations(t)
	})

	t.Run("unsupported strategy", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		incoming := MessageSyncPayload{MessageID: "msg-1", VectorClock: VectorClock{"client": 1}.Encode()}
		mockRepo.On("GetMessageVersion", ctx, "msg-1").Return(db.GetMessageVersionRow{
			MessageID:   "msg-1",
			SyncVersion: 5,
			VectorClock: VectorClock{"server": 1}.Encode(),
		}, nil).Once()

		_, _, _, err := svc.syncMessages(ctx, mockRepo, "user-1", "device", nil, 5, nil, ResolutionStrategy("bad"), []MessageSyncPayload{incoming})
		require.ErrorContains(t, err, "unsupported resolution strategy")
		mockRepo.AssertExpectations(t)
	})

	t.Run("update error", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		incoming := MessageSyncPayload{MessageID: "msg-1", VectorClock: VectorClock{"device": 1}.Encode()}
		mockRepo.On("GetMessageVersion", ctx, "msg-1").Return(db.GetMessageVersionRow{
			MessageID:   "msg-1",
			SyncVersion: 5,
			VectorClock: VectorClock{"device": 1}.Encode(),
		}, nil).Once()
		mockRepo.On("UpdateMessageSync", ctx, mock.Anything).Return(errors.New("update failed")).Once()

		_, _, _, err := svc.syncMessages(ctx, mockRepo, "user-1", "device", map[string]struct{}{"device": {}}, 5, nil, StrategyServerWins, []MessageSyncPayload{incoming})
		require.ErrorContains(t, err, "update message")
		mockRepo.AssertExpectations(t)
	})
}

func TestService_ResponseAndTrimHelpers_Branches(t *testing.T) {
	response := ensurePushResponseDefaults(SyncPushResponse{
		Conflicts:  []ConflictRecord{{ID: "c1"}},
		NewVersion: 22,
	})
	assert.Equal(t, "conflict", response.Conflicts[0].Reason)
	assert.Equal(t, int32(22), response.Version)

	convs, msgs, more := trimChangesByGlobalLimit([]ConversationRecord{{ID: 1}}, nil, 0)
	assert.Empty(t, convs)
	assert.Empty(t, msgs)
	assert.True(t, more)

	a := time.Unix(10, 0)
	b := time.Unix(5, 0)
	convs, msgs, more = trimChangesByGlobalLimit(
		[]ConversationRecord{{ID: 1, SyncVersion: 2, UpdatedAt: timestampForTest(a)}, {ID: 2, SyncVersion: 1, UpdatedAt: timestampForTest(a)}},
		[]MessageRecord{{MessageID: "m1", SyncVersion: 1, UpdatedAt: timestampForTest(b)}},
		2,
	)
	assert.True(t, more)
	assert.Len(t, convs, 1)
	assert.Len(t, msgs, 1)
	assert.Equal(t, int32(2), convs[0].ID)
	assert.Equal(t, "m1", msgs[0].MessageID)
}

func TestService_TrimPullResponseToJSONBudget(t *testing.T) {
	updatedAt := timestampForTest(time.Unix(10, 0))
	messages := []MessageRecord{
		{MessageID: "m1", Content: strings.Repeat("a", 200), SyncVersion: 1, UpdatedAt: updatedAt},
		{MessageID: "m2", Content: strings.Repeat("b", 200), SyncVersion: 2, UpdatedAt: updatedAt},
		{MessageID: "m3", Content: strings.Repeat("c", 200), SyncVersion: 3, UpdatedAt: updatedAt},
	}
	full := buildPullResponse(0, nil, messages, false, "0:3")
	oneLess := buildPullResponse(0, nil, messages[:2], true, "0:3")
	budget := (jsonPayloadSize(full) + jsonPayloadSize(oneLess)) / 2

	response, trimmed, err := trimPullResponseToJSONBudget(0, nil, messages, false, "0:3", budget)

	require.NoError(t, err)
	require.True(t, trimmed)
	require.LessOrEqual(t, jsonPayloadSize(response), budget)
	assert.True(t, response.HasMore)
	assert.Len(t, response.Messages, 2)
	assert.Equal(t, "m2", response.Messages[1].MessageID)
	assert.Equal(t, int32(2), response.LatestVersion)
}

func TestService_TrimPullResponseToJSONBudget_TrimsRowsBeforeCompaction(t *testing.T) {
	updatedAt := timestampForTest(time.Unix(10, 0))
	messages := []MessageRecord{
		{
			MessageID:   "m1",
			Content:     "visible content",
			Trace:       []byte(`{"blob":"` + strings.Repeat("a", 350) + `"}`),
			ToolEvents:  []byte(`{"blob":"` + strings.Repeat("b", 350) + `"}`),
			SyncVersion: 1,
			UpdatedAt:   updatedAt,
		},
		{
			MessageID:   "m2",
			Content:     "second message",
			Trace:       []byte(`{"blob":"` + strings.Repeat("c", 350) + `"}`),
			ToolEvents:  []byte(`{"blob":"` + strings.Repeat("d", 350) + `"}`),
			SyncVersion: 2,
			UpdatedAt:   updatedAt,
		},
	}
	full := buildPullResponse(0, nil, messages, false, "0:2")
	oneRow := buildPullResponse(0, nil, messages[:1], true, "0:2")
	budget := jsonPayloadSize(oneRow) + 10
	require.Less(t, budget, jsonPayloadSize(full))

	response, trimmed, err := trimPullResponseToJSONBudget(0, nil, messages, false, "0:2", budget)

	require.NoError(t, err)
	require.True(t, trimmed)
	require.LessOrEqual(t, jsonPayloadSize(response), budget)
	assert.True(t, response.HasMore)
	require.Len(t, response.Messages, 1)
	assert.Equal(t, "m1", response.Messages[0].MessageID)
	assert.Nil(t, response.Messages[0].Trace)
	assert.NotNil(t, response.Messages[0].ToolEvents)
	assert.Equal(t, int32(1), response.LatestVersion)
}

func TestService_TrimPullResponseToJSONBudget_RejectsSingleOversizedMessageWithoutAdvancing(t *testing.T) {
	updatedAt := timestampForTest(time.Unix(10, 0))
	messages := []MessageRecord{
		{
			MessageID:      "m1",
			Content:        "visible content",
			ConversationID: 1,
			Role:           "assistant",
			Trace:          []byte(`{"blob":"` + strings.Repeat("x", 1000) + `"}`),
			ToolEvents:     []byte(`{"blob":"` + strings.Repeat("x", 1000) + `"}`),
			AgentStatuses:  []byte(`{"blob":"` + strings.Repeat("x", 1000) + `"}`),
			Sources:        []byte(`{"blob":"` + strings.Repeat("x", 1000) + `"}`),
			SyncVersion:    4,
			UpdatedAt:      updatedAt,
		},
	}
	full := buildPullResponse(0, nil, messages, false, "0:1")
	budget := jsonPayloadSize(full) - 1

	response, trimmed, err := trimPullResponseToJSONBudget(0, nil, messages, false, "0:1", budget)

	require.True(t, trimmed)
	require.ErrorIs(t, err, errSyncPullChangeExceedsBudget)
	assert.Empty(t, response.Messages)
	assert.Zero(t, response.LatestVersion)
}

func TestService_TrimPullResponseToJSONBudget_RejectsSinglePoisonMessage(t *testing.T) {
	updatedAt := timestampForTest(time.Unix(10, 0))
	messages := []MessageRecord{
		{
			MessageID:   "m1",
			Content:     strings.Repeat("x", 2000),
			SyncVersion: 4,
			UpdatedAt:   updatedAt,
		},
	}
	full := buildPullResponse(0, nil, messages, false, "0:1")
	budget := jsonPayloadSize(full) - 1

	response, trimmed, err := trimPullResponseToJSONBudget(0, nil, messages, false, "0:1", budget)

	require.True(t, trimmed)
	require.ErrorIs(t, err, errSyncPullChangeExceedsBudget)
	assert.Empty(t, response.Messages)
}

func TestService_TrimPullResponseToJSONBudget_RejectsOversizedError(t *testing.T) {
	updatedAt := timestampForTest(time.Unix(10, 0))
	largeError := strings.Repeat("e", 2000)
	messages := []MessageRecord{
		{
			MessageID:   "m1",
			Content:     "content",
			Error:       &largeError,
			SyncVersion: 4,
			UpdatedAt:   updatedAt,
		},
	}
	full := buildPullResponse(0, nil, messages, false, "0:1")
	budget := jsonPayloadSize(full) - 1

	response, trimmed, err := trimPullResponseToJSONBudget(0, nil, messages, false, "0:1", budget)

	require.True(t, trimmed)
	require.ErrorIs(t, err, errSyncPullChangeExceedsBudget)
	assert.Empty(t, response.Messages)
}

func TestService_TrimPullResponseToJSONBudget_RejectsUnrepresentableSingleChange(t *testing.T) {
	updatedAt := timestampForTest(time.Unix(10, 0))
	hugeID := "m1-" + strings.Repeat("v", 2000)
	messages := []MessageRecord{
		{
			MessageID:    hugeID,
			Content:      strings.Repeat("x", 2000),
			SyncVersion:  4,
			LastSyncedAt: updatedAt,
			UpdatedAt:    updatedAt,
		},
	}
	full := buildPullResponse(0, nil, messages, false, "0:1")
	budget := jsonPayloadSize(full) - 1

	response, trimmed, err := trimPullResponseToJSONBudget(0, nil, messages, false, "0:1", budget)

	require.True(t, trimmed)
	require.ErrorIs(t, err, errSyncPullChangeExceedsBudget)
	assert.Empty(t, response.Messages)
	assert.Empty(t, response.Conversations)
}

func TestService_TrimPullResponseToJSONBudget_RejectsOversizedConversationResult(t *testing.T) {
	updatedAt := timestampForTest(time.Unix(10, 0))
	result := strings.Repeat("x", 1000)
	conversations := []ConversationRecord{
		{ID: 1, UserInput: "prompt", Result: &result, SyncVersion: 3, UpdatedAt: updatedAt},
	}
	full := buildPullResponse(0, conversations, nil, false, "1:0")
	budget := jsonPayloadSize(full) - 1

	response, trimmed, err := trimPullResponseToJSONBudget(0, conversations, nil, false, "1:0", budget)

	require.True(t, trimmed)
	require.ErrorIs(t, err, errSyncPullChangeExceedsBudget)
	assert.Empty(t, response.Conversations)
	assert.Zero(t, response.LatestVersion)
}

func TestService_PushChanges_TransactionStageErrors(t *testing.T) {
	ctx := context.Background()

	t.Run("get devices error", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
		mockRepo.On("GetLatestSyncVersion", ctx, "user-1").Return(int32(1), nil).Once()
		mockRepo.On("GetSyncDevices", ctx, "user-1").Return(nil, errors.New("devices failed")).Once()
		mockRepo.On("CreateSyncAuditLog", mock.Anything, mock.Anything).Return(db.SyncAuditLog{}, nil).Once()

		_, err := svc.PushChanges(ctx, "user-1", "device-1", "agent", "", SyncPushRequest{})
		require.ErrorContains(t, err, "get sync devices")
		mockRepo.AssertExpectations(t)
	})

	t.Run("conversation stage error", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
		mockRepo.On("GetLatestSyncVersion", ctx, "user-1").Return(int32(1), nil).Once()
		mockRepo.On("GetSyncDevices", ctx, "user-1").Return([]db.SyncDevice{}, nil).Once()
		mockRepo.On("CreateConversationSync", mock.Anything, mock.Anything).Return(db.Conversation{}, errors.New("create failed")).Once()
		mockRepo.On("CreateSyncAuditLog", mock.Anything, mock.Anything).Return(db.SyncAuditLog{}, nil).Once()

		_, err := svc.PushChanges(ctx, "user-1", "device-1", "agent", "", SyncPushRequest{Conversations: []ConversationSyncPayload{{UserInput: "prompt"}}})
		require.ErrorContains(t, err, "create conversation")
		mockRepo.AssertExpectations(t)
	})

	t.Run("message stage error", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
		mockRepo.On("GetLatestSyncVersion", ctx, "user-1").Return(int32(1), nil).Once()
		mockRepo.On("GetSyncDevices", ctx, "user-1").Return([]db.SyncDevice{}, nil).Once()
		mockRepo.On("GetMessageVersion", mock.Anything, "msg-1").Return(db.GetMessageVersionRow{}, errors.New("lookup failed")).Once()
		mockRepo.On("CreateSyncAuditLog", mock.Anything, mock.Anything).Return(db.SyncAuditLog{}, nil).Once()

		_, err := svc.PushChanges(ctx, "user-1", "device-1", "agent", "", SyncPushRequest{Messages: []MessageSyncPayload{{MessageID: "msg-1"}}})
		require.ErrorContains(t, err, "get message version")
		mockRepo.AssertExpectations(t)
	})

	t.Run("deletion stage error", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
		mockRepo.On("GetLatestSyncVersion", ctx, "user-1").Return(int32(1), nil).Once()
		mockRepo.On("GetSyncDevices", ctx, "user-1").Return([]db.SyncDevice{}, nil).Once()
		mockRepo.On("CreateSyncAuditLog", mock.Anything, mock.Anything).Return(db.SyncAuditLog{}, nil).Once()

		_, err := svc.PushChanges(ctx, "user-1", "device-1", "agent", "", SyncPushRequest{Deletions: []DeletionRecord{{Type: "conversation", ID: "bad"}}})
		require.ErrorContains(t, err, "invalid conversation deletion id")
		mockRepo.AssertExpectations(t)
	})

	t.Run("telemetry success", func(t *testing.T) {
		mockRepo := new(MockSyncRepository)
		svc := NewService(mockRepo, nil, nil, nil, nil, NewTelemetry())
		mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
		mockRepo.On("GetLatestSyncVersion", mock.Anything, "user-1").Return(int32(1), nil).Once()
		mockRepo.On("GetSyncDevices", mock.Anything, "user-1").Return([]db.SyncDevice{}, nil).Once()
		mockRepo.On("CreateSyncAuditLog", mock.Anything, mock.Anything).Return(db.SyncAuditLog{}, nil).Once()

		resp, err := svc.PushChanges(ctx, "user-1", "device-1", "agent", "", SyncPushRequest{})
		require.NoError(t, err)
		assert.Equal(t, int32(1), resp.Version)
		mockRepo.AssertExpectations(t)
	})
}

func TestService_DirectRemainingBranches(t *testing.T) {
	ctx := context.Background()

	t.Run("revoke logs error", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		mockRepo.On("RevokeSyncDevice", ctx, "user-1", "device-1").Return(errors.New("revoke failed")).Once()
		require.Error(t, svc.RevokeDevice(ctx, "user-1", "device-1"))
		mockRepo.AssertExpectations(t)
	})

	t.Run("parent validation lookup errors", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{}, errors.New("version failed")).Once()
		require.ErrorContains(t, svc.validateParentConversation(ctx, mockRepo, 1, "user-1"), "validate conversation")
		mockRepo.AssertExpectations(t)

		mockRepo = new(MockSyncRepository)
		svc = NewService(mockRepo, nil, nil, nil, nil, nil)
		mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{ID: 1}, nil).Once()
		mockRepo.On("GetConversation", ctx, int32(1)).Return(db.Conversation{}, errors.New("load failed")).Once()
		require.ErrorContains(t, svc.validateParentConversation(ctx, mockRepo, 1, "user-1"), "get conversation")
		mockRepo.AssertExpectations(t)
	})

	t.Run("conversation client wins with telemetry", func(t *testing.T) {
		mockRepo := new(MockSyncRepository)
		svc := NewService(mockRepo, nil, nil, nil, nil, NewTelemetry())
		incoming := ConversationSyncPayload{ID: 1, VectorClock: VectorClock{"client": 1}.Encode()}
		mockRepo.On("GetConversationVersion", mock.Anything, int32(1), mock.Anything).Return(db.GetConversationVersionRow{
			ID:          1,
			SyncVersion: 5,
			VectorClock: VectorClock{"server": 1}.Encode(),
		}, nil).Once()
		mockRepo.On("UpdateConversationSync", mock.Anything, mock.Anything).Return(nil).Once()
		_, _, accepted, _, err := svc.syncConversations(ctx, mockRepo, "user-1", "device", nil, 5, StrategyClientWins, []ConversationSyncPayload{incoming})
		require.NoError(t, err)
		assert.Equal(t, []string{"conversation:1"}, accepted)
		mockRepo.AssertExpectations(t)
	})

	t.Run("conversation server wins with telemetry", func(t *testing.T) {
		mockRepo := new(MockSyncRepository)
		svc := NewService(mockRepo, nil, nil, nil, nil, NewTelemetry())
		incoming := ConversationSyncPayload{ID: 1, VectorClock: VectorClock{"client": 1}.Encode()}
		mockRepo.On("GetConversationVersion", mock.Anything, int32(1), mock.Anything).Return(db.GetConversationVersionRow{
			ID:          1,
			SyncVersion: 5,
			VectorClock: VectorClock{"server": 1}.Encode(),
		}, nil).Once()
		_, _, accepted, _, err := svc.syncConversations(ctx, mockRepo, "user-1", "device", nil, 5, StrategyServerWins, []ConversationSyncPayload{incoming})
		require.NoError(t, err)
		assert.Equal(t, []string{"conversation:1"}, accepted)
		mockRepo.AssertExpectations(t)
	})

	t.Run("message client and server wins with telemetry", func(t *testing.T) {
		for _, strategy := range []ResolutionStrategy{StrategyClientWins, StrategyServerWins} {
			mockRepo := new(MockSyncRepository)
			svc := NewService(mockRepo, nil, nil, nil, nil, NewTelemetry())
			incoming := MessageSyncPayload{MessageID: "msg-" + string(strategy), VectorClock: VectorClock{"client": 1}.Encode()}
			mockRepo.On("GetMessageVersion", mock.Anything, incoming.MessageID).Return(db.GetMessageVersionRow{
				MessageID:   incoming.MessageID,
				SyncVersion: 5,
				VectorClock: VectorClock{"server": 1}.Encode(),
			}, nil).Once()
			if strategy == StrategyClientWins {
				mockRepo.On("UpdateMessageSync", mock.Anything, mock.Anything).Return(nil).Once()
			}
			_, _, _, err := svc.syncMessages(ctx, mockRepo, "user-1", "device", nil, 5, nil, strategy, []MessageSyncPayload{incoming})
			require.NoError(t, err)
			mockRepo.AssertExpectations(t)
		}
	})
}

func TestService_FetchAndCountRemainingErrors(t *testing.T) {
	ctx := context.Background()

	t.Run("org conversation fetch error", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		orgID := int32(7)
		mockRepo.On("GetConversationsByOrgAfterVersion", ctx, orgID, int32(0), int32(101)).Return(nil, errors.New("convs failed")).Once()
		mockRepo.On("GetMessagesByOrgAfterVersion", ctx, orgID, int32(0), int32(101)).Return([]MessageRecord{}, nil).Once()
		_, _, err := svc.fetchChanges(ctx, "user-1", SyncPullRequest{OrganizationID: &orgID})
		require.ErrorContains(t, err, "get conversations by org")
		mockRepo.AssertExpectations(t)
	})

	t.Run("org message fetch error", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		orgID := int32(7)
		mockRepo.On("GetConversationsByOrgAfterVersion", ctx, orgID, int32(0), int32(101)).Return([]ConversationRecord{}, nil).Once()
		mockRepo.On("GetMessagesByOrgAfterVersion", ctx, orgID, int32(0), int32(101)).Return(nil, errors.New("msgs failed")).Once()
		_, _, err := svc.fetchChanges(ctx, "user-1", SyncPullRequest{OrganizationID: &orgID})
		require.ErrorContains(t, err, "get messages by org")
		mockRepo.AssertExpectations(t)
	})

	t.Run("count errors", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		orgID := int32(7)
		mockRepo.On("GetSyncCounts", mock.Anything, "user-1", &orgID).Return(int64(0), int64(0), errors.New("count org convs failed")).Once()
		_, err := svc.calculateStateHash(ctx, "user-1", &orgID)
		require.ErrorContains(t, err, "get sync counts")

		mockRepo.On("GetSyncCounts", mock.Anything, "user-1", (*int32)(nil)).Return(int64(0), int64(0), errors.New("count msgs failed")).Once()
		_, err = svc.calculateStateHash(ctx, "user-1", nil)
		require.ErrorContains(t, err, "get sync counts")
		mockRepo.AssertExpectations(t)
	})
}
