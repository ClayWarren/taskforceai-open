package webhooks

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type deadLetterStoreStub struct {
	setErr error
	setKey string
	setVal []byte
}

func (s *deadLetterStoreStub) SetNX(ctx context.Context, key string, value []byte, ttl time.Duration) (bool, error) {
	return true, nil
}

func (s *deadLetterStoreStub) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	s.setKey = key
	s.setVal = value
	return s.setErr
}

func (s *deadLetterStoreStub) Del(ctx context.Context, key string) (bool, error) {
	return true, nil
}

func TestRecordDeadLetter_NilStore(t *testing.T) {
	h := &WorkOSWebhookHandlerStruct{}
	h.recordDeadLetter(context.Background(), "evt_1", "user.created", errors.New("boom"), "failed")
}

func TestRecordDeadLetter_StoresPayload(t *testing.T) {
	store := &deadLetterStoreStub{}
	h := &WorkOSWebhookHandlerStruct{ReplayStore: store}
	h.recordDeadLetter(context.Background(), "evt_2", "user.created", errors.New("boom"), "failed")

	assert.Contains(t, store.setKey, "evt_2")
	var payload map[string]any
	require.NoError(t, json.Unmarshal(store.setVal, &payload))
	assert.Equal(t, "evt_2", payload["event_id"])
}

func TestRecordDeadLetter_SetError(t *testing.T) {
	store := &deadLetterStoreStub{setErr: errors.New("redis down")}
	h := &WorkOSWebhookHandlerStruct{ReplayStore: store}
	h.recordDeadLetter(context.Background(), "evt_3", "user.created", errors.New("boom"), "failed")
}
