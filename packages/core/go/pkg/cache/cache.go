package cache

import (
	"context"
	"time"
)

type ICache interface {
	Get(ctx context.Context, key string) (string, error)
	Set(ctx context.Context, key string, value string, ttl time.Duration) error
	Delete(ctx context.Context, key string) (bool, error)
	Take(ctx context.Context, key string) (string, error)
	Clear(ctx context.Context) error
}
