package sync

import (
	"context"
	"errors"
	"testing"
	"time"

	mocks "github.com/TaskForceAI/infrastructure/redis/mocks/pkg"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestRedisIdempotencyStore_GetResult(t *testing.T) {
	// Case 1: Empty key
	client := new(mocks.Cmdable)
	store := &RedisIdempotencyStore{client: client}
	res, err := store.GetResult(context.Background(), "user", "")
	require.NoError(t, err)
	assert.IsType(t, IdempotencyMiss{}, res)

	// Case 1b: Missing Redis key
	client = new(mocks.Cmdable)
	client.On("Get", mock.Anything, "idempotency:sync:user:key").Return("", redis.ErrKeyNotFound)
	store = &RedisIdempotencyStore{client: client}
	res, err = store.GetResult(context.Background(), "user", "key")
	require.NoError(t, err)
	assert.IsType(t, IdempotencyMiss{}, res)

	// Case 2: Redis Error
	client = new(mocks.Cmdable)
	client.On("Get", mock.Anything, "idempotency:sync:user:key").Return("", errors.New("miss"))
	store = &RedisIdempotencyStore{client: client}
	res, err = store.GetResult(context.Background(), "user", "key")
	require.ErrorContains(t, err, "get idempotency result")
	assert.Nil(t, res)

	// Case 3: Invalid JSON
	client = new(mocks.Cmdable)
	client.On("Get", mock.Anything, "idempotency:sync:user:key").Return("{invalid", nil)
	store = &RedisIdempotencyStore{client: client}
	res, err = store.GetResult(context.Background(), "user", "key")
	require.ErrorContains(t, err, "decode idempotency result")
	assert.Nil(t, res)

	// Case 4: Success
	client = new(mocks.Cmdable)
	client.On("Get", mock.Anything, "idempotency:sync:user:key").Return(`{"success":true,"version":2}`, nil)
	store = &RedisIdempotencyStore{client: client}
	res, err = store.GetResult(context.Background(), "user", "key")
	require.NoError(t, err)
	hit, ok := res.(IdempotencyHit)
	require.True(t, ok)
	assert.True(t, hit.Response.Success)
}

func TestRedisIdempotencyStore_SaveResult(t *testing.T) {
	IdempotencyMiss{}.idempotencyLookup()
	IdempotencyHit{}.idempotencyLookup()

	// Case 1: Empty key
	client := new(mocks.Cmdable)
	store := &RedisIdempotencyStore{client: client}
	err := store.SaveResult(context.Background(), "user", "", SyncPushResponse{Success: true})
	require.NoError(t, err)
	client.AssertNotCalled(t, "Set")

	// Case 2: Success
	client = new(mocks.Cmdable)
	store = &RedisIdempotencyStore{client: client}

	// Expect Set with correct key and TTL
	client.On("Set", mock.Anything, "idempotency:sync:user:key", mock.Anything, 24*time.Hour).Return(nil)

	err = store.SaveResult(context.Background(), "user", "key", SyncPushResponse{Success: true, Version: 3})
	require.NoError(t, err)
	client.AssertExpectations(t)
}

func TestRedisIdempotencyStore_SaveResultEncodingError(t *testing.T) {
	original := marshalSyncPushResponse
	marshalSyncPushResponse = func(any) ([]byte, error) {
		return nil, errors.New("encode failed")
	}
	t.Cleanup(func() { marshalSyncPushResponse = original })

	store := &RedisIdempotencyStore{client: new(mocks.Cmdable)}
	err := store.SaveResult(context.Background(), "user", "key", SyncPushResponse{Success: true})
	require.ErrorContains(t, err, "encode idempotency result")
}

func TestNewRedisIdempotencyStore_Success(t *testing.T) {
	original := getRedisClient
	mockClient := new(mocks.Cmdable)
	getRedisClient = func() (redis.Cmdable, error) {
		return mockClient, nil
	}
	t.Cleanup(func() { getRedisClient = original })

	store, err := NewRedisIdempotencyStore()
	require.NoError(t, err)
	assert.NotNil(t, store)
}

func TestNewRedisIdempotencyStore_Error(t *testing.T) {
	original := getRedisClient
	getRedisClient = func() (redis.Cmdable, error) {
		return nil, errors.New("redis down")
	}
	t.Cleanup(func() { getRedisClient = original })

	store, err := NewRedisIdempotencyStore()
	require.Error(t, err)
	assert.Nil(t, store)
}
