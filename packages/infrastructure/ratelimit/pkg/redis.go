package ratelimit

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
	goredis "github.com/redis/go-redis/v9"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

var tracer = otel.Tracer("infrastructure-ratelimit")

var rateLimitMemberSequence atomic.Uint64
var rateLimitRandomRead = rand.Read
var rateLimitProcessTokenOnce sync.Once
var rateLimitProcessToken string

const slidingWindowScript = `
local key = KEYS[1]
local redis_time = redis.call("TIME")
local now = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local member = ARGV[3]
local ttl = tonumber(ARGV[4])
local cutoff = now - window

redis.call("ZREMRANGEBYSCORE", key, 0, cutoff)
local count = redis.call("ZCARD", key)
if count >= limit then
	local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
	local reset = now + window
	if oldest[2] then
		reset = tonumber(oldest[2]) + window
	end
	redis.call("PEXPIRE", key, ttl)
	return {0, math.max(limit - count, 0), reset}
end

redis.call("ZADD", key, now, member)
count = count + 1
redis.call("PEXPIRE", key, ttl)
local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
local reset = now + window
if oldest[2] then
	reset = tonumber(oldest[2]) + window
end
return {1, math.max(limit - count, 0), reset}
`

var slidingWindowRedisScript = goredis.NewScript(slidingWindowScript)

const combinedSlidingWindowScript = `
local redis_time = redis.call("TIME")
local now = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
local user_window = tonumber(ARGV[1])
local user_limit = tonumber(ARGV[2])
local org_window = tonumber(ARGV[3])
local org_limit = tonumber(ARGV[4])
local member = ARGV[5]
local user_ttl = tonumber(ARGV[6])
local org_ttl = tonumber(ARGV[7])

local function inspect(key, window, limit, ttl)
	redis.call("ZREMRANGEBYSCORE", key, 0, now - window)
	local count = redis.call("ZCARD", key)
	local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
	local reset = now + window
	if oldest[2] then reset = tonumber(oldest[2]) + window end
	redis.call("PEXPIRE", key, ttl)
	return count, reset, count < limit
end

local user_count, user_reset, user_allowed = inspect(KEYS[1], user_window, user_limit, user_ttl)
local org_count, org_reset, org_allowed = inspect(KEYS[2], org_window, org_limit, org_ttl)
if not user_allowed or not org_allowed then
	return {0, user_allowed and 1 or 0, math.max(user_limit - user_count, 0), user_reset,
		org_allowed and 1 or 0, math.max(org_limit - org_count, 0), org_reset}
end

redis.call("ZADD", KEYS[1], now, member .. ":u")
redis.call("ZADD", KEYS[2], now, member .. ":o")
redis.call("PEXPIRE", KEYS[1], user_ttl)
redis.call("PEXPIRE", KEYS[2], org_ttl)
return {1, 1, math.max(user_limit - user_count - 1, 0), user_reset,
	1, math.max(org_limit - org_count - 1, 0), org_reset}
`

var combinedSlidingWindowRedisScript = goredis.NewScript(combinedSlidingWindowScript)

type RateLimitResult struct {
	Allowed   bool
	Remaining int
	ResetTime time.Time
}

type CombinedRateLimitResult struct {
	Allowed bool
	User    RateLimitResult
	Org     RateLimitResult
}

type Limiter interface {
	Check(ctx context.Context, key string, limit int, window time.Duration) (*RateLimitResult, error)
	CheckOrg(ctx context.Context, orgID int32, limit int, window time.Duration) (*RateLimitResult, error)
}

type redisScriptRunner interface {
	RunScript(ctx context.Context, script *goredis.Script, keys []string, args ...any) *goredis.Cmd
}

type redisEvalSupport interface {
	SupportsEval() bool
}

type redisRateLimitChecker interface {
	CheckRateLimit(ctx context.Context, key string, limit int, window time.Duration) (bool, int, time.Time, error)
}

type redisCombinedRateLimitChecker interface {
	CheckRateLimits(ctx context.Context, firstKey string, firstLimit int, firstWindow time.Duration, secondKey string, secondLimit int, secondWindow time.Duration) (bool, int, time.Time, bool, int, time.Time, error)
}

type RedisLimiter struct {
	client    infraredis.Cmdable
	keyPrefix string
}

func NewRedisLimiter(client infraredis.Cmdable, prefix string) *RedisLimiter {
	if prefix == "" {
		prefix = "rl"
	}
	return &RedisLimiter{
		client:    client,
		keyPrefix: prefix + ":",
	}
}

func (r *RedisLimiter) Check(ctx context.Context, key string, limit int, window time.Duration) (*RateLimitResult, error) {
	return r.check(ctx, rateLimitIdentityType(key), "u:", key, limit, window)
}

func (r *RedisLimiter) CheckOrg(ctx context.Context, orgID int32, limit int, window time.Duration) (*RateLimitResult, error) {
	return r.check(ctx, "org", "o:", strconv.Itoa(int(orgID)), limit, window)
}

