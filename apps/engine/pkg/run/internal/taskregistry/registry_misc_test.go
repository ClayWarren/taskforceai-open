package taskregistry

import (
	"context"
	"errors"
	"testing"
	"time"

	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestIsUpdateProgressValidationErrorJSONDecodeDetails(t *testing.T) {
	assert.True(t, isUpdateProgressValidationError("invalid budgetUsage json: malformed payload"))
	assert.True(t, isUpdateProgressValidationError("invalid agentStatuses json: malformed payload"))
	assert.True(t, isUpdateProgressValidationError("invalid toolEvents json: malformed payload"))
	assert.False(t, isUpdateProgressValidationError("something else failed"))
}

func TestIsWatchUnavailableError(t *testing.T) {
	assert.True(t, isWatchUnavailableError(errors.New("redis watch operations require REDIS_URL")))
	assert.True(t, isWatchUnavailableError(errors.New("mock does not support watch")))
	assert.False(t, isWatchUnavailableError(errors.New("some other error")))
	assert.False(t, isWatchUnavailableError(nil))
}

func TestMarkStartedWithErrorCompletesWithinTimeout(t *testing.T) {
	redis.SetClient(redis.NewMockClient())
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })
	registry := &TaskRegistry{}
	require.NoError(t, registry.Register("timeout-regression-mse", 1, "prompt", "model", OrchestrateTaskOptions{}))
	done := make(chan struct{}, 1)
	go func() {
		_, _ = registry.MarkStartedWithError("timeout-regression-mse")
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(3 * persistenceTimeout):
		t.Fatal("MarkStartedWithError did not return within its persistence deadline")
	}
}

func TestMarkStartedWithSetNXLockNilRedisClient(t *testing.T) {
	registry, _, cleanup := setupMiniredisRegistry(t)
	defer cleanup()
	require.NoError(t, registry.Register("nil-redis-fallback", 1, "prompt", "model", OrchestrateTaskOptions{}))
	redis.SetClient(nil)
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })
	started, err := registry.markStartedWithSetNXLock(context.Background(), "nil-redis-fallback")
	require.Error(t, err)
	assert.False(t, started)
}

func TestNextProgressVersionMonotonic(t *testing.T) {
	first := nextProgressVersion(time.Unix(0, 0))
	second := nextProgressVersion(time.Unix(0, 0))
	assert.Greater(t, second, first)
}

func TestPersistenceTimeoutDefined(t *testing.T) {
	assert.Positive(t, persistenceTimeout)
	assert.LessOrEqual(t, persistenceTimeout, 60*time.Second)
}

func TestResetForTestRestoresRedisGetters(t *testing.T) {
	taskRegistryRedisClientGetter = func() (redis.Cmdable, error) { return nil, assert.AnError }
	registryRedisClientGetterWithRetry = taskRegistryRedisClientGetter

	ResetForTest()

	assert.NotNil(t, taskRegistryRedisClientGetter)
	assert.NotNil(t, registryRedisClientGetterWithRetry)
}
