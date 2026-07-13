package sync

import (
	"errors"
	"math"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestService_PushChanges_OrgMessageUpdatePreservesOtherMemberVectorClock(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	userID := "member-b"
	orgID := int32(7)
	mockRepo.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Once()
	mockRepo.On("GetLatestOrgSyncVersion", ctx, orgID).Return(int32(10), nil).Once()
	mockRepo.On("GetSyncDevices", ctx, userID).Return([]db.SyncDevice{{DeviceID: "member-b-device"}}, nil).Once()
	mockRepo.On("GetMessageVersion", ctx, "msg-org-1").Return(db.GetMessageVersionRow{
		MessageID:   "msg-org-1",
		SyncVersion: 10,
		VectorClock: VectorClock{"member-a-device": 4, "member-b-device": 1}.Encode(),
	}, nil).Once()
	mockRepo.On("UpdateMessageSync", ctx, mock.MatchedBy(func(params UpdateMessageInput) bool {
		vc := DecodeVectorClock(params.VectorClock)
		return params.MessageID == "msg-org-1" &&
			params.OrganizationID != nil &&
			*params.OrganizationID == orgID &&
			vc["member-a-device"] == 4 &&
			vc["member-b-device"] == 2 &&
			vc["attacker-device"] == 0
	})).Return(nil).Once()
	mockRepo.On("CreateSyncAuditLog", mock.Anything, mock.Anything).Return(db.SyncAuditLog{}, nil).Once()

	result, err := svc.PushChanges(ctx, userID, "member-b-device", "agent-1", "", SyncPushRequest{
		OrganizationID: &orgID,
		Messages: []MessageSyncPayload{{
			MessageID:      "msg-org-1",
			ConversationID: 42,
			Role:           "assistant",
			Content:        "member B edit",
			VectorClock: VectorClock{
				"attacker-device": 99,
				"member-a-device": 999,
				"member-b-device": 1,
			}.Encode(),
		}},
	})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, int32(11), result.Version)
	assert.Contains(t, result.Accepted, "message:msg-org-1")
	mockRepo.AssertNotCalled(t, "CreateMessageSync", mock.Anything, mock.Anything)
	mockRepo.AssertExpectations(t)
}

func TestService_RevokeDevice(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	mockRepo.On("RevokeSyncDevice", ctx, "user", "device-1").Return(nil).Once()

	err := svc.RevokeDevice(ctx, "user", "device-1")
	assert.NoError(t, err)
}

func TestService_applyDeletions_ConversationDeleteAdvancesVectorClock(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	owner := "user-1"
	mockRepo.On("GetConversationVersion", ctx, int32(11), mock.Anything).Return(db.GetConversationVersionRow{
		ID:          11,
		SyncVersion: 10,
		VectorClock: VectorClock{"device-1": 1}.Encode(),
	}, nil).Once()
	mockRepo.On("GetConversation", ctx, int32(11)).Return(db.Conversation{
		ID:         11,
		UserID:     &owner,
		UserInput:  "prompt",
		AgentCount: 1,
	}, nil).Once()
	mockRepo.On("UpdateConversationSync", ctx, mock.MatchedBy(func(params UpdateConversationInput) bool {
		vc := DecodeVectorClock(params.VectorClock)
		return params.ID == 11 &&
			params.IsDeleted &&
			params.SyncVersion == 11 &&
			vc["device-1"] == 1 &&
			vc["device-2"] == 1
	})).Return(nil).Once()
	mockRepo.On("GetConversationVersion", ctx, int32(11), mock.Anything).Return(db.GetConversationVersionRow{
		ID:          11,
		SyncVersion: 11,
		VectorClock: VectorClock{"device-1": 1, "device-2": 1}.Encode(),
	}, nil).Once()

	version, accepted, err := svc.applyDeletions(
		ctx,
		mockRepo,
		owner,
		"device-2",
		nil,
		10,
		[]DeletionRecord{{Type: "conversation", ID: "11"}},
	)
	require.NoError(t, err)
	assert.Equal(t, int32(11), version)
	assert.Equal(t, []string{"deletion:11"}, accepted)
	mockRepo.AssertExpectations(t)
}

func TestService_applyDeletions_ConversationUpdateNoOp(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	owner := "user-1"
	mockRepo.On("GetConversationVersion", ctx, int32(11), mock.Anything).Return(db.GetConversationVersionRow{
		ID:          11,
		SyncVersion: 10,
		VectorClock: VectorClock{"device-1": 1}.Encode(),
	}, nil).Once()
	mockRepo.On("GetConversation", ctx, int32(11)).Return(db.Conversation{
		ID:         11,
		UserID:     &owner,
		UserInput:  "prompt",
		AgentCount: 1,
	}, nil).Once()
	mockRepo.On("UpdateConversationSync", ctx, mock.MatchedBy(func(params UpdateConversationInput) bool {
		return params.ID == 11 && params.IsDeleted && params.SyncVersion == 11 && params.UserID != nil && *params.UserID == owner
	})).Return(nil).Once()
	// Simulate a sqlc :exec no-op (rows affected = 0): sync_version did not advance.
	mockRepo.On("GetConversationVersion", ctx, int32(11), mock.Anything).Return(db.GetConversationVersionRow{
		ID:          11,
		SyncVersion: 10,
		VectorClock: VectorClock{"device-1": 1}.Encode(),
	}, nil).Once()

	_, _, err := svc.applyDeletions(
		ctx,
		mockRepo,
		owner,
		"device-1",
		nil,
		10,
		[]DeletionRecord{{Type: "conversation", ID: "11"}},
	)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no-op")
	mockRepo.AssertExpectations(t)
}