// CheckUserAndOrg atomically consumes both rate-limit scopes or neither.
func (r *RedisLimiter) CheckUserAndOrg(ctx context.Context, userKey string, userLimit int, userWindow time.Duration, orgID int32, orgLimit int, orgWindow time.Duration) (*CombinedRateLimitResult, error) {
	if r.client == nil {
		return nil, fmt.Errorf("redis ratelimit client is nil")
	}
	if userLimit <= 0 || orgLimit <= 0 {
		return nil, fmt.Errorf("redis ratelimit limits must be positive")
	}
	if userWindow <= 0 {
		userWindow = time.Second
	}
	if orgWindow <= 0 {
		orgWindow = time.Second
	}
	userWindowMillis := max(userWindow.Milliseconds(), int64(1))
	orgWindowMillis := max(orgWindow.Milliseconds(), int64(1))
	keys := []string{
		r.keyPrefix + "u:" + userKey,
		r.keyPrefix + "o:" + strconv.Itoa(int(orgID)),
	}
	if evalSupport, ok := r.client.(redisEvalSupport); ok && !evalSupport.SupportsEval() {
		if checker, ok := r.client.(redisCombinedRateLimitChecker); ok {
			userAllowed, userRemaining, userReset, orgAllowed, orgRemaining, orgReset, err := checker.CheckRateLimits(
				ctx, keys[0], userLimit, userWindow, keys[1], orgLimit, orgWindow,
			)
			if err != nil {
				return nil, fmt.Errorf("redis combined ratelimit failed: %w", err)
			}
			return &CombinedRateLimitResult{
				Allowed: userAllowed && orgAllowed,
				User:    RateLimitResult{Allowed: userAllowed, Remaining: userRemaining, ResetTime: userReset},
				Org:     RateLimitResult{Allowed: orgAllowed, Remaining: orgRemaining, ResetTime: orgReset},
			}, nil
		}
	}
	args := []any{
		userWindowMillis,
		userLimit,
		orgWindowMillis,
		orgLimit,
		newRateLimitMember(time.Now()),
		userWindowMillis + int64(time.Second/time.Millisecond),
		orgWindowMillis + int64(time.Second/time.Millisecond),
	}
	var cmd *goredis.Cmd
	if scriptRunner, ok := r.client.(redisScriptRunner); ok {
		cmd = scriptRunner.RunScript(ctx, combinedSlidingWindowRedisScript, keys, args...)
	} else {
		cmd = r.client.Eval(ctx, combinedSlidingWindowScript, keys, args...)
	}
	values, err := parseCombinedSlidingWindowResult(cmd.Val(), cmd.Err())
	if err != nil {
		return nil, fmt.Errorf("redis combined ratelimit failed: %w", err)
	}
	return &CombinedRateLimitResult{
		Allowed: values[0] == 1,
		User:    RateLimitResult{Allowed: values[1] == 1, Remaining: max(int(values[2]), 0), ResetTime: time.UnixMilli(values[3])},
		Org:     RateLimitResult{Allowed: values[4] == 1, Remaining: max(int(values[5]), 0), ResetTime: time.UnixMilli(values[6])},
	}, nil
}

func parseCombinedSlidingWindowResult(raw any, err error) ([7]int64, error) {
	var parsed [7]int64
	if err != nil {
		return parsed, err
	}
	values, ok := raw.([]any)
	if !ok || len(values) != len(parsed) {
		return parsed, fmt.Errorf("unexpected redis combined ratelimit result %T", raw)
	}
	for i, value := range values {
		parsedValue, parseErr := redisInt64(value)
		if parseErr != nil {
			return parsed, fmt.Errorf("parse combined result %d: %w", i, parseErr)
		}
		parsed[i] = parsedValue
	}
	return parsed, nil
}

