package sync

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestService_ApplyDeletions_ErrorAndNoopBranches(t *testing.T) {
	ctx := context.Background()
	userID := "user-1"

	t.Run("invalid conversation id", func(t *testing.T) {
		svc := NewService(new(MockSyncRepository), nil, nil, nil, nil, nil)
		_, _, err := svc.applyDeletions(ctx, svc.repo, userID, "device-1", nil, 1, []DeletionRecord{{Type: "conversation", ID: "not-int"}})
		require.ErrorContains(t, err, "invalid conversation deletion id")
	})

	t.Run("unsupported deletion type", func(t *testing.T) {
		svc := NewService(new(MockSyncRepository), nil, nil, nil, nil, nil)
		_, _, err := svc.applyDeletions(ctx, svc.repo, userID, "device-1", nil, 1, []DeletionRecord{{Type: "project", ID: "1"}})
		require.ErrorContains(t, err, "unsupported deletion type")
	})

	t.Run("conversation no rows skips", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		mockRepo.On("GetConversationVersion", ctx, int32(12), mock.Anything).Return(db.GetConversationVersionRow{}, pgx.ErrNoRows).Once()
		version, accepted, err := svc.applyDeletions(ctx, mockRepo, userID, "device-1", nil, 5, []DeletionRecord{{Type: "conversation", ID: "12"}})
		require.NoError(t, err)
		assert.Equal(t, int32(5), version)
		assert.Equal(t, []string{"deletion:12"}, accepted)
		mockRepo.AssertExpectations(t)
	})

	t.Run("conversation ownership denied", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		owner := "other-user"
		mockRepo.On("GetConversationVersion", ctx, int32(12), mock.Anything).Return(db.GetConversationVersionRow{
			ID:          12,
			SyncVersion: 5,
			VectorClock: VectorClock{"device-1": 1}.Encode(),
		}, nil).Once()
		mockRepo.On("GetConversation", ctx, int32(12)).Return(db.Conversation{ID: 12, UserID: &owner}, nil).Once()
		_, _, err := svc.applyDeletions(ctx, mockRepo, userID, "device-1", nil, 5, []DeletionRecord{{Type: "conversation", ID: "12"}})
		require.ErrorContains(t, err, "delete denied")
		mockRepo.AssertExpectations(t)
	})

	t.Run("message no rows and already deleted skip", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		mockRepo.On("GetMessageVersion", ctx, "missing").Return(db.GetMessageVersionRow{}, pgx.ErrNoRows).Once()
		mockRepo.On("GetMessageVersion", ctx, "deleted").Return(db.GetMessageVersionRow{
			MessageID:   "deleted",
			SyncVersion: 5,
			VectorClock: VectorClock{"device-1": 1}.Encode(),
		}, nil).Once()
		mockRepo.On("GetMessageByMessageID", ctx, "deleted").Return(db.Message{MessageID: "deleted", IsDeleted: true}, nil).Once()

		version, accepted, err := svc.applyDeletions(ctx, mockRepo, userID, "device-1", nil, 5, []DeletionRecord{
			{Type: "message", ID: "missing"},
			{Type: "message", ID: "deleted"},
		})
		require.NoError(t, err)
		assert.Equal(t, int32(5), version)
		assert.Equal(t, []string{"deletion:missing", "deletion:deleted"}, accepted)
		mockRepo.AssertExpectations(t)
	})
}

func TestService_ConversationAndMessageErrorBranches(t *testing.T) {
	ctx := context.Background()

	t.Run("new conversation create error", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		mockRepo.On("CreateConversationSync", ctx, mock.Anything).Return(db.Conversation{}, errors.New("create failed")).Once()
		version, err := svc.handleNewConversation(ctx, mockRepo, "user-1", "device-1", 10, ConversationSyncPayload{}, &[]string{}, map[string]int32{})
		require.ErrorContains(t, err, "create conversation")
		assert.Equal(t, int32(11), version)
		mockRepo.AssertExpectations(t)
	})

	t.Run("duplicate local id maps once", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		localID := "local-1"
		accepted := []string{}
		mappings := map[string]int32{"local-1": 99}
		version, err := svc.handleNewConversation(ctx, mockRepo, "user-1", "device-1", 10, ConversationSyncPayload{LocalID: &localID}, &accepted, mappings)
		require.ErrorContains(t, err, "duplicate conversation local_id")
		assert.Equal(t, int32(10), version)
		assert.Equal(t, int32(99), mappings["local-1"])
		assert.Empty(t, accepted)
		mockRepo.AssertExpectations(t)
	})

	t.Run("new local id mapping records created id", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		localID := "local-2"
		accepted := []string{}
		mappings := map[string]int32{}
		mockRepo.On("CreateConversationSync", ctx, mock.Anything).Return(db.Conversation{ID: 101}, nil).Once()
		version, err := svc.handleNewConversation(ctx, mockRepo, "user-1", "device-1", 10, ConversationSyncPayload{LocalID: &localID}, &accepted, mappings)
		require.NoError(t, err)
		assert.Equal(t, int32(11), version)
		assert.Equal(t, int32(101), mappings["local-2"])
		assert.Equal(t, []string{"conversation:local-2"}, accepted)
		mockRepo.AssertExpectations(t)
	})

	t.Run("org message uniqueness rejects existing message", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		orgID := int32(7)
		mockRepo.On("GetMessageVersion", ctx, "msg-1").Return(db.GetMessageVersionRow{MessageID: "msg-1"}, nil).Once()
		_, err := svc.handleNewMessage(ctx, mockRepo, "user-1", "device-1", 10, &orgID, MessageSyncPayload{MessageID: "msg-1"}, &[]string{})
		require.ErrorContains(t, err, "does not belong to org")
		mockRepo.AssertExpectations(t)
	})

	t.Run("org message uniqueness propagates lookup error", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		orgID := int32(7)
		mockRepo.On("GetMessageVersion", ctx, "msg-1").Return(db.GetMessageVersionRow{}, errors.New("db down")).Once()
		_, err := svc.handleNewMessage(ctx, mockRepo, "user-1", "device-1", 10, &orgID, MessageSyncPayload{MessageID: "msg-1"}, &[]string{})
		require.ErrorContains(t, err, "verify org message uniqueness")
		mockRepo.AssertExpectations(t)
	})
}

