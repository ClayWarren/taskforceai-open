package cache

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewRedisCache(t *testing.T) {
	server := miniredis.RunT(t)

	cache, err := NewRedisCache("redis://"+server.Addr(), "")
	require.NoError(t, err)
	assert.NotNil(t, cache)
	assert.NotNil(t, cache.client)
}

func TestNewRedisCacheUsesTokenPassword(t *testing.T) {
	server := miniredis.RunT(t)
	server.RequireAuth("secret-token")

	cache, err := NewRedisCache("redis://"+server.Addr(), "secret-token")
	require.NoError(t, err)

	err = cache.Set(context.Background(), "k", "v", time.Minute)
	require.NoError(t, err)
	value, err := cache.Get(context.Background(), "k")
	require.NoError(t, err)
	assert.Equal(t, "v", value)
}

func TestNewRedisCacheReturnsErrorOnInvalidURL(t *testing.T) {
	cache, err := NewRedisCache("://bad-url", "")
	assert.Nil(t, cache)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to parse redis url")
}

func TestNewRedisCacheRequiresExplicitCredentials(t *testing.T) {
	cache, err := NewRedisCache(" ", "token")
	assert.Nil(t, cache)
	require.Error(t, err)
	assert.Equal(t, "MISSING_CREDENTIALS", err.Error())
}

func TestNewRedisCacheWithClient(t *testing.T) {
	mockClient := &MockRedisCacheClient{}
	cache := NewRedisCacheWithClient(mockClient)
	assert.NotNil(t, cache)
	assert.Equal(t, mockClient, cache.client)
}

type MockRedisCacheClient struct {
	getValue    string
	getFound    *bool
	getErr      error
	getDelValue string
	getDelFound *bool
	getDelErr   error
	setErr      error
	delErr      error
	delOK       *bool
}

//go:fix inline

func (m *MockRedisCacheClient) Get(ctx context.Context, key string) (string, bool, error) {
	if m.getErr != nil {
		return "", false, m.getErr
	}

	found := true
	if m.getFound != nil {
		found = *m.getFound
	}
	if !found {
		return "", false, nil
	}
	return m.getValue, true, nil
}

func (m *MockRedisCacheClient) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	return m.setErr
}

func (m *MockRedisCacheClient) Del(ctx context.Context, key string) (bool, error) {
	if m.delErr != nil {
		return false, m.delErr
	}
	if m.delOK != nil {
		return *m.delOK, nil
	}
	return true, nil
}

func (m *MockRedisCacheClient) GetDel(ctx context.Context, key string) (string, bool, error) {
	if m.getDelErr != nil {
		return "", false, m.getDelErr
	}

	found := true
	if m.getDelFound != nil {
		found = *m.getDelFound
	}
	if !found {
		return "", false, nil
	}
	return m.getDelValue, true, nil
}

func TestRedisCache_Get(t *testing.T) {
	ctx := context.Background()

	t.Run("success", func(t *testing.T) {
		mockClient := &MockRedisCacheClient{getValue: "test-value"}
		cache := NewRedisCacheWithClient(mockClient)

		val, err := cache.Get(ctx, "key")
		require.NoError(t, err)
		assert.Equal(t, "test-value", val)
	})

	t.Run("error", func(t *testing.T) {
		mockClient := &MockRedisCacheClient{getErr: errors.New("redis error")}
		cache := NewRedisCacheWithClient(mockClient)

		_, err := cache.Get(ctx, "key")
		assert.Error(t, err)
	})

	t.Run("not found", func(t *testing.T) {
		mockClient := &MockRedisCacheClient{getFound: new(false)}
		cache := NewRedisCacheWithClient(mockClient)

		val, err := cache.Get(ctx, "key")
		require.Error(t, err)
		require.ErrorIs(t, err, ErrNotFound)
		assert.Contains(t, err.Error(), "not found")
		assert.Empty(t, val)
	})

	t.Run("empty value still found", func(t *testing.T) {
		mockClient := &MockRedisCacheClient{getValue: "", getFound: new(true)}
		cache := NewRedisCacheWithClient(mockClient)

		val, err := cache.Get(ctx, "key")
		require.NoError(t, err)
		assert.Empty(t, val)
	})
}

func TestRedisCache_Set(t *testing.T) {
	ctx := context.Background()

	t.Run("success", func(t *testing.T) {
		mockClient := &MockRedisCacheClient{}
		cache := NewRedisCacheWithClient(mockClient)

		err := cache.Set(ctx, "key", "value", time.Minute)
		assert.NoError(t, err)
	})

	t.Run("error", func(t *testing.T) {
		mockClient := &MockRedisCacheClient{setErr: errors.New("redis error")}
		cache := NewRedisCacheWithClient(mockClient)

		err := cache.Set(ctx, "key", "value", time.Minute)
		assert.Error(t, err)
	})
}

func TestRedisCache_Delete(t *testing.T) {
	ctx := context.Background()

	t.Run("success", func(t *testing.T) {
		mockClient := &MockRedisCacheClient{}
		cache := NewRedisCacheWithClient(mockClient)

		deleted, err := cache.Delete(ctx, "key")
		require.NoError(t, err)
		assert.True(t, deleted)
	})

	t.Run("error", func(t *testing.T) {
		mockClient := &MockRedisCacheClient{delErr: errors.New("redis error")}
		cache := NewRedisCacheWithClient(mockClient)

		_, err := cache.Delete(ctx, "key")
		assert.Error(t, err)
	})
}

