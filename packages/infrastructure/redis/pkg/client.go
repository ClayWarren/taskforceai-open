package redis

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/extra/redisotel/v9"
	goredis "github.com/redis/go-redis/v9"
)

var rateLimitSequence atomic.Uint64
var instrumentRedisTracing = redisotel.InstrumentTracing

var incrWithExpireScript = goredis.NewScript(`
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
return current
`)

var rateLimitScript = goredis.NewScript(`
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call("ZREMRANGEBYSCORE", key, 0, now - window)
local count = redis.call("ZCARD", key)
if count < limit then
  redis.call("ZADD", key, now, member)
  redis.call("PEXPIRE", key, window + 1000)
  return {1, limit - count - 1, now + window}
end

local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
local reset = now + window
if oldest[2] then
  reset = tonumber(oldest[2]) + window
end
redis.call("PEXPIRE", key, window + 1000)
return {0, 0, reset}
`)

// Cmdable defines the interface for Redis operations
type Cmdable interface {
	Get(ctx context.Context, key string) (string, error)
	Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
	SetNX(ctx context.Context, key string, value []byte, ttl time.Duration) (bool, error)
	Expire(ctx context.Context, key string, ttl time.Duration) (bool, error)
	TTL(ctx context.Context, key string) (time.Duration, error)
	Incr(ctx context.Context, key string) (int, error)
	Del(ctx context.Context, key string) (bool, error)

	// Streams support (via go-redis fallback for now as REST is limited for streams)
	XAdd(ctx context.Context, stream string, values map[string]any) (string, error)
	XRead(ctx context.Context, stream string, lastID string, count int64) ([]goredis.XMessage, error)
	XTrimMaxLen(ctx context.Context, stream string, maxLen int64) (int64, error)
	Watch(ctx context.Context, fn func(*goredis.Tx) error, keys ...string) error
	Eval(ctx context.Context, script string, keys []string, args ...any) *goredis.Cmd
}

// Client wraps go-redis with the Cmdable interface used across services.
type Client struct {
	redis *goredis.Client
}

var _ Cmdable = (*Client)(nil)

func redisKeyLogValue(key string) string {
	digest := sha256.Sum256([]byte(key))
	return fmt.Sprintf("sha256:%x", digest[:8])
}

// NewClient creates a Cmdable Redis client from a go-redis client.
func NewClient(r *goredis.Client) *Client {
	return &Client{redis: r}
}

type EnvConfig struct {
	URLEnvVar   string
	TokenEnvVar string
}

func NewClientFromEnv(configs ...EnvConfig) Cmdable {
	for _, cfg := range configs {
		url := strings.TrimSpace(os.Getenv(cfg.URLEnvVar))
		if url == "" {
			continue
		}
		opts, err := goredis.ParseURL(url)
		if err != nil {
			return nil
		}
		if token := strings.TrimSpace(os.Getenv(cfg.TokenEnvVar)); token != "" {
			opts.Password = token
		}
		return NewClient(goredis.NewClient(opts))
	}

	client, err := GetClient()
	if err != nil {
		return nil
	}
	return client
}

func (c *Client) SupportsEval() bool {
	return c.redis != nil
}

func (c *Client) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	err := c.redis.Set(ctx, key, value, ttl).Err()
	if err != nil {
		slog.Error("Redis Set failed", "keyHash", redisKeyLogValue(key), "error", err)
	}
	return err
}

func (c *Client) SetNX(ctx context.Context, key string, value []byte, ttl time.Duration) (bool, error) {
	res, err := c.redis.SetNX(ctx, key, value, ttl).Result()
	if err != nil {
		slog.Error("Redis SetNX failed", "keyHash", redisKeyLogValue(key), "error", err)
	}
	return res, err
}

func (c *Client) Expire(ctx context.Context, key string, ttl time.Duration) (bool, error) {
	if ttl <= 0 {
		return false, fmt.Errorf("expire ttl must be positive")
	}

	res, err := c.redis.Expire(ctx, key, ttl).Result()
	if err != nil {
		slog.Error("Redis Expire failed", "keyHash", redisKeyLogValue(key), "error", err)
		return false, err
	}
	return res, nil
}

func (c *Client) TTL(ctx context.Context, key string) (time.Duration, error) {
	res, err := c.redis.TTL(ctx, key).Result()
	if err != nil {
		slog.Error("Redis TTL failed", "keyHash", redisKeyLogValue(key), "error", err)
	}
	return res, err
}