func TestService_ListDevices_Error(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	mockRepo.On("GetSyncDevices", ctx, "user").Return(nil, errors.New("db fail")).Once()

	records, err := svc.ListDevices(ctx, "user")
	require.Error(t, err)
	assert.Nil(t, records)
}

func TestService_ListDevices_Success(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()
	now := time.Now()
	userAgent := "agent"
	deviceName := "laptop"

	mockRepo.On("GetSyncDevices", ctx, "user").Return([]db.SyncDevice{
		{
			DeviceID:   "device-1",
			DeviceName: &deviceName,
			UserAgent:  &userAgent,
			LastSeenAt: pgtype.Timestamp{Time: now, Valid: true},
			CreatedAt:  pgtype.Timestamp{Time: now, Valid: true},
			IsRevoked:  false,
		},
	}, nil).Once()

	records, err := svc.ListDevices(ctx, "user")
	require.NoError(t, err)
	assert.Len(t, records, 1)
	assert.Equal(t, "device-1", records[0].DeviceID)
	assert.Equal(t, &deviceName, records[0].DeviceName)
	assert.Equal(t, &userAgent, records[0].UserAgent)
}

func TestService_HeartbeatErrorsFailClosed(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	mockRepo.On("UpsertSyncDevice", ctx, mock.Anything).Return(db.SyncDevice{}, errors.New("heartbeat failed")).Once()
	require.ErrorContains(t, svc.heartbeatDevice(ctx, "user-1", "device-1", "agent-1", "push"), "verify sync device")

	mockRepo.On("IsSyncDeviceRevoked", ctx, "user-1", "device-1").Return(false, errors.New("revocation lookup failed")).Once()
	require.ErrorContains(t, svc.heartbeatPullDevice(ctx, "user-1", "device-1", "agent-1"), "verify sync device revocation")

	mockRepo.AssertExpectations(t)
}

func TestService_AdvisoryWritesFallbackWhenAsyncSaturated(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()
	svc.asyncSlots = make(chan struct{}, 1)
	svc.asyncSlots <- struct{}{}

	mockRepo.On("CreateSyncAuditLog", mock.Anything, mock.Anything).Return(db.SyncAuditLog{}, errors.New("audit failed")).Once()
	svc.recordPullSyncAudit(ctx, "user-1", "device-1", 1, 2, 3, time.Millisecond)

	mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, errors.New("heartbeat failed")).Once()
	svc.recordSyncDeviceHeartbeatAsync(ctx, "user-1", "device-1", "agent-1", "pull")

	mockRepo.AssertExpectations(t)
}

func TestService_DispatchAsyncNilDefaultLauncherAndPanicRecovery(t *testing.T) {
	svc := &Service{}
	require.True(t, svc.dispatchAsync(nil))

	done := make(chan struct{})
	require.True(t, svc.dispatchAsync(func() { close(done) }))
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for default async launcher")
	}

	svc.runAsync = func(fn func()) { fn() }
	require.True(t, svc.dispatchAsync(func() { panic("boom") }))
	require.Empty(t, svc.asyncSlots)
}

func TestDurationMillisecondsInt32Bounds(t *testing.T) {
	require.Equal(t, int32(math.MaxInt32), durationMillisecondsInt32(time.Duration(math.MaxInt64)))
	require.Equal(t, int32(math.MinInt32), durationMillisecondsInt32(time.Duration(math.MinInt64)))
}