func TestRedisCache_Take(t *testing.T) {
	ctx := context.Background()

	t.Run("success", func(t *testing.T) {
		mockClient := &MockRedisCacheClient{getDelValue: "test-value"}
		cache := NewRedisCacheWithClient(mockClient)

		val, err := cache.Take(ctx, "key")
		require.NoError(t, err)
		assert.Equal(t, "test-value", val)
	})

	t.Run("empty value still found", func(t *testing.T) {
		mockClient := &MockRedisCacheClient{getDelValue: "", getDelFound: new(true)}
		cache := NewRedisCacheWithClient(mockClient)

		val, err := cache.Take(ctx, "key")
		require.NoError(t, err)
		assert.Empty(t, val)
	})

	t.Run("getdel error", func(t *testing.T) {
		mockClient := &MockRedisCacheClient{getDelErr: errors.New("redis error")}
		cache := NewRedisCacheWithClient(mockClient)

		_, err := cache.Take(ctx, "key")
		assert.Error(t, err)
	})

	t.Run("not found", func(t *testing.T) {
		mockClient := &MockRedisCacheClient{getDelFound: new(false)}
		cache := NewRedisCacheWithClient(mockClient)

		_, err := cache.Take(ctx, "key")
		require.Error(t, err)
		require.ErrorIs(t, err, ErrNotFound)
		assert.Contains(t, err.Error(), "not found")
	})
}

func TestRedisCache_SetSubSecondTTLUsesExpiry(t *testing.T) {
	server := miniredis.RunT(t)
	cache, err := NewRedisCache("redis://"+server.Addr(), "")
	require.NoError(t, err)

	err = cache.Set(context.Background(), "k", "v", 500*time.Millisecond)
	require.NoError(t, err)
	value, err := server.Get("k")
	require.NoError(t, err)
	assert.Equal(t, "v", value)
	ttl := server.TTL("k")
	assert.Positive(t, ttl)
	assert.LessOrEqual(t, ttl, time.Second)
}

func TestRedisCache_SetWithoutTTLUsesPlainSet(t *testing.T) {
	server := miniredis.RunT(t)
	cache, err := NewRedisCache("redis://"+server.Addr(), "")
	require.NoError(t, err)

	err = cache.Set(context.Background(), "k", "v", 0)
	require.NoError(t, err)
	value, err := server.Get("k")
	require.NoError(t, err)
	assert.Equal(t, "v", value)
	assert.Equal(t, time.Duration(0), server.TTL("k"))
}

func TestRedisClientWrapper_SetStoresBytes(t *testing.T) {
	server := miniredis.RunT(t)
	client := goredis.NewClient(&goredis.Options{Addr: server.Addr()})
	t.Cleanup(func() {
		require.NoError(t, client.Close())
	})
	wrapper := redisClientWrapper{client: client}

	err := wrapper.Set(context.Background(), "bytes", []byte("value"), time.Minute)

	require.NoError(t, err)
	value, err := server.Get("bytes")
	require.NoError(t, err)
	assert.Equal(t, "value", value)
	assert.Positive(t, server.TTL("bytes"))
}

func TestRedisCache_GetRedisResponses(t *testing.T) {
	server := miniredis.RunT(t)
	server.Set("k", "v")
	cache, err := NewRedisCache("redis://"+server.Addr(), "")
	require.NoError(t, err)

	value, err := cache.Get(context.Background(), "k")
	require.NoError(t, err)
	assert.Equal(t, "v", value)

	missing, err := cache.Get(context.Background(), "missing")
	require.Error(t, err)
	require.ErrorIs(t, err, ErrNotFound)
	assert.Contains(t, err.Error(), "not found")
	assert.Empty(t, missing)
}

func TestRedisClientWrapper_ReturnsTransportErrors(t *testing.T) {
	server := miniredis.RunT(t)
	addr := server.Addr()
	server.Close()

	client := goredis.NewClient(&goredis.Options{
		Addr:       addr,
		MaxRetries: -1,
	})
	t.Cleanup(func() {
		require.NoError(t, client.Close())
	})
	wrapper := redisClientWrapper{client: client}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	t.Cleanup(cancel)

	value, found, err := wrapper.Get(ctx, "k")
	require.Error(t, err)
	assert.Empty(t, value)
	assert.False(t, found)

	value, found, err = wrapper.GetDel(ctx, "k")
	require.Error(t, err)
	assert.Empty(t, value)
	assert.False(t, found)
}

func TestRedisCache_DeleteRedisResponses(t *testing.T) {
	server := miniredis.RunT(t)
	server.Set("k", "v")
	cache, err := NewRedisCache("redis://"+server.Addr(), "")
	require.NoError(t, err)

	deleted, err := cache.Delete(context.Background(), "k")
	require.NoError(t, err)
	assert.True(t, deleted)

	deleted, err = cache.Delete(context.Background(), "missing")
	require.NoError(t, err)
	assert.False(t, deleted)
}

func TestRedisCache_TakeUsesAtomicGetDel(t *testing.T) {
	server := miniredis.RunT(t)
	server.Set("k", "v")
	cache, err := NewRedisCache("redis://"+server.Addr(), "")
	require.NoError(t, err)

	val, err := cache.Take(context.Background(), "k")
	require.NoError(t, err)
	assert.Equal(t, "v", val)
	assert.False(t, server.Exists("k"))

	value, err := cache.Take(context.Background(), "missing")
	require.Error(t, err)
	require.ErrorIs(t, err, ErrNotFound)
	assert.Contains(t, err.Error(), "not found")
	assert.Empty(t, value)
}

func TestRedisCache_Clear(t *testing.T) {
	ctx := context.Background()

	t.Run("returns error - not supported", func(t *testing.T) {
		mockClient := &MockRedisCacheClient{}
		cache := NewRedisCacheWithClient(mockClient)

		err := cache.Clear(ctx)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "not supported")
	})
}