func (r *RedisLimiter) check(ctx context.Context, keyType string, namespace string, key string, limit int, window time.Duration) (*RateLimitResult, error) {
	ctx, span := tracer.Start(ctx, "ratelimit.check", trace.WithAttributes(
		attribute.String("ratelimit.key_type", keyType),
		attribute.Int("ratelimit.limit", limit),
		attribute.Int64("ratelimit.window_seconds", int64(window/time.Second)),
	))
	defer span.End()

	if r.client == nil {
		err := fmt.Errorf("redis ratelimit client is nil")
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, err
	}
	if limit <= 0 {
		err := fmt.Errorf("redis ratelimit limit must be positive, got %d", limit)
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, err
	}

	if window <= 0 {
		window = time.Second
	}

	now := time.Now()
	windowMillis := max(window.Milliseconds(), int64(1))
	ttlMillis := windowMillis + int64(time.Second/time.Millisecond)
	fullKey := r.keyPrefix + namespace + key

	if evalSupport, ok := r.client.(redisEvalSupport); ok && !evalSupport.SupportsEval() {
		if checker, ok := r.client.(redisRateLimitChecker); ok {
			allowed, remaining, resetTime, err := checker.CheckRateLimit(ctx, fullKey, limit, window)
			if err != nil {
				span.RecordError(err)
				span.SetStatus(codes.Error, err.Error())
				return nil, fmt.Errorf("redis ratelimit failed: %w", err)
			}
			span.SetAttributes(
				attribute.Bool("ratelimit.allowed", allowed),
				attribute.Int("ratelimit.remaining", remaining),
			)
			return &RateLimitResult{
				Allowed:   allowed,
				Remaining: remaining,
				ResetTime: resetTime,
			}, nil
		}
	}

	member := newRateLimitMember(now)

	cmd := r.runSlidingWindowScript(ctx, []string{fullKey}, windowMillis, limit, member, ttlMillis)
	values, err := parseSlidingWindowResult(cmd.Val(), cmd.Err())
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		slog.Error("Redis ratelimit script failed", "key", fullKey, "error", err)
		return nil, fmt.Errorf("redis ratelimit failed: %w", err)
	}

	allowed := values.allowed
	remaining := values.remaining
	resetTime := time.UnixMilli(values.resetMillis)

	span.SetAttributes(
		attribute.Bool("ratelimit.allowed", allowed),
		attribute.Int("ratelimit.remaining", remaining),
	)

	return &RateLimitResult{
		Allowed:   allowed,
		Remaining: remaining,
		ResetTime: resetTime,
	}, nil
}

func (r *RedisLimiter) runSlidingWindowScript(ctx context.Context, keys []string, args ...any) *goredis.Cmd {
	if evalSupport, ok := r.client.(redisEvalSupport); ok && !evalSupport.SupportsEval() {
		return r.client.Eval(ctx, slidingWindowScript, keys, args...)
	}
	if scriptRunner, ok := r.client.(redisScriptRunner); ok {
		return scriptRunner.RunScript(ctx, slidingWindowRedisScript, keys, args...)
	}
	return r.client.Eval(ctx, slidingWindowScript, keys, args...)
}

type slidingWindowResult struct {
	allowed     bool
	remaining   int
	resetMillis int64
}

func parseSlidingWindowResult(raw any, err error) (slidingWindowResult, error) {
	if err != nil {
		return slidingWindowResult{}, err
	}

	values, ok := raw.([]any)
	if !ok {
		return slidingWindowResult{}, fmt.Errorf("unexpected redis ratelimit result %T", raw)
	}
	if len(values) != 3 {
		return slidingWindowResult{}, fmt.Errorf("unexpected redis ratelimit result length %d", len(values))
	}

	allowedInt, err := redisInt64(values[0])
	if err != nil {
		return slidingWindowResult{}, fmt.Errorf("parse allowed: %w", err)
	}
	remaining, err := redisInt64(values[1])
	if err != nil {
		return slidingWindowResult{}, fmt.Errorf("parse remaining: %w", err)
	}
	resetMillis, err := redisInt64(values[2])
	if err != nil {
		return slidingWindowResult{}, fmt.Errorf("parse reset: %w", err)
	}
	return slidingWindowResult{
		allowed:     allowedInt == 1,
		remaining:   max(int(remaining), 0),
		resetMillis: resetMillis,
	}, nil
}

func redisInt64(value any) (int64, error) {
	switch v := value.(type) {
	case int:
		return int64(v), nil
	case int64:
		return v, nil
	case float64:
		return int64(v), nil
	case string:
		return strconv.ParseInt(v, 10, 64)
	default:
		return 0, fmt.Errorf("unexpected integer type %T", value)
	}
}

func newRateLimitMember(now time.Time) string {
	sequence := rateLimitMemberSequence.Add(1)
	token := getRateLimitProcessToken()
	var buffer [64]byte
	member := strconv.AppendInt(buffer[:0], now.UnixNano(), 10)
	member = append(member, ':')
	member = append(member, token...)
	member = append(member, ':')
	member = strconv.AppendUint(member, sequence, 10)
	return string(member)
}

func getRateLimitProcessToken() string {
	rateLimitProcessTokenOnce.Do(func() {
		rateLimitProcessToken = "local"

		var random [8]byte
		if _, err := rateLimitRandomRead(random[:]); err == nil {
			var encoded [16]byte
			hex.Encode(encoded[:], random[:])
			rateLimitProcessToken = string(encoded[:])
		}
	})
	return rateLimitProcessToken
}

func rateLimitIdentityType(key string) string {
	switch {
	case strings.HasPrefix(key, "user:"), strings.HasPrefix(key, "id:"), strings.Contains(key, "@"):
		return "user"
	case strings.HasPrefix(key, "ip:"), strings.HasPrefix(key, "/"):
		return "ip"
	default:
		return "key"
	}
}
