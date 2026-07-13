package redis

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
)

const benchmarkRateLimitWindow = 200

func BenchmarkMockClientGet(b *testing.B) {
	client := NewMockClient()
	ctx := context.Background()
	require.NoError(b, client.Set(ctx, "bench:key", []byte("value"), time.Minute))

	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		_, err := client.Get(ctx, "bench:key")
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkMockClientCheckRateLimitFullWindow(b *testing.B) {
	client := NewMockClient()
	ctx := context.Background()
	const key = "bench:rate-limit"
	for range benchmarkRateLimitWindow {
		_, _, _, err := client.CheckRateLimit(ctx, key, benchmarkRateLimitWindow+1, time.Minute)
		require.NoError(b, err)
	}

	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		_, _, _, err := client.CheckRateLimit(ctx, key, benchmarkRateLimitWindow+1, time.Minute)
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkClientGetMiniredis(b *testing.B) {
	server := miniredis.RunT(b)
	redisClient := goredis.NewClient(&goredis.Options{Addr: server.Addr()})
	b.Cleanup(func() {
		require.NoError(b, redisClient.Close())
	})

	client := NewClient(redisClient)
	ctx := context.Background()
	require.NoError(b, client.Set(ctx, "bench:key", []byte("value"), 0))

	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		_, err := client.Get(ctx, "bench:key")
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkClientIncrWithExpireMiniredis(b *testing.B) {
	server := miniredis.RunT(b)
	redisClient := goredis.NewClient(&goredis.Options{Addr: server.Addr()})
	b.Cleanup(func() {
		require.NoError(b, redisClient.Close())
	})

	client := NewClient(redisClient)
	ctx := context.Background()

	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		_, err := client.IncrWithExpire(ctx, "bench:counter", time.Minute)
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkClientCheckRateLimitMiniredis(b *testing.B) {
	server := miniredis.RunT(b)
	redisClient := goredis.NewClient(&goredis.Options{Addr: server.Addr()})
	b.Cleanup(func() {
		require.NoError(b, redisClient.Close())
	})

	client := NewClient(redisClient)
	ctx := context.Background()

	b.ReportAllocs()
	b.ResetTimer()
	for i := range b.N {
		if i%benchmarkRateLimitWindow == 0 {
			_, err := client.Del(ctx, "bench:rate-limit")
			if err != nil {
				b.Fatal(err)
			}
		}
		allowed, _, _, err := client.CheckRateLimit(ctx, "bench:rate-limit", benchmarkRateLimitWindow+1, time.Minute)
		if err != nil {
			b.Fatal(err)
		}
		if !allowed {
			b.Fatal("rate limit unexpectedly denied")
		}
	}
}
