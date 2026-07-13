package transports

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/TaskForceAI/logger/pkg"
	"github.com/alicebob/miniredis/v2"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestRedisTransport(t testing.TB) (*RedisTransport, *miniredis.Miniredis) {
	t.Helper()

	server := miniredis.RunT(t)
	transport, err := NewRedisTransport("redis://"+server.Addr(), "")
	require.NoError(t, err)
	return transport, server
}

func TestNewRedisTransport_RequiresConfig(t *testing.T) {
	_, err := NewRedisTransport("", "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "redis url is required")
}

func TestNewRedisTransport_SetsDefaults(t *testing.T) {
	transport, err := NewRedisTransport("redis://localhost:6379", "")
	require.NoError(t, err)
	assert.Equal(t, "redis", transport.Name())
	assert.Equal(t, defaultRedisLogKey, transport.key)
	assert.Equal(t, defaultRedisLogTimeout, transport.timeout)
	assert.Equal(t, defaultRedisMaxEntries, transport.maxEntries)
	require.NotNil(t, transport.client)
	require.NoError(t, transport.Flush())
}

func TestNewRedisTransport_UsesCustomKey(t *testing.T) {
	transport, err := NewRedisTransport("redis://localhost:6379", " custom:logs ")
	require.NoError(t, err)
	assert.Equal(t, "custom:logs", transport.key)
}

func TestNewRedisTransport_InvalidURL(t *testing.T) {
	_, err := NewRedisTransport("://bad", "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to parse redis url")
}

func TestRedisTransport_LogSuccess(t *testing.T) {
	transport, server := newTestRedisTransport(t)
	entry := pkg.LogEntry{
		Level:     pkg.LevelInfo,
		Message:   "redis transport test",
		Timestamp: time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC),
	}

	err := transport.Log(entry)
	require.NoError(t, err)
	require.NoError(t, transport.Flush())

	entries, err := server.List(defaultRedisLogKey)
	require.NoError(t, err)
	require.Len(t, entries, 1)
	assert.Contains(t, entries[0], `"message":"redis transport test"`)
	assert.Contains(t, entries[0], `"level":"info"`)

	var decoded pkg.LogEntry
	require.NoError(t, json.Unmarshal([]byte(entries[0]), &decoded))
	assert.Equal(t, entry.Message, decoded.Message)
	assert.Equal(t, entry.Level, decoded.Level)
}

func TestRedisTransport_TrimsMaxEntries(t *testing.T) {
	transport, server := newTestRedisTransport(t)
	transport.maxEntries = 2

	for i := range 3 {
		require.NoError(t, transport.Log(pkg.LogEntry{
			Level:     pkg.LevelInfo,
			Message:   "entry",
			Timestamp: time.Date(2026, time.January, 1, 0, 0, 0, i, time.UTC),
		}))
	}
	require.NoError(t, transport.Flush())

	entries, err := server.List(defaultRedisLogKey)
	require.NoError(t, err)
	assert.Len(t, entries, 2)
}

func TestRedisTransport_LogWithoutTrimWhenMaxEntriesDisabled(t *testing.T) {
	transport, server := newTestRedisTransport(t)
	transport.maxEntries = 0

	for i := range 3 {
		require.NoError(t, transport.Log(pkg.LogEntry{
			Level:     pkg.LevelInfo,
			Message:   "entry",
			Timestamp: time.Date(2026, time.January, 1, 0, 0, 0, i, time.UTC),
		}))
	}
	require.NoError(t, transport.Flush())

	entries, err := server.List(defaultRedisLogKey)
	require.NoError(t, err)
	assert.Len(t, entries, 3)
}

func TestRedisTransport_LogFailure(t *testing.T) {
	server := miniredis.RunT(t)
	redisClient := goredis.NewClient(&goredis.Options{Addr: server.Addr()})
	require.NoError(t, redisClient.Close())
	transport := &RedisTransport{
		client:     redisClient,
		key:        defaultRedisLogKey,
		timeout:    50 * time.Millisecond,
		maxEntries: defaultRedisMaxEntries,
	}

	err := transport.Log(pkg.LogEntry{
		Level:     pkg.LevelError,
		Message:   "redis transport failure",
		Timestamp: time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC),
	})

	require.Error(t, err)
}

func TestRedisTransport_LogMarshalFailure(t *testing.T) {
	transport, _ := newTestRedisTransport(t)

	err := transport.Log(pkg.LogEntry{
		Level:    pkg.LevelInfo,
		Message:  "marshal failure",
		Metadata: map[string]any{"invalid": func() {}},
	})

	require.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported type")
}

func TestRedisTransport_UsesDefaultTimeout(t *testing.T) {
	transport, _ := newTestRedisTransport(t)
	transport.timeout = 0

	err := transport.Log(pkg.LogEntry{
		Level:     pkg.LevelInfo,
		Message:   "default timeout",
		Timestamp: time.Now(),
	})

	assert.NoError(t, err)
}

func TestRedisTransport_ClosedContextFailure(t *testing.T) {
	transport, _ := newTestRedisTransport(t)
	cmd := transport.client.RPush(context.Background(), defaultRedisLogKey, "warmup")
	require.NoError(t, cmd.Err())
}

func TestRedisTransport_DropsWhenQueueIsFullWithoutBlocking(t *testing.T) {
	transport := &RedisTransport{
		queue: make(chan redisLogRequest, 1),
	}
	entry := pkg.LogEntry{Level: pkg.LevelInfo, Message: "queued", Timestamp: time.Now()}

	require.NoError(t, transport.Log(entry))
	require.ErrorIs(t, transport.Log(entry), ErrRedisLogQueueFull)
}

func TestRedisTransport_FlushBoundaries(t *testing.T) {
	require.NoError(t, (&RedisTransport{}).Flush())

	fullQueue := make(chan redisLogRequest, 1)
	fullQueue <- redisLogRequest{}
	transport := &RedisTransport{queue: fullQueue, timeout: time.Millisecond}
	require.ErrorIs(t, transport.Flush(), context.DeadlineExceeded)

	transport = &RedisTransport{queue: make(chan redisLogRequest, 1), timeout: time.Millisecond}
	require.ErrorIs(t, transport.Flush(), context.DeadlineExceeded)

	transport = &RedisTransport{queue: make(chan redisLogRequest, 1), timeout: 0}
	go func() {
		request := <-transport.queue
		request.done <- nil
	}()
	require.NoError(t, transport.Flush())
}