func TestServiceHelperBranches(t *testing.T) {
	require.Equal(t, "message_validation_failed", conflictMetricName("message", "validation_failed"))
	require.Equal(t, StrategyClientWins, normalizeResolutionStrategy(StrategyClientWins))

	svc := NewService(nil, nil, nil, nil, nil, nil)
	accepted := DecodeVectorClock(svc.acceptedVectorClock(
		VectorClock{
			"attacker-device":     99,
			"current-device":      1,
			"other-member-device": 999,
		},
		VectorClock{"other-member-device": 4},
		"current-device",
		nil,
	))
	require.Equal(t, int32(2), accepted["current-device"])
	require.Equal(t, int32(4), accepted["other-member-device"])
	require.NotContains(t, accepted, "attacker-device")
}

func TestService_MessageJSONMarshalErrors(t *testing.T) {
	ctx := context.Background()
	svc, mockRepo, _ := newSyncTest()

	bad := map[string]any{"bad": math.Inf(1)}
	require.ErrorContains(t, svc.updateMessage(ctx, mockRepo, "user-1", "device-1", 1, nil, MessageSyncPayload{Sources: bad}), "marshal message sources")
	require.ErrorContains(t, svc.updateMessage(ctx, mockRepo, "user-1", "device-1", 1, nil, MessageSyncPayload{ToolEvents: bad}), "marshal tool events")
	require.ErrorContains(t, svc.updateMessage(ctx, mockRepo, "user-1", "device-1", 1, nil, MessageSyncPayload{AgentStatuses: bad}), "marshal agent statuses")
	require.ErrorContains(t, svc.updateMessage(ctx, mockRepo, "user-1", "device-1", 1, nil, MessageSyncPayload{Trace: bad}), "marshal trace")

	mockRepo.On("GetConversationVersion", ctx, int32(1), mock.Anything).Return(db.GetConversationVersionRow{ID: 1}, nil).Times(4)
	mockRepo.On("GetConversation", ctx, int32(1)).Return(db.Conversation{ID: 1}, nil).Times(4)
	require.ErrorContains(t, svc.createMessage(ctx, mockRepo, "user-1", "device-1", 1, nil, MessageSyncPayload{ConversationID: 1, Sources: bad}), "marshal message sources")
	require.ErrorContains(t, svc.createMessage(ctx, mockRepo, "user-1", "device-1", 1, nil, MessageSyncPayload{ConversationID: 1, ToolEvents: bad}), "marshal tool events")
	require.ErrorContains(t, svc.createMessage(ctx, mockRepo, "user-1", "device-1", 1, nil, MessageSyncPayload{ConversationID: 1, AgentStatuses: bad}), "marshal agent statuses")
	require.ErrorContains(t, svc.createMessage(ctx, mockRepo, "user-1", "device-1", 1, nil, MessageSyncPayload{ConversationID: 1, Trace: bad}), "marshal trace")
	mockRepo.AssertExpectations(t)
}

func TestService_CreateMessageParentValidationErrors(t *testing.T) {
	ctx := context.Background()
	svc, mockRepo, _ := newSyncTest()
	orgID := int32(7)

	mockRepo.On("GetConversationWithOrg", ctx, int32(1), orgID).Return(db.Conversation{}, errors.New("org parent missing")).Once()
	require.ErrorContains(t, svc.createMessage(ctx, mockRepo, "user-1", "device-1", 1, &orgID, MessageSyncPayload{ConversationID: 1}), "get conversation for message create validation")

	mockRepo.On("GetConversationVersion", ctx, int32(2), mock.Anything).Return(db.GetConversationVersionRow{}, errors.New("parent missing")).Once()
	require.ErrorContains(t, svc.createMessage(ctx, mockRepo, "user-1", "device-1", 1, nil, MessageSyncPayload{ConversationID: 2}), "validate conversation for message create")

	mockRepo.AssertExpectations(t)
}

func TestMarshalMessageJSON_NilValues(t *testing.T) {
	data, err := marshalMessageJSON(nil)
	require.NoError(t, err)
	assert.Equal(t, "null", string(data))

	var metadata map[string]any
	data, err = marshalMessageJSON(metadata)
	require.NoError(t, err)
	assert.Equal(t, "null", string(data))

	assert.False(t, isNilJSONValue(1))
}

func BenchmarkMarshalMessageJSON_NilMetadata(b *testing.B) {
	b.ReportAllocs()
	for b.Loop() {
		for range 3 {
			data, err := marshalMessageJSON(nil)
			if err != nil {
				b.Fatal(err)
			}
			if string(data) != "null" {
				b.Fatalf("marshalMessageJSON(nil) = %q, want null", data)
			}
		}
	}
}

func BenchmarkMarshalMessageJSON_MetadataMap(b *testing.B) {
	value := map[string]any{
		"tools": []any{
			map[string]any{"name": "search", "duration_ms": 12, "success": true},
			map[string]any{"name": "fetch", "duration_ms": 7, "success": true},
		},
	}

	b.ReportAllocs()
	for b.Loop() {
		data, err := marshalMessageJSON(value)
		if err != nil {
			b.Fatal(err)
		}
		if len(data) == 0 {
			b.Fatal("empty JSON")
		}
	}
}

