package cache

import (
	"context"
	"testing"
	"time"
)

func BenchmarkLLMCacheHashKey(b *testing.B) {
	llm := NewLLMCache(newMapTestCache())
	prompt := "Summarize the incident report, extract action items, and rank them by operational impact."
	model := "gpt-4.1-mini"
	scope := "tenant:taskforceai:user:1234567890"

	b.ReportAllocs()
	for b.Loop() {
		_ = llm.hashKey(scope, prompt, model)
	}
}

func BenchmarkRedisCacheSet(b *testing.B) {
	ctx := context.Background()
	cache := NewRedisCacheWithClient(noopRedisCacheClient{})
	value := "cached model response payload"

	b.ReportAllocs()
	for b.Loop() {
		requireNoBenchmarkError(b, cache.Set(ctx, "hot-key", value, time.Minute))
	}
}

func requireNoBenchmarkError(b *testing.B, err error) {
	b.Helper()
	if err != nil {
		b.Fatal(err)
	}
}

type noopRedisCacheClient struct{}

func (noopRedisCacheClient) Get(context.Context, string) (string, bool, error) {
	return "", false, nil
}

func (noopRedisCacheClient) Set(context.Context, string, []byte, time.Duration) error {
	return nil
}

func (noopRedisCacheClient) Del(context.Context, string) (bool, error) {
	return false, nil
}

func (noopRedisCacheClient) GetDel(context.Context, string) (string, bool, error) {
	return "", false, nil
}
