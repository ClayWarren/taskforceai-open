package mocks

import (
	"context"
	"time"

	"github.com/stretchr/testify/mock"
)

type RedisClient struct{ mock.Mock }

func (m *RedisClient) Incr(ctx context.Context, key string) (int, error) {
	args := m.Called(ctx, key)
	return args.Int(0), args.Error(1)
}

func (m *RedisClient) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	return m.Called(ctx, key, value, ttl).Error(0)
}

func (m *RedisClient) CheckRateLimit(ctx context.Context, key string, limit int, window time.Duration) (bool, int, time.Time, error) {
	count, err := m.Incr(ctx, key)
	if err != nil {
		return false, 0, time.Time{}, err
	}
	if count == 1 {
		if err := m.Set(ctx, key, []byte("1"), window+time.Second); err != nil {
			return false, 0, time.Time{}, err
		}
	}
	remaining := limit - count
	if remaining < 0 {
		remaining = 0
	}
	return count <= limit, remaining, time.Now().Add(window), nil
}