func BenchmarkConversationPayloadFromRecord(b *testing.B) {
	result := "result"
	model := "model"
	userID := "user-1"
	deviceID := "device-1"
	conv := &ConversationRecord{
		ID:            123,
		UserID:        &userID,
		UserInput:     "prompt",
		Result:        &result,
		Model:         &model,
		AgentCount:    2,
		SyncVersion:   9,
		VectorClock:   []byte(`{"device-1":9}`),
		DeviceID:      &deviceID,
		Timestamp:     Timestamp{Time: time.Unix(1_700_000_000, 0), Valid: true},
		LastSyncedAt:  Timestamp{Time: time.Unix(1_700_000_001, 0), Valid: true},
		UpdatedAt:     Timestamp{Time: time.Unix(1_700_000_002, 0), Valid: true},
		ExecutionTime: ptrFloat64(1.25),
	}

	b.ReportAllocs()
	for b.Loop() {
		payload := conversationPayloadFromRecord(conv)
		if payload.ID != conv.ID || payload.UserInput != conv.UserInput {
			b.Fatalf("unexpected payload: %#v", payload)
		}
	}
}

func BenchmarkMessagePayloadFromRecord(b *testing.B) {
	deviceID := "device-1"
	msg := &MessageRecord{
		ID:             456,
		MessageID:      "msg-1",
		ConversationID: 123,
		Role:           "assistant",
		Content:        "content",
		CreatedAt:      Timestamp{Time: time.Unix(1_700_000_000, 0), Valid: true},
		Sources:        []byte(`{"source":true}`),
		ToolEvents:     []byte(`{"tool":"search"}`),
		AgentStatuses:  []byte(`{"agent":"done"}`),
		Trace:          []byte(`{"trace":true}`),
		SyncVersion:    10,
		VectorClock:    []byte(`{"device-1":10}`),
		DeviceID:       &deviceID,
		LastSyncedAt:   Timestamp{Time: time.Unix(1_700_000_001, 0), Valid: true},
		UpdatedAt:      Timestamp{Time: time.Unix(1_700_000_002, 0), Valid: true},
	}

	b.ReportAllocs()
	for b.Loop() {
		payload := messagePayloadFromRecord(msg)
		if payload.MessageID != msg.MessageID || payload.Content != msg.Content {
			b.Fatalf("unexpected payload: %#v", payload)
		}
	}
}

func TestService_PullChanges_DefaultLimitAndDeletions(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
	mockRepo.On("GetConversationsAfterVersion", ctx, "user", int32(1), int32(2)).Return([]ConversationRecord{
		{
			ID:          1,
			SyncVersion: 2,
			IsDeleted:   true,
			UpdatedAt:   Timestamp{Time: time.Now(), Valid: true},
		},
		{
			ID:          2,
			SyncVersion: 4,
		},
	}, nil).Once()
	mockRepo.On("GetMessagesAfterVersion", ctx, "user", int32(1), int32(2)).Return([]MessageRecord{
		{
			MessageID:   "msg-1",
			SyncVersion: 3,
			IsDeleted:   true,
			UpdatedAt:   Timestamp{Time: time.Now(), Valid: true},
		},
		{
			MessageID:   "msg-2",
			SyncVersion: 5,
		},
	}, nil).Once()
	mockRepo.On("GetConversationsCount", mock.Anything, "user").Return(int64(2), nil).Once()
	mockRepo.On("GetMessagesCount", mock.Anything, "user").Return(int64(2), nil).Once()
	mockRepo.On("CreateSyncAuditLog", mock.Anything, mock.Anything).Return(db.SyncAuditLog{}, nil).Once()

	resp, err := svc.PullChanges(ctx, "user", "device", "agent", SyncPullRequest{LastSyncVersion: 1, Limit: 1})
	require.NoError(t, err)
	assert.True(t, resp.HasMore)
	assert.Equal(t, int32(2), resp.LatestVersion)
	assert.Len(t, resp.Deletions, 1)
}