func (c *Client) Get(ctx context.Context, key string) (string, error) {
	res, err := c.redis.Get(ctx, key).Result()
	if errors.Is(err, goredis.Nil) {
		return "", ErrKeyNotFound
	}
	if err != nil {
		slog.Error("Redis Get failed", "keyHash", redisKeyLogValue(key), "error", err)
	}
	return res, err
}

func (c *Client) Del(ctx context.Context, key string) (bool, error) {
	res, err := c.redis.Del(ctx, key).Result()
	if err != nil {
		slog.Error("Redis Del failed", "keyHash", redisKeyLogValue(key), "error", err)
	}
	return res > 0, err
}

func (c *Client) Incr(ctx context.Context, key string) (int, error) {
	res, err := c.redis.Incr(ctx, key).Result()
	if err != nil {
		slog.Error("Redis Incr failed", "keyHash", redisKeyLogValue(key), "error", err)
	}
	return int(res), err
}

func (c *Client) IncrWithExpire(ctx context.Context, key string, ttl time.Duration) (int, error) {
	if ttl <= 0 {
		return 0, fmt.Errorf("incr with expire ttl must be positive")
	}

	keys := [1]string{key}
	res, err := incrWithExpireScript.Run(ctx, c.redis, keys[:], int(ttl.Milliseconds())).Int()
	if err != nil {
		slog.Error("Redis IncrWithExpire failed", "keyHash", redisKeyLogValue(key), "error", err)
	}
	return res, err
}

func (c *Client) CheckRateLimit(ctx context.Context, key string, limit int, window time.Duration) (bool, int, time.Time, error) {
	now := time.Now()
	windowMs := max(window.Milliseconds(), 1)
	var memberBuf [40]byte
	memberBytes := strconv.AppendInt(memberBuf[:0], now.UnixNano(), 10)
	memberBytes = append(memberBytes, ':')
	memberBytes = strconv.AppendUint(memberBytes, rateLimitSequence.Add(1), 10)
	keys := [1]string{key}
	res, err := rateLimitScript.Run(ctx, c.redis, keys[:], now.UnixMilli(), windowMs, limit, string(memberBytes)).Result()
	if err != nil {
		slog.Error("Redis CheckRateLimit failed", "keyHash", redisKeyLogValue(key), "error", err)
		return false, 0, time.Time{}, err
	}

	allowed, remaining, resetAt, err := parseRateLimitScriptResult(res)
	if err != nil {
		return false, 0, time.Time{}, err
	}

	return allowed, remaining, resetAt, nil
}

func parseRateLimitScriptResult(res any) (bool, int, time.Time, error) {
	values, ok := res.([]any)
	if !ok || len(values) != 3 {
		return false, 0, time.Time{}, fmt.Errorf("redis rate limit script returned unexpected result: %T", res)
	}
	allowedRaw, ok := redisScriptInt64(values[0])
	if !ok {
		return false, 0, time.Time{}, fmt.Errorf("redis rate limit script returned invalid allowed value: %T", values[0])
	}
	remainingRaw, ok := redisScriptInt64(values[1])
	if !ok {
		return false, 0, time.Time{}, fmt.Errorf("redis rate limit script returned invalid remaining value: %T", values[1])
	}
	resetRaw, ok := redisScriptInt64(values[2])
	if !ok {
		return false, 0, time.Time{}, fmt.Errorf("redis rate limit script returned invalid reset value: %T", values[2])
	}

	return allowedRaw == 1, max(int(remainingRaw), 0), time.UnixMilli(resetRaw), nil
}

func redisScriptInt64(value any) (int64, bool) {
	switch v := value.(type) {
	case int64:
		return v, true
	case int:
		return int64(v), true
	case string:
		n, err := strconv.ParseInt(v, 10, 64)
		return n, err == nil
	default:
		return 0, false
	}
}

func (c *Client) XAdd(ctx context.Context, stream string, values map[string]any) (string, error) {
	// redisotel handles tracing for go-redis
	res, err := c.redis.XAdd(ctx, &goredis.XAddArgs{
		Stream: stream,
		Values: values,
	}).Result()
	if err != nil {
		slog.Error("Redis XAdd failed", "streamHash", redisKeyLogValue(stream), "error", err)
	}
	return res, err
}

func (c *Client) XRead(ctx context.Context, stream string, lastID string, count int64) ([]goredis.XMessage, error) {
	return c.xRead(ctx, stream, lastID, count, -1)
}

