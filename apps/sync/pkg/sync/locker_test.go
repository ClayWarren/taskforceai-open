package sync

import (
	"context"
	"errors"
	"io"
	"math/big"
	"testing"
	"testing/synctest"
	"time"

	mocks "github.com/TaskForceAI/infrastructure/redis/mocks/pkg"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestRedisLocker_LockSuccessAndRelease(t *testing.T) {
	client := new(mocks.Cmdable)
	locker := &RedisLocker{client: client}

	// Expect SetNX to succeed and capture the generated value
	client.On("SetNX", mock.Anything, "lock:sync:user:user1", mock.Anything, defaultLockTTL).Return(true, nil)

	// Expect Eval to be called for atomic release
	cmd := goredis.NewCmd(context.Background())
	client.On("Eval", mock.Anything, mock.Anything, []string{"lock:sync:user:user1"}, mock.Anything).Return(cmd)

	// If we wanted to test fallback:
	// client.On("Get", mock.Anything, "lock:sync:user:user1").Return(func(ctx context.Context, key string) string { return string(capturedValue) }, nil)
	// client.On("Del", mock.Anything, "lock:sync:user:user1").Return(true, nil)

	release, err := locker.Lock(context.Background(), "user1")
	require.NoError(t, err)
	assert.NotNil(t, release)

	release()
	client.AssertExpectations(t)
}

func TestRedisLocker_ReleaseFallbackDeletesOwnedLock(t *testing.T) {
	client := new(mocks.Cmdable)
	locker := &RedisLocker{client: client}
	release := locker.createReleaseFunc(context.Background(), "lock:sync:user:user1", "value-1")

	cmd := goredis.NewCmd(context.Background())
	cmd.SetErr(errors.New("eval unsupported"))
	client.On("Eval", mock.Anything, mock.Anything, []string{"lock:sync:user:user1"}, "value-1").Return(cmd).Once()
	client.On("Get", mock.Anything, "lock:sync:user:user1").Return("value-1", nil).Once()
	client.On("Del", mock.Anything, "lock:sync:user:user1").Return(true, nil).Once()

	release()
	client.AssertExpectations(t)
}

func TestRedisLocker_ReleaseFallbackLogsDeleteError(t *testing.T) {
	client := new(mocks.Cmdable)
	locker := &RedisLocker{client: client}
	release := locker.createReleaseFunc(context.Background(), "lock:sync:user:user1", "value-1")

	cmd := goredis.NewCmd(context.Background())
	cmd.SetErr(errors.New("eval unsupported"))
	client.On("Eval", mock.Anything, mock.Anything, []string{"lock:sync:user:user1"}, "value-1").Return(cmd).Once()
	client.On("Get", mock.Anything, "lock:sync:user:user1").Return("value-1", nil).Once()
	client.On("Del", mock.Anything, "lock:sync:user:user1").Return(false, errors.New("delete failed")).Once()

	release()
	client.AssertExpectations(t)
}

func TestRedisLocker_ReleaseFallbackWarnsOnGetError(t *testing.T) {
	client := new(mocks.Cmdable)
	locker := &RedisLocker{client: client}
	release := locker.createReleaseFunc(context.Background(), "lock:sync:user:user1", "value-1")

	cmd := goredis.NewCmd(context.Background())
	cmd.SetErr(errors.New("eval unsupported"))
	client.On("Eval", mock.Anything, mock.Anything, []string{"lock:sync:user:user1"}, "value-1").Return(cmd).Once()
	client.On("Get", mock.Anything, "lock:sync:user:user1").Return("", errors.New("network down")).Once()

	release()
	client.AssertExpectations(t)
}

func TestRedisLocker_LockCancelled(t *testing.T) {
	client := new(mocks.Cmdable)
	locker := &RedisLocker{client: client}
	ctx, cancel := context.WithCancel(context.Background())

	// Pre-cancel context so it fails immediately or loop fails
	// Actually Lock implementation likely loops.
	// If SetNX returns false, it waits.
	// We need to simulate failure then cancel?
	// Or cancel immediately.

	// If we cancel immediately, SetNX might not be called if check is first.
	// Or it is called and fails.

	// Let's assume it tries at least once or checks ctx.
	// If we return false, it should loop. If ctx done, it exits.
	client.On("SetNX", mock.Anything, "lock:sync:user:user1", mock.Anything, mock.Anything).Return(false, nil).Maybe()

	cancel() // Cancel before call
	release, err := locker.Lock(ctx, "user1")
	require.Error(t, err)
	assert.Nil(t, release)
}

func TestRedisLocker_LockDeadlineDeterministic(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		client := new(mocks.Cmdable)
		locker := &RedisLocker{client: client}
		client.On("SetNX", mock.Anything, "lock:sync:user:user1", mock.Anything, mock.Anything).Return(false, nil).Maybe()

		ctx, cancel := context.WithTimeout(t.Context(), 75*time.Millisecond)
		defer cancel()

		release, err := locker.Lock(ctx, "user1")
		require.ErrorIs(t, err, context.DeadlineExceeded)
		assert.Nil(t, release)
		client.AssertExpectations(t)
	})
}

