package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	redis_mocks "github.com/TaskForceAI/infrastructure/redis/mocks/pkg"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

func TestDatabaseStartupCheck_ErrorWithoutDB(t *testing.T) {
	err := databaseStartupCheck(context.Background())
	assert.Error(t, err)
}

func TestRedisStartupCheck_UnavailableClient(t *testing.T) {
	err := redisStartupCheck(context.Background())
	assert.Error(t, err)
}

func TestRedisStartupCheck_Success(t *testing.T) {
	mockRedis := new(redis_mocks.Cmdable)
	mockRedis.On("Get", mock.Anything, "auth:start:health").Return("", redis.ErrKeyNotFound)

	redis.SetClient(mockRedis)
	t.Cleanup(func() { redis.SetClient(nil) })

	err := redisStartupCheck(context.Background())
	assert.NoError(t, err)
}

func TestRedisStartupCheck_PingError(t *testing.T) {
	mockRedis := new(redis_mocks.Cmdable)
	mockRedis.On("Get", mock.Anything, "auth:start:health").Return("", errors.New("connection reset"))

	redis.SetClient(mockRedis)
	t.Cleanup(func() { redis.SetClient(nil) })

	err := redisStartupCheck(context.Background())
	assert.Error(t, err)
}

func TestBuildSecureRouter_NotNil(t *testing.T) {
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")
	router, humaAPI := buildSecureRouter()
	assert.NotNil(t, router)
	assert.NotNil(t, humaAPI)
}

func TestBuildSecureRouter_InvalidSecretReturnsMisconfiguration(t *testing.T) {
	t.Setenv("AUTH_SECRET", "short")
	router, humaAPI := buildSecureRouter()
	assert.NotNil(t, router)
	assert.NotNil(t, humaAPI)

	req := httptest.NewRequest(http.MethodGet, "/api/auth/ping", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusInternalServerError, rec.Code)
}
