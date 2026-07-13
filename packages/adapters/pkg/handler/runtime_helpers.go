package handler

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/TaskForceAI/adapters/pkg/requestmeta"
)

type RedisClient interface {
	Get(ctx context.Context, key string) (string, error)
	Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
	SetNX(ctx context.Context, key string, value []byte, ttl time.Duration) (bool, error)
	Del(ctx context.Context, key string) (bool, error)
	Incr(ctx context.Context, key string) (int, error)
}

type RedisClientFactory func() (RedisClient, error)

var (
	redisClient        RedisClient
	redisClientFactory RedisClientFactory
	redisMu            sync.Mutex
	redisOnce          sync.Once
)

func GetRedisClient() RedisClient {
	redisOnce.Do(func() {
		redisMu.Lock()
		factory := redisClientFactory
		redisMu.Unlock()
		if factory == nil {
			return
		}
		client, err := factory()
		if err != nil {
			return
		}
		redisMu.Lock()
		redisClient = client
		redisMu.Unlock()
	})
	redisMu.Lock()
	defer redisMu.Unlock()
	return redisClient
}

func SetRedisClient(client RedisClient) {
	redisMu.Lock()
	defer redisMu.Unlock()
	redisClient = client
	redisClientFactory = nil
	redisOnce = sync.Once{}
}

func SetRedisClientFactory(factory RedisClientFactory) {
	redisMu.Lock()
	defer redisMu.Unlock()
	redisClient = nil
	redisClientFactory = factory
	redisOnce = sync.Once{}
}

func GetClientIP(r *http.Request) *string {
	return requestmeta.GetClientIP(r)
}
