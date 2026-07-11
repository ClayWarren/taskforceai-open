package cache

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	goredis "github.com/redis/go-redis/v9"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

var tracer = otel.Tracer("infrastructure-cache")

const redactedCacheKey = "[REDACTED_KEY]"

// RedisCacheClient defines the operations used by RedisCache.
type RedisCacheClient interface {
	Get(ctx context.Context, key string) (string, bool, error)
	Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
	Del(ctx context.Context, key string) (bool, error)
	GetDel(ctx context.Context, key string) (string, bool, error)
}

type RedisCache struct {
	client RedisCacheClient
}

type redisClientWrapper struct {
	client goredis.Cmdable
}

func (w redisClientWrapper) Get(ctx context.Context, key string) (string, bool, error) {
	result, err := w.client.Get(ctx, key).Result()
	if errors.Is(err, goredis.Nil) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return result, true, nil
}

func (w redisClientWrapper) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	return w.client.Set(ctx, key, value, ttl).Err()
}

func (w redisClientWrapper) Del(ctx context.Context, key string) (bool, error) {
	count, err := w.client.Del(ctx, key).Result()
	return count > 0, err
}

func (w redisClientWrapper) GetDel(ctx context.Context, key string) (string, bool, error) {
	result, err := w.client.GetDel(ctx, key).Result()
	if errors.Is(err, goredis.Nil) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return result, true, nil
}

func NewRedisCache(url string, token string) (*RedisCache, error) {
	url = strings.TrimSpace(url)
	if url == "" {
		return nil, errors.New("MISSING_CREDENTIALS")
	}

	options, err := goredis.ParseURL(url)
	if err != nil {
		slog.Error("Failed to parse Redis URL for cache", "error", err)
		return nil, fmt.Errorf("failed to parse redis url: %w", err)
	}

	if token = strings.TrimSpace(token); token != "" {
		options.Password = token
	}

	return &RedisCache{
		client: redisClientWrapper{client: goredis.NewClient(options)},
	}, nil
}

// NewRedisCacheWithClient creates a RedisCache with a custom client
func NewRedisCacheWithClient(client RedisCacheClient) *RedisCache {
	return &RedisCache{client: client}
}

func (r *RedisCache) Get(ctx context.Context, key string) (string, error) {
	ctx, span := tracer.Start(ctx, "cache.get", trace.WithAttributes(
		attribute.String("db.system", "redis"),
		attribute.String("db.operation", "GET"),
		attribute.String("db.statement", "GET [REDACTED_KEY]"),
	))
	defer span.End()

	val, found, err := r.client.Get(ctx, key)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		slog.Error("Redis cache GET failed", "key", redactedCacheKey, "error", err)
		return "", err
	}
	if !found {
		return "", ErrNotFound
	}

	return val, nil
}

func (r *RedisCache) Set(ctx context.Context, key string, value string, ttl time.Duration) error {
	ctx, span := tracer.Start(ctx, "cache.set", trace.WithAttributes(
		attribute.String("db.system", "redis"),
		attribute.String("db.operation", "SET"),
		attribute.String("db.statement", "SET [REDACTED_KEY]"),
	))
	defer span.End()

	err := r.client.Set(ctx, key, []byte(value), ttl)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		slog.Error("Redis cache SET failed", "key", redactedCacheKey, "error", err)
	}
	return err
}

func (r *RedisCache) Delete(ctx context.Context, key string) (bool, error) {
	ctx, span := tracer.Start(ctx, "cache.delete", trace.WithAttributes(
		attribute.String("db.system", "redis"),
		attribute.String("db.operation", "DEL"),
		attribute.String("db.statement", "DEL [REDACTED_KEY]"),
	))
	defer span.End()

	deleted, err := r.client.Del(ctx, key)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		slog.Error("Redis cache DELETE failed", "key", redactedCacheKey, "error", err)
	}
	return deleted, err
}

func (r *RedisCache) Take(ctx context.Context, key string) (string, error) {
	ctx, span := tracer.Start(ctx, "cache.take", trace.WithAttributes(
		attribute.String("db.system", "redis"),
		attribute.String("db.operation", "TAKE"),
		attribute.String("db.statement", "TAKE [REDACTED_KEY]"),
	))
	defer span.End()

	val, found, err := r.client.GetDel(ctx, key)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		slog.Error("Redis cache TAKE failed", "key", redactedCacheKey, "error", err)
		return "", err
	}
	if !found {
		return "", ErrNotFound
	}

	return val, nil
}

func (r *RedisCache) Clear(context.Context) error {
	return errors.New("clear is not supported by RedisCache")
}
