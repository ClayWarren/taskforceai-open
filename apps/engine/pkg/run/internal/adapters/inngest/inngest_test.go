package inngestadapter

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/inngest/inngestgo"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type inngestSenderFake struct {
	id     string
	err    error
	events []any
}

func (f *inngestSenderFake) Send(ctx context.Context, event any) (string, error) {
	f.events = append(f.events, event)
	return f.id, f.err
}

func TestNewInngestClient_NoEnv(t *testing.T) {
	original := os.Getenv("INNGEST_EVENT_KEY")
	t.Setenv("INNGEST_EVENT_KEY", "")
	t.Setenv("INNGEST_DEV", "")
	_ = original

	client := NewClient(nil)
	err := client.SendEvent(context.Background(), "test.event", map[string]any{"ok": true})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "INNGEST_EVENT_KEY not set")
}

func TestInngestClient_SendEvent_WithClient(t *testing.T) {
	fake := &inngestSenderFake{id: "id"}
	client := &Client{}
	client.SetInner(fake)

	err := client.SendEvent(context.Background(), "task.execute", map[string]any{"taskId": "task-1"})
	require.NoError(t, err)
	if assert.Len(t, fake.events, 1) {
		event, ok := fake.events[0].(inngestgo.GenericEvent[map[string]any])
		assert.True(t, ok)
		assert.Equal(t, "task.execute", event.Name)
		assert.Equal(t, "task-1", event.Data["taskId"])
	}
}

func TestNewInngestClient_WithKey(t *testing.T) {
	t.Setenv("INNGEST_EVENT_KEY", "test-key")
	t.Setenv("INNGEST_DEV", "")
	mockClient := &inngestSenderFake{id: "id"}
	client := NewClient(func(opts inngestgo.ClientOpts) (Sender, error) {
		assert.Equal(t, "taskforceai-engine", opts.AppID)
		assert.NotNil(t, opts.EventKey)
		assert.Equal(t, "test-key", *opts.EventKey)
		assert.NotNil(t, opts.Dev)
		assert.False(t, *opts.Dev)
		return mockClient, nil
	})

	err := client.SendEvent(context.Background(), "ping", map[string]any{"ok": true})
	require.NoError(t, err)
}

func TestNewInngestClient_DevModeWithoutEventKey(t *testing.T) {
	t.Setenv("INNGEST_EVENT_KEY", "")
	t.Setenv("INNGEST_DEV", "1")
	mockClient := &inngestSenderFake{id: "id"}
	client := NewClient(func(opts inngestgo.ClientOpts) (Sender, error) {
		assert.Equal(t, "taskforceai-engine", opts.AppID)
		assert.Nil(t, opts.EventKey)
		assert.NotNil(t, opts.Dev)
		assert.True(t, *opts.Dev)
		return mockClient, nil
	})

	err := client.SendEvent(context.Background(), "ping", map[string]any{"ok": true})
	require.NoError(t, err)
}

func TestNewInngestClient_FactoryError(t *testing.T) {
	t.Setenv("INNGEST_EVENT_KEY", "test-key")
	client := NewClient(func(inngestgo.ClientOpts) (Sender, error) {
		return nil, errors.New("factory failed")
	})

	_, err := client.Send(context.Background(), "event")
	require.ErrorContains(t, err, "INNGEST_EVENT_KEY not set")
}

func TestNewSDKClientConfiguration(t *testing.T) {
	t.Run("not configured", func(t *testing.T) {
		t.Setenv("INNGEST_EVENT_KEY", "")
		t.Setenv("INNGEST_DEV", "")
		client, err := NewSDKClient()
		assert.Nil(t, client)
		require.ErrorIs(t, err, ErrNotConfigured)
	})

	t.Run("configured", func(t *testing.T) {
		t.Setenv("INNGEST_EVENT_KEY", "test-key")
		t.Setenv("INNGEST_DEV", "")
		client, err := NewSDKClient()
		require.NoError(t, err)
		assert.NotNil(t, client)
	})
}

func TestInngestClient_Send_NoInner(t *testing.T) {
	client := &Client{}

	id, err := client.Send(context.Background(), map[string]any{"ok": true})
	require.Error(t, err)
	assert.Empty(t, id)
	assert.Contains(t, err.Error(), "INNGEST_EVENT_KEY not set")
}

func TestInngestClient_Send_WithInner(t *testing.T) {
	fake := &inngestSenderFake{id: "evt-1"}
	client := &Client{}
	client.SetInner(fake)

	id, err := client.Send(context.Background(), "event")
	require.NoError(t, err)
	assert.Equal(t, "evt-1", id)
	assert.Equal(t, []any{"event"}, fake.events)
}

func TestInngestClient_Send_PropagatesInnerError(t *testing.T) {
	fake := &inngestSenderFake{err: assert.AnError}
	client := &Client{}
	client.SetInner(fake)

	id, err := client.Send(context.Background(), "event")
	require.Error(t, err)
	assert.Empty(t, id)
	require.ErrorIs(t, err, assert.AnError)
	assert.Equal(t, []any{"event"}, fake.events)
}
