package sync

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

type durableMockRepository struct {
	*MockSyncRepository
	results map[string]SyncPushResponse
}

func (r *durableMockRepository) WithTransaction(ctx context.Context, fn func(SyncRepository) error) error {
	return fn(r)
}

func (r *durableMockRepository) GetSyncPushResult(_ context.Context, userID, key string) (SyncPushResponse, error) {
	result, ok := r.results[userID+":"+key]
	if !ok {
		return SyncPushResponse{}, ErrNotFound
	}
	return result, nil
}

func (r *durableMockRepository) SaveSyncPushResult(_ context.Context, userID, key string, response SyncPushResponse) error {
	r.results[userID+":"+key] = response
	return nil
}

func TestPushChanges_DurableResultMakesBroadcastRetrySafe(t *testing.T) {
	ctx := context.Background()
	base := new(MockSyncRepository)
	repo := &durableMockRepository{MockSyncRepository: base, results: map[string]SyncPushResponse{}}
	broadcaster := new(MockBroadcaster)
	service := NewService(repo, broadcaster, nil, nil, nil, nil)
	localID := "local-safe-retry"
	request := SyncPushRequest{Conversations: []ConversationSyncPayload{{
		LocalID: &localID, Timestamp: time.Now(), UserInput: "hello",
	}}}

	base.On("UpsertSyncDevice", mock.Anything, mock.Anything).Return(db.SyncDevice{}, nil).Twice()
	base.On("GetLatestSyncVersion", ctx, "user-1").Return(int32(0), nil).Once()
	base.On("GetSyncDevices", ctx, "user-1").Return([]db.SyncDevice{}, nil).Once()
	base.On("CreateConversationSync", ctx, mock.Anything).Return(db.Conversation{ID: 44}, nil).Once()
	base.On("CreateSyncAuditLog", mock.Anything, mock.Anything).Return(db.SyncAuditLog{}, nil).Twice()
	broadcaster.On("BroadcastSyncRequired", mock.Anything, "user-1", (*int32)(nil), int32(1)).Return(errors.New("redis down")).Once()
	broadcaster.On("BroadcastSyncRequired", mock.Anything, "user-1", (*int32)(nil), int32(1)).Return(nil).Once()

	first, err := service.PushChanges(ctx, "user-1", "device-1", "agent", "request-1", request)
	require.Nil(t, first)
	require.ErrorContains(t, err, "broadcast committed sync push")

	second, err := service.PushChanges(ctx, "user-1", "device-1", "agent", "request-1", request)
	require.NoError(t, err)
	require.Equal(t, int32(44), second.ConversationIDMappings[localID])
	base.AssertNumberOfCalls(t, "CreateConversationSync", 1)
	base.AssertExpectations(t)
	broadcaster.AssertExpectations(t)
}

func TestCompareSyncPayloadUsesMatchingVersionWhenClockIsMissing(t *testing.T) {
	server := VectorClock{"server": 3}
	require.Equal(t, Equal, compareSyncPayload(server, nil, 9, 9))
	require.Equal(t, After, compareSyncPayload(server, nil, 9, 0))
	require.Equal(t, After, compareSyncPayload(nil, nil, 9, 8))
	require.Equal(t, Before, compareSyncPayload(nil, nil, 9, 10))
}

func TestMessagePayloadFromRecordDecodesJSONMetadataForMerge(t *testing.T) {
	payload := messagePayloadFromRecord(&MessageRecord{
		MessageID: "message-1", Sources: []byte(`{"server":{"kept":true}}`),
	})
	resolved, err := NewAutoMergeResolver().ResolveMessage(payload, MessageSyncPayload{
		MessageID: "message-1", Sources: map[string]any{"client": map[string]any{"kept": true}},
	})
	require.NoError(t, err)
	require.Equal(t, map[string]any{
		"server": map[string]any{"kept": true},
		"client": map[string]any{"kept": true},
	}, resolved.Sources)
}

func TestConversationPayloadPreservesProjectID(t *testing.T) {
	projectID := int32(27)
	payload := conversationPayloadFromRecord(&ConversationRecord{ID: 1, ProjectID: &projectID})
	require.Equal(t, &projectID, payload.ProjectID)
}
