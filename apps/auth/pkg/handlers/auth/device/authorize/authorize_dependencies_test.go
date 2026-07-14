package authorize

import (
	"context"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	ratelimit_mocks "github.com/TaskForceAI/auth-service/mocks/pkg/ratelimit"
	authhandler "github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/TaskForceAI/auth-service/pkg/ratelimit"
	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestDefaultDepsUsesRedisClient(t *testing.T) {
	authhandler.SetRedisClient(infraredis.NewMockClient())
	t.Cleanup(func() { authhandler.SetRedisClient(nil) })

	deps := defaultDeps(&db.Queries{})

	assert.NotNil(t, deps.Service)
	assert.NotNil(t, deps.Limiter)
}

func TestCheckRateLimitAllowed(t *testing.T) {
	ip := "1.2.3.4"
	mockRedis := new(ratelimit_mocks.RedisClient)
	mockRedis.On("Incr", mock.Anything, mock.Anything).Return(1, nil)
	mockRedis.On("Set", mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(nil)
	limiter := ratelimit.NewRedisRateLimiter(mockRedis, "")

	err := checkRateLimit(context.Background(), &ip, limiter)

	require.NoError(t, err)
	mockRedis.AssertExpectations(t)
}
