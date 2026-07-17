package team

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInMemoryBusPublishAndSubscribe(t *testing.T) {
	bus := NewInMemoryBus()
	ctx := context.Background()
	require.NoError(t, bus.Publish(ctx, "missing", map[string]any{"value": 1}))

	calls := 0
	require.NoError(t, bus.Subscribe(ctx, "event", func(_ context.Context, props map[string]any) error {
		calls++
		assert.Equal(t, 1, props["value"])
		return nil
	}))
	require.NoError(t, bus.Subscribe(ctx, "event", func(context.Context, map[string]any) error {
		calls++
		return errors.New("handler failed")
	}))

	require.NoError(t, bus.Publish(ctx, "event", "invalid"))
	assert.Zero(t, calls)
	require.NoError(t, bus.Publish(ctx, "event", map[string]any{"value": 1}))
	assert.Equal(t, 2, calls)
}

func TestInMemoryBusLimitsHandlers(t *testing.T) {
	bus := NewInMemoryBus()
	for range MaxHandlersPerEvent {
		require.NoError(t, bus.Subscribe(context.Background(), "event", func(context.Context, map[string]any) error { return nil }))
	}

	err := bus.Subscribe(context.Background(), "event", func(context.Context, map[string]any) error { return nil })
	require.Error(t, err)
	assert.Contains(t, err.Error(), "maximum number of handlers")
}