func (c *Client) XReadBlock(ctx context.Context, stream string, lastID string, count int64, block time.Duration) ([]goredis.XMessage, error) {
	if block <= 0 {
		return nil, fmt.Errorf("xread block duration must be positive")
	}
	return c.xRead(ctx, stream, lastID, count, block)
}

func (c *Client) xRead(ctx context.Context, stream string, lastID string, count int64, block time.Duration) ([]goredis.XMessage, error) {
	// redisotel handles tracing for go-redis
	streams, err := c.redis.XRead(ctx, &goredis.XReadArgs{
		Streams: []string{stream, lastID},
		Count:   count,
		Block:   block,
	}).Result()
	if err != nil {
		if errors.Is(err, goredis.Nil) {
			return nil, nil
		}
		slog.Error("Redis XRead failed", "streamHash", redisKeyLogValue(stream), "error", err)
		return nil, err
	}
	return firstXReadMessages(streams), nil
}

func firstXReadMessages(streams []goredis.XStream) []goredis.XMessage {
	if len(streams) == 0 {
		return nil
	}
	return streams[0].Messages
}

func (c *Client) XTrimMaxLen(ctx context.Context, stream string, maxLen int64) (int64, error) {
	// redisotel handles tracing for go-redis
	return c.redis.XTrimMaxLen(ctx, stream, maxLen).Result()
}

func (c *Client) Watch(ctx context.Context, fn func(*goredis.Tx) error, keys ...string) error {
	// redisotel handles tracing for go-redis
	return c.redis.Watch(ctx, fn, keys...)
}

func (c *Client) Eval(ctx context.Context, script string, keys []string, args ...any) *goredis.Cmd {
	return c.redis.Eval(ctx, script, keys, args...)
}

func (c *Client) RunScript(ctx context.Context, script *goredis.Script, keys []string, args ...any) *goredis.Cmd {
	return script.Run(ctx, c.redis, keys, args...)
}

var (
	clientMu     sync.Mutex
	client       Cmdable
	clientErr    error
	clientOnce   sync.Once
	pubSubMu     sync.Mutex
	pubSubClient *goredis.Client
	pubSubErr    error
	pubSubOnce   sync.Once
)

// SetClient sets the global redis client, useful for testing
func SetClient(c Cmdable) {
	clientMu.Lock()
	defer clientMu.Unlock()

	client = c
	clientErr = nil
}

// ResetClient resets the global client state
func ResetClient() {
	clientMu.Lock()
	client = nil
	clientErr = nil
	clientOnce = sync.Once{}
	clientMu.Unlock()

	pubSubMu.Lock()
	pubSubClient = nil
	pubSubErr = nil
	pubSubOnce = sync.Once{}
	pubSubMu.Unlock()
}

func GetClient() (Cmdable, error) {
	clientMu.Lock()
	defer clientMu.Unlock()

	if client != nil {
		return client, nil
	}
	clientOnce.Do(func() {
		redisClient, err := GetPubSubClient()
		if err != nil {
			clientErr = err
			return
		}
		client = NewClient(redisClient)
	})

	return client, clientErr
}

// GetPubSubClient returns a goredis client for Pub/Sub and Stream operations
func GetPubSubClient() (*goredis.Client, error) {
	pubSubMu.Lock()
	defer pubSubMu.Unlock()

	pubSubOnce.Do(func() {
		redisURL := os.Getenv("REDIS_URL")
		if redisURL == "" {
			redisURL = os.Getenv("REDIS_KV_URL")
		}

		if redisURL == "" {
			pubSubErr = fmt.Errorf("REDIS_URL or REDIS_KV_URL must be set for TCP support")
			slog.Warn("Redis TCP support disabled: configuration missing")
			return
		}

		opts, parseErr := goredis.ParseURL(redisURL)
		if parseErr != nil {
			pubSubErr = fmt.Errorf("failed to parse redis url: %w", parseErr)
			slog.Error("Failed to parse Redis URL", "error", parseErr)
			return
		}

		pubSubClient = goredis.NewClient(opts)

		// Enable OpenTelemetry tracing for go-redis
		if traceErr := instrumentRedisTracing(pubSubClient); traceErr != nil {
			slog.Warn("Failed to instrument Redis client with OpenTelemetry", "error", traceErr)
		}
	})

	return pubSubClient, pubSubErr
}
