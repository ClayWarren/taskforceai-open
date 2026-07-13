package sync

import (
	"context"
	"errors"
	"testing"

	mocks "github.com/TaskForceAI/infrastructure/redis/mocks/pkg"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

func TestRedisStreamBroadcaster_Broadcast(t *testing.T) {
	client := new(mocks.Cmdable)
	b := &RedisStreamBroadcaster{client: client}

	client.On("XAdd", mock.Anything, "sync:stream:user1", mock.MatchedBy(func(v map[string]any) bool {
		// version is int32 in logic but int literal in test
		// we check value equality loosely or cast
		val, ok := v["version"].(int32)
		return ok && val == 5 && v["type"] == "sync_required"
	})).Return("1-0", nil)

	client.On("XTrimMaxLen", mock.Anything, "sync:stream:user1", int64(100)).Return(int64(0), nil)

	err := b.BroadcastSyncRequired(context.Background(), "user1", nil, 5)
	require.NoError(t, err)
	client.AssertExpectations(t)
}

func TestRedisStreamBroadcaster_BroadcastOrgScopedTrimWarning(t *testing.T) {
	client := new(mocks.Cmdable)
	b := &RedisStreamBroadcaster{client: client}
	orgID := int32(7)

	client.On("XAdd", mock.Anything, "sync:stream:org:7", mock.MatchedBy(func(v map[string]any) bool {
		val, ok := v["version"].(int32)
		return ok && val == 5 && v["type"] == "sync_required"
	})).Return("1-0", nil)
	client.On("XTrimMaxLen", mock.Anything, "sync:stream:org:7", int64(100)).Return(int64(0), errors.New("trim failed"))

	err := b.BroadcastSyncRequired(context.Background(), "user1", &orgID, 5)
	require.NoError(t, err)
	client.AssertExpectations(t)
}

func TestRedisStreamBroadcaster_BroadcastInjectsTraceContext(t *testing.T) {
	previousPropagator := otel.GetTextMapPropagator()
	otel.SetTextMapPropagator(propagation.TraceContext{})
	t.Cleanup(func() {
		otel.SetTextMapPropagator(previousPropagator)
	})

	traceState, err := trace.ParseTraceState("vendor=value")
	require.NoError(t, err)
	spanContext := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    trace.TraceID{0x4b, 0xf9, 0x2f, 0x35, 0x77, 0xb3, 0x4d, 0xa6, 0xa3, 0xce, 0x92, 0x9d, 0x0e, 0x0e, 0x47, 0x36},
		SpanID:     trace.SpanID{0x00, 0xf0, 0x67, 0xaa, 0x0b, 0xa9, 0x02, 0xb7},
		TraceFlags: trace.FlagsSampled,
		TraceState: traceState,
	})
	ctx := trace.ContextWithSpanContext(context.Background(), spanContext)

	client := new(mocks.Cmdable)
	b := &RedisStreamBroadcaster{client: client}

	client.On("XAdd", mock.Anything, "sync:stream:user1", mock.MatchedBy(func(v map[string]any) bool {
		return v["traceparent"] == "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" &&
			v["tracestate"] == "vendor=value"
	})).Return("1-0", nil)
	client.On("XTrimMaxLen", mock.Anything, "sync:stream:user1", int64(100)).Return(int64(0), nil)

	err = b.BroadcastSyncRequired(ctx, "user1", nil, 5)

	require.NoError(t, err)
	client.AssertExpectations(t)
}

func TestRedisStreamBroadcaster_BroadcastError(t *testing.T) {
	client := new(mocks.Cmdable)
	b := &RedisStreamBroadcaster{client: client}

	client.On("XAdd", mock.Anything, mock.Anything, mock.Anything).Return("", errors.New("xadd failed"))

	err := b.BroadcastSyncRequired(context.Background(), "user1", nil, 5)
	require.Error(t, err)
	client.AssertExpectations(t)
}

func TestNewRedisStreamBroadcaster_Success(t *testing.T) {
	original := getRedisClient
	mockClient := new(mocks.Cmdable)
	getRedisClient = func() (redis.Cmdable, error) {
		return mockClient, nil
	}
	t.Cleanup(func() { getRedisClient = original })

	b, err := NewRedisStreamBroadcaster()
	require.NoError(t, err)
	assert.NotNil(t, b)
}

func TestNewRedisStreamBroadcaster_Error(t *testing.T) {
	original := getRedisClient
	getRedisClient = func() (redis.Cmdable, error) {
		return nil, errors.New("redis down")
	}
	t.Cleanup(func() { getRedisClient = original })

	b, err := NewRedisStreamBroadcaster()
	require.Error(t, err)
	assert.Nil(t, b)
}