func TestService_PullChanges_PreservesTimestampFields(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	convTimestamp := time.Unix(100, 0).UTC()
	convLastSyncedAt := time.Unix(101, 0).UTC()
	convUpdatedAt := time.Unix(102, 0).UTC()
	msgCreatedAt := time.Unix(200, 0).UTC()
	msgLastSyncedAt := time.Unix(201, 0).UTC()
	msgUpdatedAt := time.Unix(202, 0).UTC()

	conversations := []ConversationRecord{
		{
			ID:           1,
			UserInput:    "prompt",
			AgentCount:   1,
			SyncVersion:  1,
			Timestamp:    Timestamp{Time: convTimestamp, Valid: true},
			LastSyncedAt: Timestamp{Time: convLastSyncedAt, Valid: true},
			UpdatedAt:    Timestamp{Time: convUpdatedAt, Valid: true},
		},
	}
	messages := []MessageRecord{
		{
			MessageID:      "m-1",
			ConversationID: 1,
			Role:           "assistant",
			Content:        "done",
			SyncVersion:    2,
			CreatedAt:      Timestamp{Time: msgCreatedAt, Valid: true},
			LastSyncedAt:   Timestamp{Time: msgLastSyncedAt, Valid: true},
			UpdatedAt:      Timestamp{Time: msgUpdatedAt, Valid: true},
		},
	}

	mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
	mockRepo.On("GetConversationsAfterVersion", ctx, "user-1", int32(0), int32(101)).Return(conversations, nil).Once()
	mockRepo.On("GetMessagesAfterVersion", ctx, "user-1", int32(0), int32(101)).Return(messages, nil).Once()
	mockRepo.On("GetConversationsCount", mock.Anything, "user-1").Return(int64(1), nil).Once()
	mockRepo.On("GetMessagesCount", mock.Anything, "user-1").Return(int64(1), nil).Once()
	mockRepo.On("CreateSyncAuditLog", mock.Anything, mock.Anything).Return(db.SyncAuditLog{}, nil).Once()

	result, err := svc.PullChanges(ctx, "user-1", "device-1", "agent-1", SyncPullRequest{LastSyncVersion: 0})
	require.NoError(t, err)
	require.Len(t, result.Conversations, 1)
	require.Len(t, result.Messages, 1)

	assert.True(t, result.Conversations[0].Timestamp.Equal(convTimestamp))
	assert.True(t, result.Conversations[0].LastSyncedAt.Equal(convLastSyncedAt))
	assert.True(t, result.Conversations[0].UpdatedAt.Equal(convUpdatedAt))
	assert.True(t, result.Messages[0].CreatedAt.Equal(msgCreatedAt))
	assert.True(t, result.Messages[0].LastSyncedAt.Equal(msgLastSyncedAt))
	assert.True(t, result.Messages[0].UpdatedAt.Equal(msgUpdatedAt))
	mockRepo.AssertExpectations(t)
}

func TestService_PullChanges_UsesGlobalLimitAcrossEntities(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	conversations := []ConversationRecord{
		{ID: 1, SyncVersion: 1, UpdatedAt: Timestamp{Time: time.Unix(1, 0), Valid: true}},
		{ID: 2, SyncVersion: 4, UpdatedAt: Timestamp{Time: time.Unix(4, 0), Valid: true}},
	}
	messages := []MessageRecord{
		{MessageID: "m-1", SyncVersion: 2, UpdatedAt: Timestamp{Time: time.Unix(2, 0), Valid: true}},
		{MessageID: "m-2", SyncVersion: 3, UpdatedAt: Timestamp{Time: time.Unix(3, 0), Valid: true}},
	}

	mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
	mockRepo.On("GetConversationsAfterVersion", ctx, "user-1", int32(0), int32(3)).Return(conversations, nil).Once()
	mockRepo.On("GetMessagesAfterVersion", ctx, "user-1", int32(0), int32(3)).Return(messages, nil).Once()
	mockRepo.On("GetConversationsCount", mock.Anything, "user-1").Return(int64(2), nil).Once()
	mockRepo.On("GetMessagesCount", mock.Anything, "user-1").Return(int64(2), nil).Once()
	mockRepo.On("CreateSyncAuditLog", mock.Anything, mock.Anything).Return(db.SyncAuditLog{}, nil).Once()

	result, err := svc.PullChanges(ctx, "user-1", "device-1", "agent-1", SyncPullRequest{
		LastSyncVersion: 0,
		Limit:           2,
	})
	require.NoError(t, err)
	assert.True(t, result.HasMore)
	assert.Equal(t, 2, len(result.Conversations)+len(result.Messages))
	assert.Equal(t, int32(2), result.LatestVersion)
	mockRepo.AssertExpectations(t)
}

func TestService_PullChanges_WithOrg(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()
	orgID := int32(2)

	mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
	mockRepo.On("GetConversationsByOrgAfterVersion", ctx, orgID, int32(0), int32(101)).Return([]ConversationRecord{}, nil).Once()
	mockRepo.On("GetMessagesByOrgAfterVersion", ctx, orgID, int32(0), int32(101)).Return([]MessageRecord{}, nil).Once()
	mockRepo.On("CountConversationsByOrg", mock.Anything, orgID).Return(int64(1), nil).Once()
	mockRepo.On("CountMessagesByOrg", mock.Anything, orgID).Return(int64(2), nil).Once()
	mockRepo.On("CreateSyncAuditLog", mock.Anything, mock.Anything).Return(db.SyncAuditLog{}, nil).Once()

	_, err := svc.PullChanges(ctx, "user", "device", "agent", SyncPullRequest{OrganizationID: &orgID})
	assert.NoError(t, err)
}