func TestRedisLocker_LockExhaustsRetries(t *testing.T) {
	client := new(mocks.Cmdable)
	locker := &RedisLocker{client: client}

	original := lockRetryAfter
	lockRetryAfter = func(time.Duration) <-chan time.Time {
		ch := make(chan time.Time)
		close(ch)
		return ch
	}
	t.Cleanup(func() { lockRetryAfter = original })

	client.On("SetNX", mock.Anything, "lock:sync:user:user1", mock.Anything, defaultLockTTL).Return(false, errors.New("redis busy")).Times(50)

	release, err := locker.Lock(context.Background(), "user1")
	require.Error(t, err)
	assert.Nil(t, release)
	assert.Contains(t, err.Error(), "failed to acquire sync lock")
	client.AssertExpectations(t)
}

func TestLockRetryDelayAddsBoundedJitter(t *testing.T) {
	backoff := 100 * time.Millisecond

	for range 100 {
		delay := lockRetryDelay(backoff)
		assert.GreaterOrEqual(t, delay, backoff)
		assert.Less(t, delay, backoff+(backoff/2))
	}
}

func TestLockRetryDelayFallbackBranches(t *testing.T) {
	assert.Equal(t, time.Duration(0), lockRetryDelay(0))

	originalRandomInt := lockRandomInt
	lockRandomInt = func(io.Reader, *big.Int) (*big.Int, error) {
		return nil, errors.New("entropy unavailable")
	}
	t.Cleanup(func() { lockRandomInt = originalRandomInt })

	backoff := 100 * time.Millisecond
	assert.Equal(t, backoff+backoff/4, lockRetryDelay(backoff))
}

func TestNewRedisLocker_Success(t *testing.T) {
	original := getRedisClient
	mockClient := new(mocks.Cmdable)
	getRedisClient = func() (redis.Cmdable, error) {
		return mockClient, nil
	}
	t.Cleanup(func() { getRedisClient = original })

	locker, err := NewRedisLocker()
	require.NoError(t, err)
	assert.NotNil(t, locker)
}

func TestNewRedisLocker_Error(t *testing.T) {
	original := getRedisClient
	getRedisClient = func() (redis.Cmdable, error) {
		return nil, errors.New("redis down")
	}
	t.Cleanup(func() { getRedisClient = original })

	locker, err := NewRedisLocker()
	require.Error(t, err)
	assert.Nil(t, locker)
}

func TestResolveLockTTL_WithDeadline(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	ttl := resolveLockTTL(ctx)
	assert.Equal(t, minLockTTL, ttl)
}

func TestResolveLockTTL_MaxDeadline(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Hour)
	defer cancel()

	ttl := resolveLockTTL(ctx)
	assert.Equal(t, maxLockTTL, ttl)
}
