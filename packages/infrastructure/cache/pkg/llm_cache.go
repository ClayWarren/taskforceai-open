package cache

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"time"
)

type Cache interface {
	Get(ctx context.Context, key string) (string, error)
	Set(ctx context.Context, key string, value string, ttl time.Duration) error
	Delete(ctx context.Context, key string) (bool, error)
	Take(ctx context.Context, key string) (string, error)
	Clear(ctx context.Context) error
}

type LLMCache struct {
	cache Cache
}

func NewLLMCache(c Cache) *LLMCache {
	return &LLMCache{cache: c}
}

func (l *LLMCache) Get(ctx context.Context, prompt string, model string) (string, error) {
	key := l.hashKey("", prompt, model)
	return l.cache.Get(ctx, key)
}

func (l *LLMCache) Set(ctx context.Context, prompt string, model string, result string, ttl time.Duration) error {
	key := l.hashKey("", prompt, model)
	return l.cache.Set(ctx, key, result, ttl)
}

func (l *LLMCache) GetScoped(ctx context.Context, scope string, prompt string, model string) (string, error) {
	key := l.hashKey(scope, prompt, model)
	return l.cache.Get(ctx, key)
}

func (l *LLMCache) SetScoped(ctx context.Context, scope string, prompt string, model string, result string, ttl time.Duration) error {
	key := l.hashKey(scope, prompt, model)
	return l.cache.Set(ctx, key, result, ttl)
}

func (l *LLMCache) hashKey(scope string, prompt string, model string) string {
	data := make([]byte, 0, len(scope)+len(model)+len(prompt)+24)
	data = appendLengthPrefixed(data, scope)
	data = appendLengthPrefixed(data, model)
	data = appendLengthPrefixed(data, prompt)

	hash := sha256.Sum256(data)

	var key [len("llm:cache:") + sha256.Size*2]byte
	copy(key[:], "llm:cache:")
	hex.Encode(key[len("llm:cache:"):], hash[:])
	return string(key[:])
}

func appendLengthPrefixed(dst []byte, value string) []byte {
	var length [8]byte
	binary.BigEndian.PutUint64(length[:], uint64(len(value)))
	dst = append(dst, length[:]...)
	return append(dst, value...)
}
