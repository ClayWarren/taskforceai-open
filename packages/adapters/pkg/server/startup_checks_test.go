package server

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRedisCheck(t *testing.T) {
	t.Run("client lookup error", func(t *testing.T) {
		expectedErr := errors.New("redis unavailable")
		check := RedisCheck(func() (startupRedisStub, error) {
			return startupRedisStub{}, expectedErr
		}, "service:start:health")

		assert.ErrorIs(t, check(context.Background()), expectedErr)
	})

	t.Run("nil client", func(t *testing.T) {
		check := RedisCheck(func() (*startupRedisStub, error) {
			return nil, nil
		}, "service:start:health")

		err := check(context.Background())
		require.Error(t, err)
		assert.Contains(t, err.Error(), "redis client unavailable")
	})

	t.Run("missing key is healthy", func(t *testing.T) {
		check := RedisCheck(func() (startupRedisStub, error) {
			return startupRedisStub{getErr: errors.New("key not found")}, nil
		}, "service:start:health")

		assert.NoError(t, check(context.Background()))
	})

	t.Run("string missing key is healthy", func(t *testing.T) {
		check := RedisCheck(func() (startupRedisStub, error) {
			return startupRedisStub{getErr: errors.New("key not found")}, nil
		}, "service:start:health")

		assert.NoError(t, check(context.Background()))
	})

	t.Run("ping error", func(t *testing.T) {
		expectedErr := errors.New("connection refused")
		check := RedisCheck(func() (startupRedisStub, error) {
			return startupRedisStub{getErr: expectedErr}, nil
		}, "service:start:health")

		assert.ErrorIs(t, check(context.Background()), expectedErr)
	})
}

func TestIsNilRedisHealthClient(t *testing.T) {
	// Untyped nil interface.
	assert.True(t, isNilRedisHealthClient(nil))
	// Typed nil pointer travels the reflect path.
	assert.True(t, isNilRedisHealthClient((*startupRedisStub)(nil)))
	// Non-nil value is not nil.
	assert.False(t, isNilRedisHealthClient(startupRedisStub{}))
}

type startupRedisStub struct {
	getErr error
}

func (s startupRedisStub) Get(context.Context, string) (string, error) {
	return "", s.getErr
}
