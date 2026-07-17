package sync

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
)

var marshalSyncPushResponse = json.Marshal

// IdempotencyStore manages request de-duplication.
type IdempotencyStore interface {
	GetResult(ctx context.Context, userID, key string) (IdempotencyLookup, error)
	SaveResult(ctx context.Context, userID, key string, result SyncPushResponse) error
}

// IdempotencyLookup makes cache hit and miss outcomes explicit.
//
//sumtype:decl
type IdempotencyLookup interface {
	idempotencyLookup()
}

// IdempotencyMiss indicates that a request has no cached response.
type IdempotencyMiss struct{}

func (IdempotencyMiss) idempotencyLookup() {}

// IdempotencyHit contains the response produced by an earlier request.
type IdempotencyHit struct {
	Response SyncPushResponse
}

func (IdempotencyHit) idempotencyLookup() {}

// RedisIdempotencyStore implements IdempotencyStore using Redis.
type RedisIdempotencyStore struct {
	client redis.Cmdable
}

func NewRedisIdempotencyStore() (*RedisIdempotencyStore, error) {
	client, err := getRedisClient()
	if err != nil {
		return nil, err
	}
	return &RedisIdempotencyStore{client: client}, nil
}

func (s *RedisIdempotencyStore) GetResult(ctx context.Context, userID, key string) (IdempotencyLookup, error) {
	if key == "" {
		return IdempotencyMiss{}, nil
	}

	redisKey := fmt.Sprintf("idempotency:sync:%s:%s", userID, key)
	val, err := s.client.Get(ctx, redisKey)
	if errors.Is(err, redis.ErrKeyNotFound) {
		return IdempotencyMiss{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get idempotency result: %w", err)
	}
	return syncPushResponseFromCache(val)
}

func syncPushResponseFromCache(val string) (IdempotencyLookup, error) {
	var result SyncPushResponse
	if err := json.Unmarshal([]byte(val), &result); err != nil {
		return nil, fmt.Errorf("decode idempotency result: %w", err)
	}
	return IdempotencyHit{Response: result}, nil
}

func (s *RedisIdempotencyStore) SaveResult(ctx context.Context, userID, key string, result SyncPushResponse) error {
	if key == "" {
		return nil
	}

	redisKey := fmt.Sprintf("idempotency:sync:%s:%s", userID, key)
	data, err := marshalSyncPushResponse(result)
	if err != nil {
		return fmt.Errorf("encode idempotency result: %w", err)
	}

	// Cache for 24 hours
	return s.client.Set(ctx, redisKey, data, 24*time.Hour)
}
