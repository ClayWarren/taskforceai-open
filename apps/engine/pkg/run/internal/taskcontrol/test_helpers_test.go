package taskcontrol

import (
	"context"
	"errors"
	"testing"
	"time"

	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
)

type approvalSetFailRedis struct{ *redis.MockClient }

func (c *approvalSetFailRedis) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if len(key) >= len(approvalDecisionKeyPrefix) && key[:len(approvalDecisionKeyPrefix)] == approvalDecisionKeyPrefix {
		return errors.New("set failed")
	}
	return c.MockClient.Set(ctx, key, value, ttl)
}

type approvalSetFailClient struct{ *redis.MockClient }

func (c *approvalSetFailClient) Set(context.Context, string, []byte, time.Duration) error {
	return errors.New("set failed")
}

type stubApprovalClient struct {
	publishedTo    string
	publishedBytes []byte
	publishErr     error
}

func (c *stubApprovalClient) Publish(_ context.Context, channel string, payload []byte) error {
	c.publishedTo = channel
	c.publishedBytes = payload
	return c.publishErr
}

func setApprovalClientFactoryForTest(t *testing.T, client ApprovalClient) {
	t.Helper()
	original := getApprovalClient
	getApprovalClient = func() (ApprovalClient, error) { return client, nil }
	t.Cleanup(func() { getApprovalClient = original })
}

func setRedisClientGetterForTest(t *testing.T, getter func() (redis.Cmdable, error)) {
	t.Helper()
	original := RedisClientGetter
	RedisClientGetter = getter
	t.Cleanup(func() { RedisClientGetter = original })
}

func restore[T any](t *testing.T, target *T) {
	t.Helper()
	original := *target
	t.Cleanup(func() { *target = original })
}
