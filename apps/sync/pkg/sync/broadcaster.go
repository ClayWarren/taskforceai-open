package sync

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
)

// Broadcaster defines the interface for notifying clients of sync events.
type Broadcaster interface {
	BroadcastSyncRequired(ctx context.Context, userID string, orgID *int32, latestVersion int32) error
}

// RedisStreamBroadcaster implements Broadcaster using Redis Streams for durability.
type RedisStreamBroadcaster struct {
	client redis.Cmdable
}

var getRedisClient = redis.GetClient

func NewRedisStreamBroadcaster() (*RedisStreamBroadcaster, error) {
	client, err := getRedisClient()
	if err != nil {
		return nil, err
	}
	return &RedisStreamBroadcaster{client: client}, nil
}

func (b *RedisStreamBroadcaster) BroadcastSyncRequired(ctx context.Context, userID string, orgID *int32, latestVersion int32) error {
	var streamKey string
	if orgID != nil {
		streamKey = fmt.Sprintf("sync:stream:org:%d", *orgID)
	} else {
		streamKey = fmt.Sprintf("sync:stream:%s", userID)
	}

	// Inject trace context into stream message for distributed tracing
	carrier := propagation.MapCarrier{}
	otel.GetTextMapPropagator().Inject(ctx, carrier)

	values := map[string]any{
		"type":    "sync_required",
		"version": latestVersion,
		"ts":      fmt.Sprintf("%d", time.Now().UnixMilli()),
	}

	// Add trace context if available
	if traceparent := carrier.Get("traceparent"); traceparent != "" {
		values["traceparent"] = traceparent
	}
	if tracestate := carrier.Get("tracestate"); tracestate != "" {
		values["tracestate"] = tracestate
	}

	// Add to stream with automatic trimming to keep last 100 events
	_, err := b.client.XAdd(ctx, streamKey, values)
	if err != nil {
		return fmt.Errorf("failed to add to sync stream: %w", err)
	}

	if _, err := b.client.XTrimMaxLen(ctx, streamKey, 100); err != nil {
		slog.Warn("Failed to trim sync stream — stream may grow unbounded", "userId", userID, "orgId", orgID, "error", err)
	}

	slog.Debug("Broadcasted sync update via stream", "userId", userID, "orgId", orgID, "version", latestVersion)
	return nil
}
