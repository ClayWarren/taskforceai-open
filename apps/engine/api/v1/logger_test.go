package stream

import (
	"errors"
	"testing"

	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/stretchr/testify/require"
)

func TestNewStreamRedisClient(t *testing.T) {
	original := getRedisClientForStream
	t.Cleanup(func() { getRedisClientForStream = original })

	expected := infraredis.NewMockClient()
	getRedisClientForStream = func() (infraredis.Cmdable, error) {
		return expected, nil
	}

	client, err := newStreamRedisClient()
	require.NoError(t, err)
	require.Same(t, expected, client)

	getRedisClientForStream = func() (infraredis.Cmdable, error) {
		return nil, errors.New("redis unavailable")
	}

	client, err = newStreamRedisClient()
	require.Nil(t, client)
	require.ErrorContains(t, err, "redis unavailable")
}
