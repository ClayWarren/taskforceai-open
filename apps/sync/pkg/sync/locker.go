package sync

import (
	"context"
	crand "crypto/rand"
	"fmt"
	"log/slog"
	"math/big"
	"time"

	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
)

// Locker defines the interface for distributed locking.
type Locker interface {
	Lock(ctx context.Context, userID string) (func(), error)
}

// RedisLocker implements Locker using Redis SET NX.
type RedisLocker struct {
	client redis.Cmdable
}

const (
	defaultLockTTL = 2 * time.Minute
	minLockTTL     = 30 * time.Second
	maxLockTTL     = 10 * time.Minute
)

var (
	lockRetryAfter = time.After
	lockRandomInt  = crand.Int
)

func resolveLockTTL(ctx context.Context) time.Duration {
	ttl := defaultLockTTL
	if deadline, ok := ctx.Deadline(); ok {
		remaining := time.Until(deadline)
		if remaining > 0 {
			ttl = remaining + 15*time.Second
		}
	}

	if ttl < minLockTTL {
		return minLockTTL
	}
	if ttl > maxLockTTL {
		return maxLockTTL
	}
	return ttl
}

func NewRedisLocker() (*RedisLocker, error) {
	client, err := getRedisClient()
	if err != nil {
		return nil, err
	}
	return &RedisLocker{client: client}, nil
}

// Lock acquires a lock for the given user.
// Returns a release function and nil error on success.
// Uses exponential backoff with jitter for retry attempts.
func (l *RedisLocker) Lock(ctx context.Context, userID string) (func(), error) {
	lockKey := fmt.Sprintf("lock:sync:user:%s", userID)
	lockValue := fmt.Sprintf("%d", time.Now().UnixNano())
	ttl := resolveLockTTL(ctx)

	// Retry configuration with exponential backoff
	const (
		maxRetries     = 50
		initialBackoff = 50 * time.Millisecond
		maxBackoff     = 500 * time.Millisecond
	)

	backoff := initialBackoff
	for i := range maxRetries {
		success, err := l.client.SetNX(ctx, lockKey, []byte(lockValue), ttl)
		if err != nil {
			slog.Warn("Redis error during lock attempt", "key", lockKey, "attempt", i+1, "error", err)
		}

		if success {
			return l.createReleaseFunc(ctx, lockKey, lockValue), nil
		}

		// Wait with exponential backoff and jitter
		select {
		case <-ctx.Done():
			slog.Warn("Lock acquisition cancelled", "key", lockKey, "attempts", i+1, "reason", ctx.Err())
			return nil, ctx.Err()
		case <-lockRetryAfter(lockRetryDelay(backoff)):
			// Exponential backoff with cap
			backoff *= 2
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
		}
	}

	slog.Warn("Lock acquisition failed after max retries", "key", lockKey, "attempts", maxRetries, "userId", userID)
	return nil, fmt.Errorf("failed to acquire sync lock for user %s after %d retries", userID, maxRetries)
}

func lockRetryDelay(backoff time.Duration) time.Duration {
	jitterCap := backoff / 2
	if jitterCap <= 0 {
		return backoff
	}
	jitter, err := lockRandomInt(crand.Reader, big.NewInt(int64(jitterCap)))
	if err != nil {
		return backoff + jitterCap/2
	}
	return backoff + time.Duration(jitter.Int64())
}

func (l *RedisLocker) createReleaseFunc(ctx context.Context, lockKey, capturedValue string) func() {
	releaseParent := context.WithoutCancel(ctx)
	return func() {
		releaseCtx, cancel := context.WithTimeout(releaseParent, 5*time.Second)
		defer cancel()

		script := `
if redis.call("get",KEYS[1]) == ARGV[1] then
    return redis.call("del",KEYS[1])
else
    return 0
end`
		// Atomically compare-and-delete via Lua script.
		cmd := l.client.Eval(releaseCtx, script, []string{lockKey}, capturedValue)
		if err := cmd.Err(); err != nil {
			// If Lua is unavailable, verify ownership before deleting; the lock TTL is the safety net.
			val, getErr := l.client.Get(releaseCtx, lockKey)
			if getErr == nil && val == capturedValue {
				if _, delErr := l.client.Del(releaseCtx, lockKey); delErr != nil {
					slog.Error("Failed to release sync lock (fallback)", "key", lockKey, "error", delErr)
				}
			} else if getErr != nil && getErr.Error() != "key not found" && getErr.Error() != "redis: nil" {
				slog.Warn("Could not verify lock ownership during release", "key", lockKey, "error", getErr)
			}
		}
	}
}
