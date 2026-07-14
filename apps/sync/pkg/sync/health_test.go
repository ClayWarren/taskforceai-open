package sync

import (
	"context"
	"errors"
	"testing"

	mocks "github.com/TaskForceAI/infrastructure/redis/mocks/pkg"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestGetHealthReport_DegradedWithoutDeps(t *testing.T) {
	report, err := GetHealthReport(context.Background())
	require.NoError(t, err)
	assert.NotNil(t, report)
	assert.NotEmpty(t, report.GoVersion)
	assert.NotEmpty(t, report.Uptime)
	assert.NotEmpty(t, report.Database.Status)
	assert.NotEmpty(t, report.Redis.Status)
}

func TestGetHealthReport_DBErrorRedisConnected(t *testing.T) {
	originalDBPool := getHealthDBPool
	originalRedisClient := getHealthRedisClient
	t.Cleanup(func() {
		getHealthDBPool = originalDBPool
		getHealthRedisClient = originalRedisClient
	})

	getHealthDBPool = func(context.Context) (*pgxpool.Pool, error) {
		return nil, errors.New("db down")
	}

	client := new(mocks.Cmdable)
	client.On("Get", mock.Anything, "health_ping").Return("", errors.New("key not found")).Once()
	getHealthRedisClient = func() (redis.Cmdable, error) {
		return client, nil
	}

	report, err := GetHealthReport(context.Background())
	require.NoError(t, err)
	assert.Equal(t, "degraded", report.Status)
	assert.Equal(t, "error", report.Database.Status)
	assert.Equal(t, "connected", report.Redis.Status)
	client.AssertExpectations(t)
}

func TestGetHealthReport_ReportsConnectionCount(t *testing.T) {
	originalDBPool := getHealthDBPool
	originalDBStat := getHealthDBStat
	originalDBConnectionCnt := getHealthDBConnectionCnt
	originalRedisClient := getHealthRedisClient
	t.Cleanup(func() {
		getHealthDBPool = originalDBPool
		getHealthDBStat = originalDBStat
		getHealthDBConnectionCnt = originalDBConnectionCnt
		getHealthRedisClient = originalRedisClient
	})

	getHealthDBPool = func(context.Context) (*pgxpool.Pool, error) {
		return &pgxpool.Pool{}, nil
	}
	getHealthDBStat = func(*pgxpool.Pool) *pgxpool.Stat {
		return nil
	}
	getHealthDBConnectionCnt = func(*pgxpool.Stat) int32 {
		return 3
	}

	client := new(mocks.Cmdable)
	client.On("Get", mock.Anything, "health_ping").Return("", errors.New("key not found")).Once()
	getHealthRedisClient = func() (redis.Cmdable, error) {
		return client, nil
	}

	report, err := GetHealthReport(context.Background())

	require.NoError(t, err)
	assert.Equal(t, int32(3), report.Database.Connections)
	assert.Equal(t, "connected", report.Database.Status)
	client.AssertExpectations(t)
}

func TestGetHealthReport_RedisPingFailureDegrades(t *testing.T) {
	originalDBPool := getHealthDBPool
	originalRedisClient := getHealthRedisClient
	t.Cleanup(func() {
		getHealthDBPool = originalDBPool
		getHealthRedisClient = originalRedisClient
	})

	getHealthDBPool = func(context.Context) (*pgxpool.Pool, error) {
		return nil, nil
	}

	client := new(mocks.Cmdable)
	client.On("Get", mock.Anything, "health_ping").Return("", errors.New("connection refused")).Once()
	getHealthRedisClient = func() (redis.Cmdable, error) {
		return client, nil
	}

	report, err := GetHealthReport(context.Background())
	require.NoError(t, err)
	assert.Equal(t, "degraded", report.Status)
	assert.Equal(t, "connected", report.Database.Status)
	assert.Equal(t, "disconnected", report.Redis.Status)
	client.AssertExpectations(t)
}
