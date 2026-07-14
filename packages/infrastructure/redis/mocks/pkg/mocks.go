package mocks

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/mock"
)

type testingT interface {
	mock.TestingT
	Cleanup(func())
}

func typedResult[T any](args mock.Arguments) (T, error) {
	var zero T
	if v := args.Get(0); v != nil {
		if typed, ok := v.(T); ok {
			return typed, args.Error(1)
		}
	}
	return zero, args.Error(1)
}

type Cmdable struct{ mock.Mock }

func NewCmdable(t testingT) *Cmdable {
	m := &Cmdable{}
	t.Cleanup(func() { m.AssertExpectations(t) })
	return m
}

func (m *Cmdable) SupportsEval() bool {
	args := m.Called()
	return args.Bool(0)
}

func (m *Cmdable) Get(ctx context.Context, key string) (string, error) {
	args := m.Called(ctx, key)
	return args.String(0), args.Error(1)
}

func (m *Cmdable) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	return m.Called(ctx, key, value, ttl).Error(0)
}

func (m *Cmdable) SetNX(ctx context.Context, key string, value []byte, ttl time.Duration) (bool, error) {
	args := m.Called(ctx, key, value, ttl)
	return args.Bool(0), args.Error(1)
}

func (m *Cmdable) Expire(ctx context.Context, key string, ttl time.Duration) (bool, error) {
	args := m.Called(ctx, key, ttl)
	return args.Bool(0), args.Error(1)
}

func (m *Cmdable) TTL(ctx context.Context, key string) (time.Duration, error) {
	args := m.Called(ctx, key)
	if v := args.Get(0); v != nil {
		if ttl, ok := v.(time.Duration); ok {
			return ttl, args.Error(1)
		}
	}
	return 0, args.Error(1)
}

func (m *Cmdable) Incr(ctx context.Context, key string) (int, error) {
	args := m.Called(ctx, key)
	return args.Int(0), args.Error(1)
}

func (m *Cmdable) IncrWithExpire(ctx context.Context, key string, ttl time.Duration) (int, error) {
	args := m.Called(ctx, key, ttl)
	return args.Int(0), args.Error(1)
}

func (m *Cmdable) CheckRateLimit(ctx context.Context, key string, limit int, window time.Duration) (bool, int, time.Time, error) {
	args := m.Called(ctx, key, limit, window)
	var resetAt time.Time
	if v := args.Get(2); v != nil {
		if typed, ok := v.(time.Time); ok {
			resetAt = typed
		}
	}
	return args.Bool(0), args.Int(1), resetAt, args.Error(3)
}

func (m *Cmdable) Del(ctx context.Context, key string) (bool, error) {
	args := m.Called(ctx, key)
	return args.Bool(0), args.Error(1)
}

func (m *Cmdable) XAdd(ctx context.Context, stream string, values map[string]any) (string, error) {
	args := m.Called(ctx, stream, values)
	return args.String(0), args.Error(1)
}

func (m *Cmdable) XRead(ctx context.Context, stream string, lastID string, count int64) ([]redis.XMessage, error) {
	return typedResult[[]redis.XMessage](m.Called(ctx, stream, lastID, count))
}

func (m *Cmdable) XTrimMaxLen(ctx context.Context, stream string, maxLen int64) (int64, error) {
	args := m.Called(ctx, stream, maxLen)
	if v := args.Get(0); v != nil {
		if n, ok := v.(int64); ok {
			return n, args.Error(1)
		}
	}
	return 0, args.Error(1)
}

func (m *Cmdable) Watch(ctx context.Context, fn func(*redis.Tx) error, keys ...string) error {
	callArgs := make([]any, 0, 2+len(keys))
	callArgs = append(callArgs, ctx, fn)
	for _, key := range keys {
		callArgs = append(callArgs, key)
	}
	return m.Called(callArgs...).Error(0)
}

func (m *Cmdable) Eval(ctx context.Context, script string, keys []string, args ...any) *redis.Cmd {
	callArgs := append([]any{ctx, script, keys}, args...)
	ret := m.Called(callArgs...)
	if v := ret.Get(0); v != nil {
		if cmd, ok := v.(*redis.Cmd); ok {
			return cmd
		}
	}
	return redis.NewCmd(ctx)
}

func (m *Cmdable) RunScript(ctx context.Context, script *redis.Script, keys []string, args ...any) *redis.Cmd {
	callArgs := append([]any{ctx, script, keys}, args...)
	ret := m.Called(callArgs...)
	if v := ret.Get(0); v != nil {
		if cmd, ok := v.(*redis.Cmd); ok {
			return cmd
		}
	}
	return redis.NewCmd(ctx)
}