func TestService_PushChanges_AppliesDeletions(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	userID := "user-1"
	orgID := int32(7)

	mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
	mockRepo.On("GetLatestOrgSyncVersion", ctx, orgID).Return(int32(10), nil).Once()
	mockRepo.On("GetSyncDevices", ctx, userID).Return([]db.SyncDevice{{DeviceID: "device-1"}}, nil).Once()
	mockRepo.On("GetConversationVersionWithOrg", ctx, int32(11), mock.Anything, orgID).Return(db.GetConversationVersionRow{
		ID:          11,
		SyncVersion: 10,
		VectorClock: VectorClock{"device-1": 1}.Encode(),
	}, nil).Once()
	mockRepo.On("GetConversationWithOrg", ctx, int32(11), orgID).Return(db.Conversation{
		ID:             11,
		OrganizationID: &orgID,
		UserInput:      "prompt",
		AgentCount:     1,
	}, nil).Once()
	mockRepo.On("UpdateConversationSync", ctx, mock.MatchedBy(func(params UpdateConversationInput) bool {
		return params.ID == 11 && params.IsDeleted && params.SyncVersion == 11 && params.UserID != nil && *params.UserID == userID
	})).Return(nil).Once()
	mockRepo.On("GetConversationVersionWithOrg", ctx, int32(11), mock.Anything, orgID).Return(db.GetConversationVersionRow{
		ID:          11,
		SyncVersion: 11,
		VectorClock: VectorClock{"device-1": 1}.Encode(),
	}, nil).Once()
	mockRepo.On("GetMessageVersion", ctx, "msg-7").Return(db.GetMessageVersionRow{
		MessageID:   "msg-7",
		SyncVersion: 10,
		VectorClock: VectorClock{"device-1": 1}.Encode(),
	}, nil).Once()
	mockRepo.On("GetMessageByMessageID", ctx, "msg-7").Return(db.Message{
		MessageID: "msg-7",
		Content:   "content",
	}, nil).Once()
	mockRepo.On("UpdateMessageSync", ctx, mock.MatchedBy(func(params UpdateMessageInput) bool {
		return params.MessageID == "msg-7" && params.IsDeleted && params.SyncVersion == 12
	})).Return(nil).Once()
	mockRepo.On("GetMessageVersion", ctx, "msg-7").Return(db.GetMessageVersionRow{
		MessageID:   "msg-7",
		SyncVersion: 12,
		VectorClock: VectorClock{"device-1": 1}.Encode(),
	}, nil).Once()
	mockRepo.On("CreateSyncAuditLog", mock.Anything, mock.Anything).Return(db.SyncAuditLog{}, nil).Once()

	result, err := svc.PushChanges(ctx, userID, "device-1", "agent-1", "", SyncPushRequest{
		OrganizationID: &orgID,
		Deletions: []DeletionRecord{
			{Type: "conversation", ID: "11"},
			{Type: "message", ID: "msg-7"},
		},
	})

	require.NoError(t, err)
	assert.Equal(t, int32(12), result.Version)
	assert.Contains(t, result.Accepted, "deletion:11")
	assert.Contains(t, result.Accepted, "deletion:msg-7")
	mockRepo.AssertExpectations(t)
}

func TestService_PushChanges_BroadcastAndAuditBranches(t *testing.T) {
	ctx := context.Background()
	mockRepo := new(MockSyncRepository)
	mockBroadcaster := new(MockBroadcaster)
	svc := NewService(mockRepo, mockBroadcaster, nil, nil, nil, NewTelemetry())
	orgID := int32(9)

	mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
	mockRepo.On("GetLatestOrgSyncVersion", mock.Anything, orgID).Return(int32(7), nil).Once()
	mockRepo.On("GetSyncDevices", mock.Anything, "user-1").Return([]db.SyncDevice{{DeviceID: "device-1"}}, nil).Once()
	mockBroadcaster.On("BroadcastSyncRequired", mock.Anything, "user-1", &orgID, int32(7)).Return(errors.New("redis down")).Once()
	mockRepo.On("CreateSyncAuditLog", mock.Anything, mock.MatchedBy(func(params SyncAuditInput) bool {
		return params.Action == "PUSH" && params.Success && params.VersionStart == 7 && params.VersionEnd == 7
	})).Return(db.SyncAuditLog{}, errors.New("audit failed")).Once()

	result, err := svc.PushChanges(ctx, "user-1", "device-1", "agent-1", "", SyncPushRequest{OrganizationID: &orgID})
	require.ErrorContains(t, err, "broadcast committed sync push")
	assert.Nil(t, result)
	mockRepo.AssertExpectations(t)
	mockBroadcaster.AssertExpectations(t)
}

func TestService_PushChanges_RejectsTruncatedPayloads(t *testing.T) {
	t.Run("conversation", func(t *testing.T) {
		svc := NewService(new(MockSyncRepository), nil, nil, nil, nil, nil)

		_, err := svc.PushChanges(context.Background(), "user-1", "device-1", "agent-1", "", SyncPushRequest{
			Conversations: []ConversationSyncPayload{
				{
					ID:               42,
					ContentTruncated: true,
				},
			},
		})

		require.ErrorContains(t, err, "partial conversation payload")
	})

	t.Run("message", func(t *testing.T) {
		svc := NewService(new(MockSyncRepository), nil, nil, nil, nil, nil)

		_, err := svc.PushChanges(context.Background(), "user-1", "device-1", "agent-1", "", SyncPushRequest{
			Messages: []MessageSyncPayload{
				{
					MessageID:        "msg-1",
					ContentTruncated: true,
				},
			},
		})

		require.ErrorContains(t, err, "partial message payload")
	})
}

