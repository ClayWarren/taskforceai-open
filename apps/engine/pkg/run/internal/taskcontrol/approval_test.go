package taskcontrol

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	miniredis "github.com/alicebob/miniredis/v2"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetApprovalClient_ReturnsClientWithRedisURL(t *testing.T) {
	mr, err := miniredis.Run()
	require.NoError(t, err)
	defer mr.Close()

	t.Setenv("REDIS_URL", "redis://"+mr.Addr())
	t.Cleanup(func() { _ = os.Unsetenv("REDIS_URL") })
	original := getApprovalClient
	t.Cleanup(func() { getApprovalClient = original })

	// GetPubSubClient is sync.Once-cached; an earlier test may have primed it
	// without REDIS_URL set. Reset so this test sees the env var, and restore
	// the mock client afterward for the rest of the package.
	redis.ResetClient()
	t.Cleanup(func() {
		redis.ResetClient()
		redis.SetClient(redis.NewMockClient())
	})

	client, err := getApprovalClient()
	require.NoError(t, err)
	require.NotNil(t, client)
	if redisClient, ok := client.(redisApprovalClient); ok {
		t.Cleanup(func() {
			require.NoError(t, redisClient.client.Close())
		})
	}
}

func TestGetApprovalClient_ReturnsError(t *testing.T) {
	original := getApprovalClient
	getApprovalClient = func() (ApprovalClient, error) {
		return nil, errors.New("pubsub unavailable")
	}
	t.Cleanup(func() { getApprovalClient = original })

	_, err := getApprovalClient()
	require.Error(t, err)
}

func TestDefaultApprovalClientDelegatesToFactory(t *testing.T) {
	original := getApprovalClient
	t.Cleanup(func() { getApprovalClient = original })
	want := errors.New("factory failed")
	getApprovalClient = func() (ApprovalClient, error) { return nil, want }

	client, err := DefaultApprovalClient()
	assert.Nil(t, client)
	require.ErrorIs(t, err, want)
}

func TestDefaultGetApprovalClientReturnsErrorWithoutRedisURL(t *testing.T) {
	redis.ResetClient()
	t.Cleanup(func() {
		redis.ResetClient()
		redis.SetClient(redis.NewMockClient())
	})
	t.Setenv("REDIS_URL", "")
	t.Setenv("REDIS_KV_URL", "")

	_, err := getApprovalClient()
	require.Error(t, err)
}

func TestMarshalApprovalDecisionPayloadRoundTrip(t *testing.T) {
	payload, err := marshalApprovalDecisionPayload(ApprovalDecision{
		Approved: true,
		Result:   map[string]any{"ok": true},
	})
	require.NoError(t, err)

	var decision ApprovalDecision
	require.NoError(t, json.Unmarshal(payload, &decision))
	assert.True(t, decision.Approved)
}

func TestMarshalApprovalDecisionPayloadTooLarge(t *testing.T) {
	oversized := strings.Repeat("x", MaxApprovalDecisionPayloadBytes)
	for _, key := range []string{"blob", "value"} {
		t.Run(key, func(t *testing.T) {
			_, err := marshalApprovalDecisionPayload(ApprovalDecision{
				Approved: true,
				Result:   map[string]any{key: oversized},
			})
			require.Error(t, err)
			require.ErrorIs(t, err, ErrApprovalDecisionPayloadTooLarge)
			assert.Contains(t, err.Error(), fmt.Sprintf("max=%d", MaxApprovalDecisionPayloadBytes))
		})
	}
}

func TestMarshalApprovalDecisionPayloadMarshalError(t *testing.T) {
	_, err := marshalApprovalDecisionPayload(ApprovalDecision{
		Result: map[string]any{"bad": func() {}},
	})
	require.ErrorContains(t, err, "marshal approval decision")
}

func TestPersistApprovalDecisionStoresPayload(t *testing.T) {
	restore(t, &RedisClientGetter)

	mockRedis := redis.NewMockClient()
	RedisClientGetter = func() (redis.Cmdable, error) {
		return mockRedis, nil
	}
	ctx := context.Background()
	taskID := "task-approval-store"

	require.NoError(t, persistApprovalDecision(ctx, taskID, ApprovalDecision{Approved: true}, RedisClientGetter))
	raw, err := mockRedis.Get(ctx, approvalDecisionKey(taskID))
	require.NoError(t, err)
	var decision ApprovalDecision
	require.NoError(t, json.Unmarshal([]byte(raw), &decision))
	assert.True(t, decision.Approved)
}

func TestPersistApprovalDecisionRedisUnavailable(t *testing.T) {
	restore(t, &RedisClientGetter)

	RedisClientGetter = func() (redis.Cmdable, error) {
		return nil, errors.New("redis offline")
	}

	err := persistApprovalDecision(context.Background(), "task-persist-fail", ApprovalDecision{Approved: true}, RedisClientGetter)
	require.Error(t, err)
}

func TestPersistApprovalDecisionNilRedisClient(t *testing.T) {
	restore(t, &RedisClientGetter)

	RedisClientGetter = func() (redis.Cmdable, error) {
		return nil, nil
	}

	err := persistApprovalDecision(context.Background(), "task-persist-nil", ApprovalDecision{Approved: true}, RedisClientGetter)
	require.ErrorContains(t, err, "redis unavailable")
}

func TestPersistApprovalDecisionMarshalError(t *testing.T) {
	restore(t, &RedisClientGetter)

	RedisClientGetter = func() (redis.Cmdable, error) {
		return redis.NewMockClient(), nil
	}

	err := persistApprovalDecision(context.Background(), "task-persist-marshal", ApprovalDecision{
		Result: map[string]any{"bad": func() {}},
	}, RedisClientGetter)
	require.ErrorContains(t, err, "marshal approval decision")
}

func TestPersistApprovalDecisionSetFailure(t *testing.T) {
	restore(t, &RedisClientGetter)

	mockRedis := &approvalSetFailRedis{MockClient: redis.NewMockClient()}
	RedisClientGetter = func() (redis.Cmdable, error) { return mockRedis, nil }

	err := persistApprovalDecision(context.Background(), "task-set-fail", ApprovalDecision{Approved: true}, RedisClientGetter)
	require.Error(t, err)
}

func TestRedisApprovalClient_PublishPropagatesRedisError(t *testing.T) {
	client := goredis.NewClient(&goredis.Options{
		Addr:         "127.0.0.1:0",
		DialTimeout:  20 * time.Millisecond,
		ReadTimeout:  20 * time.Millisecond,
		WriteTimeout: 20 * time.Millisecond,
	})
	t.Cleanup(func() {
		_ = client.Close()
	})

	err := redisApprovalClient{client: client}.Publish(context.Background(), "task:approval:test", []byte(`{"approved":true}`))
	require.Error(t, err)
}
