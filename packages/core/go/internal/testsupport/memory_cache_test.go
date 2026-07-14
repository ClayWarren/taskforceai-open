package testsupport

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMemoryCache(t *testing.T) {
	ctx := context.Background()
	cache := &MemoryCache{}

	_, err := cache.Get(ctx, "missing")
	require.EqualError(t, err, "not found")
	require.NoError(t, cache.Set(ctx, "key", "value", time.Minute))
	value, err := cache.Get(ctx, "key")
	require.NoError(t, err)
	assert.Equal(t, "value", value)

	value, err = cache.Take(ctx, "key")
	require.NoError(t, err)
	assert.Equal(t, "value", value)
	_, err = cache.Take(ctx, "missing")
	require.EqualError(t, err, "not found")

	require.NoError(t, cache.Set(ctx, "delete", "value", time.Minute))
	deleted, err := cache.Delete(ctx, "delete")
	require.NoError(t, err)
	assert.True(t, deleted)
	require.NoError(t, cache.Set(ctx, "clear", "value", time.Minute))
	require.NoError(t, cache.Clear(ctx))
	assert.Empty(t, cache.Data)
}