func TestService_applyDeletions_MessageAlreadyDeleted_IsNoOp(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	userID := "user-1"
	mockRepo.On("GetMessageVersion", ctx, "msg-1").Return(db.GetMessageVersionRow{
		MessageID:   "msg-1",
		SyncVersion: 4,
		VectorClock: VectorClock{"device-1": 1}.Encode(),
	}, nil).Once()
	mockRepo.On("GetMessageByMessageID", ctx, "msg-1").Return(db.Message{
		MessageID: "msg-1",
		IsDeleted: true,
	}, nil).Once()

	version, accepted, err := svc.applyDeletions(
		ctx,
		mockRepo,
		userID,
		"device-2",
		nil,
		4,
		[]DeletionRecord{{Type: "message", ID: "msg-1"}},
	)
	require.NoError(t, err)
	assert.Equal(t, int32(4), version)
	assert.Equal(t, []string{"deletion:msg-1"}, accepted)
	mockRepo.AssertNotCalled(t, "UpdateMessageSync", mock.Anything, mock.Anything)
	mockRepo.AssertExpectations(t)
}

func TestService_applyDeletions_MessageUpdateNoOp(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	userID := "user-1"
	mockRepo.On("GetMessageVersion", ctx, "msg-1").Return(db.GetMessageVersionRow{
		MessageID:   "msg-1",
		SyncVersion: 4,
		VectorClock: VectorClock{"device-1": 1}.Encode(),
	}, nil).Once()
	mockRepo.On("GetMessageByMessageID", ctx, "msg-1").Return(db.Message{
		MessageID: "msg-1",
		Content:   "payload",
	}, nil).Once()
	mockRepo.On("UpdateMessageSync", ctx, mock.MatchedBy(func(params UpdateMessageInput) bool {
		return params.MessageID == "msg-1" && params.IsDeleted && params.SyncVersion == 5 && params.UserID != nil && *params.UserID == userID
	})).Return(nil).Once()
	// Simulate a sqlc :exec no-op (rows affected = 0): sync_version did not advance.
	mockRepo.On("GetMessageVersion", ctx, "msg-1").Return(db.GetMessageVersionRow{
		MessageID:   "msg-1",
		SyncVersion: 4,
		VectorClock: VectorClock{"device-1": 1}.Encode(),
	}, nil).Once()

	_, _, err := svc.applyDeletions(
		ctx,
		mockRepo,
		userID,
		"device-1",
		nil,
		4,
		[]DeletionRecord{{Type: "message", ID: "msg-1"}},
	)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no-op")
	mockRepo.AssertExpectations(t)
}

func TestService_applyPatch(t *testing.T) {
	svc := NewService(nil, nil, nil, nil, nil, nil)
	obj := map[string]any{"name": "old"}
	patch := []byte(`[{"op":"replace","path":"/name","value":"new"}]`)

	out, err := svc.applyPatch(obj, patch)
	require.NoError(t, err)
	assert.Contains(t, string(out), "new")
}

func TestService_applyPatchErrors(t *testing.T) {
	svc := NewService(nil, nil, nil, nil, nil, nil)

	_, err := svc.applyPatch(map[string]any{"bad": math.Inf(1)}, []byte(`[]`))
	require.Error(t, err)
	_, err = svc.applyPatch(map[string]any{"name": "old"}, []byte(`not-json`))
	require.Error(t, err)
	_, err = svc.applyPatch(map[string]any{"name": "old"}, []byte(`[{"op":"remove","path":"/missing"}]`))
	require.Error(t, err)
}

func TestService_calculateStateHash(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	mockRepo.On("GetConversationsCount", mock.Anything, "user").Return(int64(2), nil).Once()
	mockRepo.On("GetMessagesCount", mock.Anything, "user").Return(int64(3), nil).Once()

	hash, err := svc.calculateStateHash(ctx, "user", nil)
	require.NoError(t, err)
	assert.Equal(t, "2:3", hash)
}

func TestService_createMessage_MarshalError(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	incoming := MessageSyncPayload{
		MessageID:  "msg-1",
		ToolEvents: func() {},
	}
	mockRepo.On("GetConversationVersion", ctx, int32(0), mock.Anything).Return(db.GetConversationVersionRow{
		ID:          0,
		SyncVersion: 0,
		VectorClock: VectorClock{}.Encode(),
	}, nil).Once()
	mockRepo.On("GetConversation", ctx, int32(0)).Return(db.Conversation{ID: 0}, nil).Once()

	err := svc.createMessage(ctx, mockRepo, "user-1", "device", 1, nil, incoming)
	assert.Error(t, err)
}

func TestService_fetchChanges_Error(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()

	mockRepo.On("GetConversationsAfterVersion", ctx, "user", int32(0), int32(101)).Return(nil, errors.New("fail")).Once()
	mockRepo.On("GetMessagesAfterVersion", ctx, "user", int32(0), int32(101)).Return([]MessageRecord{}, nil).Once()

	_, _, err := svc.fetchChanges(ctx, "user", SyncPullRequest{LastSyncVersion: 0})
	assert.Error(t, err)
}

func TestService_fetchChanges_Org(t *testing.T) {
	svc, mockRepo, ctx := newSyncTest()
	orgID := int32(1)

	mockRepo.On("GetConversationsByOrgAfterVersion", ctx, orgID, int32(0), int32(101)).Return([]ConversationRecord{}, nil).Once()
	mockRepo.On("GetMessagesByOrgAfterVersion", ctx, orgID, int32(0), int32(101)).Return([]MessageRecord{}, nil).Once()

	_, _, err := svc.fetchChanges(ctx, "user", SyncPullRequest{LastSyncVersion: 0, OrganizationID: &orgID})
	require.NoError(t, err)
	mockRepo.AssertExpectations(t)
}