func TestService_PushChanges_FailureAuditBranches(t *testing.T) {
	ctx := context.Background()

	t.Run("transaction failure writes failure audit", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
		mockRepo.On("GetLatestSyncVersion", ctx, "user-1").Return(int32(4), errors.New("version failed")).Once()
		mockRepo.On("CreateSyncAuditLog", mock.Anything, mock.MatchedBy(func(params SyncAuditInput) bool {
			return params.Action == "PUSH" && !params.Success && params.ErrorMessage != nil
		})).Return(db.SyncAuditLog{}, nil).Once()

		_, err := svc.PushChanges(ctx, "user-1", "device-1", "agent-1", "", SyncPushRequest{})
		require.ErrorContains(t, err, "sync push failed")
		mockRepo.AssertExpectations(t)
	})

	t.Run("transaction and audit failure are joined", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
		mockRepo.On("GetLatestSyncVersion", ctx, "user-1").Return(int32(4), errors.New("version failed")).Once()
		mockRepo.On("CreateSyncAuditLog", mock.Anything, mock.Anything).Return(db.SyncAuditLog{}, errors.New("audit failed")).Once()

		_, err := svc.PushChanges(ctx, "user-1", "device-1", "agent-1", "", SyncPushRequest{})
		require.ErrorContains(t, err, "create sync audit log")
		mockRepo.AssertExpectations(t)
	})
}

type noCallbackRepo struct {
	*MockSyncRepository
}

func (r noCallbackRepo) WithTransaction(ctx context.Context, fn func(SyncRepository) error) error {
	return nil
}

func TestService_PushChanges_VersionAllocationAndTransactionResponseErrors(t *testing.T) {
	ctx := context.Background()

	t.Run("version allocation error", func(t *testing.T) {
		svc, mockRepo, _ := newSyncTest()
		mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
		mockRepo.On("GetLatestSyncVersion", ctx, "user-1").Return(int32(1), nil).Once()
		mockRepo.On("GetSyncDevices", ctx, "user-1").Return([]db.SyncDevice{}, nil).Once()
		mockRepo.On("NextSyncVersion", ctx, int32(1)).Return(int32(0), errors.New("sequence unavailable")).Once()
		mockRepo.On("CreateSyncAuditLog", mock.Anything, mock.Anything).Return(db.SyncAuditLog{}, nil).Once()

		localID := "local-1"
		_, err := svc.PushChanges(ctx, "user-1", "device-1", "agent-1", "", SyncPushRequest{
			Conversations: []ConversationSyncPayload{{LocalID: &localID}},
		})

		require.ErrorContains(t, err, "allocate sync version")
		mockRepo.AssertExpectations(t)
	})

	t.Run("transaction returns without response", func(t *testing.T) {
		mockRepo := new(MockSyncRepository)
		repo := noCallbackRepo{MockSyncRepository: mockRepo}
		svc := NewService(repo, nil, nil, nil, nil, nil)
		mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()

		_, err := svc.PushChanges(ctx, "user-1", "device-1", "agent-1", "", SyncPushRequest{})

		require.ErrorContains(t, err, "transaction completed without a response")
		mockRepo.AssertExpectations(t)
	})
}

func TestService_PushChanges_IdempotencyScopedByOrganization(t *testing.T) {
	mockRepo := new(MockSyncRepository)
	mockIdem := new(MockIdempotencyStore)
	svc := NewService(mockRepo, nil, nil, nil, mockIdem, nil)
	ctx := context.Background()

	orgA := int32(7)
	orgB := int32(9)
	userID := "user"
	idempotencyKey := "key"

	// Org A has a cached response.
	mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
	mockIdem.On("GetResult", ctx, userID, "org:7:key").Return(IdempotencyHit{Response: SyncPushResponse{
		Success: true,
		Version: 77,
	}}, nil).Once()

	cached, err := svc.PushChanges(ctx, userID, "device-a", "agent", idempotencyKey, SyncPushRequest{
		OrganizationID: &orgA,
	})
	require.NoError(t, err)
	assert.Equal(t, int32(77), cached.Version)

	// Same user + idempotency key in a different org must not hit Org A cache.
	mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
	mockIdem.On("GetResult", ctx, userID, "org:9:key").Return(IdempotencyMiss{}, nil).Once()
	mockRepo.On("GetLatestOrgSyncVersion", ctx, orgB).Return(int32(9), nil).Once()
	mockRepo.On("GetSyncDevices", ctx, userID).Return([]db.SyncDevice{}, nil).Once()
	mockRepo.On("CreateSyncAuditLog", mock.Anything, mock.Anything).Return(db.SyncAuditLog{}, nil).Once()
	mockIdem.On("SaveResult", ctx, userID, "org:9:key", mock.Anything).Return(nil).Once()

	fresh, err := svc.PushChanges(ctx, userID, "device-b", "agent", idempotencyKey, SyncPushRequest{
		OrganizationID: &orgB,
	})
	require.NoError(t, err)
	assert.Equal(t, int32(9), fresh.Version)

	mockRepo.AssertExpectations(t)
	mockIdem.AssertExpectations(t)
}

