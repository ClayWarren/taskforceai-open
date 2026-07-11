package sync

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

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