func TestService_PushChanges_LockAndIdempotencyErrors(t *testing.T) {
	ctx := context.Background()

	t.Run("lock error", func(t *testing.T) {
		mockRepo := new(MockSyncRepository)
		mockLocker := new(MockLocker)
		svc := NewService(mockRepo, nil, nil, mockLocker, nil, nil)
		mockLocker.On("Lock", ctx, "user-1").Return((func())(nil), errors.New("busy")).Once()

		_, err := svc.PushChanges(ctx, "user-1", "device-1", "agent-1", "", SyncPushRequest{})
		require.ErrorContains(t, err, "concurrency limit")
		mockLocker.AssertExpectations(t)
		mockRepo.AssertNotCalled(t, "UpsertSyncDevice", mock.Anything, mock.Anything)
	})

	t.Run("idempotency load error", func(t *testing.T) {
		mockRepo := new(MockSyncRepository)
		mockIdem := new(MockIdempotencyStore)
		svc := NewService(mockRepo, nil, nil, nil, mockIdem, nil)
		mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
		mockIdem.On("GetResult", ctx, "user-1", "key-1").Return((*SyncPushResponse)(nil), errors.New("redis down")).Once()
		mockRepo.On("GetLatestSyncVersion", ctx, "user-1").Return(int32(0), nil).Once()
		mockRepo.On("GetSyncDevices", ctx, "user-1").Return([]db.SyncDevice{}, nil).Once()
		mockRepo.On("CreateSyncAuditLog", mock.Anything, mock.Anything).Return(db.SyncAuditLog{}, nil).Once()
		mockIdem.On("SaveResult", ctx, "user-1", "key-1", mock.Anything).Return(nil).Once()

		result, err := svc.PushChanges(ctx, "user-1", "device-1", "agent-1", "key-1", SyncPushRequest{})
		require.NoError(t, err)
		require.NotNil(t, result)
		mockRepo.AssertExpectations(t)
		mockIdem.AssertExpectations(t)
	})
}

func TestService_PushChanges_Success_WithIdempotencyAndBroadcast(t *testing.T) {
	mockRepo := new(MockSyncRepository)
	mockIdem := new(MockIdempotencyStore)
	mockBroadcaster := new(MockBroadcaster)
	svc := NewService(mockRepo, mockBroadcaster, nil, nil, mockIdem, nil)
	ctx := context.Background()

	mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
	mockRepo.On("GetLatestSyncVersion", ctx, "user").Return(int32(1), nil).Once()
	mockRepo.On("GetSyncDevices", ctx, "user").Return([]db.SyncDevice{}, nil).Once()
	mockRepo.On("CreateSyncAuditLog", mock.Anything, mock.Anything).Return(db.SyncAuditLog{}, nil).Once()
	mockIdem.On("GetResult", ctx, "user", "key").Return(IdempotencyMiss{}, nil).Once()
	mockIdem.On("SaveResult", ctx, "user", "key", mock.Anything).Return(nil).Once()
	mockBroadcaster.On("BroadcastSyncRequired", ctx, "user", (*int32)(nil), int32(1)).Return(nil).Once()

	_, err := svc.PushChanges(ctx, "user", "device", "agent", "key", SyncPushRequest{})
	assert.NoError(t, err)
}

func TestService_PushChanges_TransactionError(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
	mockRepo.On("GetLatestSyncVersion", ctx, "user").Return(int32(0), errors.New("tx fail")).Once()
	mockRepo.On("CreateSyncAuditLog", mock.Anything, mock.Anything).Return(db.SyncAuditLog{}, nil).Once()

	_, err := svc.PushChanges(ctx, "user", "device", "agent", "", SyncPushRequest{})
	assert.Error(t, err)
}

func TestService_PushChanges_UsesOrgScopedLock(t *testing.T) {
	mockRepo := new(MockSyncRepository)
	mockLocker := new(MockLocker)
	svc := NewService(mockRepo, nil, nil, mockLocker, nil, nil)
	ctx := context.Background()

	userID := "user-1"
	orgID := int32(12)
	releaseCalled := false
	release := func() { releaseCalled = true }

	mockLocker.On("Lock", ctx, "org:12").Return(release, nil).Once()
	mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
	mockRepo.On("GetLatestOrgSyncVersion", ctx, orgID).Return(int32(3), nil).Once()
	mockRepo.On("GetSyncDevices", ctx, userID).Return([]db.SyncDevice{}, nil).Once()
	mockRepo.On("CreateSyncAuditLog", mock.Anything, mock.Anything).Return(db.SyncAuditLog{}, nil).Once()

	result, err := svc.PushChanges(ctx, userID, "device-1", "agent-1", "", SyncPushRequest{
		OrganizationID: &orgID,
	})
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, releaseCalled)
	mockLocker.AssertExpectations(t)
	mockRepo.AssertExpectations(t)
}
