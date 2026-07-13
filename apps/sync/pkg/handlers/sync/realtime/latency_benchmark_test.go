package realtime

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/benchtest"
	"github.com/TaskForceAI/adapters/pkg/db"
	redispkg "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/pashagolub/pgxmock/v4"
	goredis "github.com/redis/go-redis/v9"
)

func BenchmarkRealtimePollLatencyProfile(b *testing.B) {
	originalLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	b.Cleanup(func() { slog.SetDefault(originalLogger) })

	b.Setenv("AUTH_SECRET", testAuthSecret())
	tokenString := createValidToken("poll-benchmark@example.com")
	mockPool, err := pgxmock.NewPool(pgxmock.QueryMatcherOption(pgxmock.QueryMatcherRegexp))
	if err != nil {
		b.Fatalf("pgx mock: %v", err)
	}
	queries := db.New(mockPool)
	originalGetQueries := getQueries
	getQueries = func(context.Context) (*db.Queries, error) {
		return queries, nil
	}
	b.Cleanup(func() {
		getQueries = originalGetQueries
		if err := mockPool.ExpectationsWereMet(); err != nil {
			b.Fatalf("unmet pgx expectations: %v", err)
		}
		mockPool.Close()
	})

	originalGetRedisClient := getRedisClient
	mockRedis := &mockCmdable{
		xReadFunc: func(ctx context.Context, stream string, lastID string, count int64) ([]goredis.XMessage, error) {
			return []goredis.XMessage{{
				ID: "1-0",
				Values: map[string]any{
					"type":    "conversation_updated",
					"version": 7,
				},
			}}, nil
		},
	}
	getRedisClient = func() (redispkg.Cmdable, error) {
		return mockRedis, nil
	}
	b.Cleanup(func() { getRedisClient = originalGetRedisClient })

	samples := make([]time.Duration, 0, b.N)
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		b.StopTimer()
		expectRealtimeUserLookup(mockPool, "poll-benchmark@example.com", 123, false)
		req := httptest.NewRequest(http.MethodGet, "/?sync_token="+tokenString, nil)
		resp := httptest.NewRecorder()
		b.StartTimer()

		startedAt := time.Now()
		Handler(resp, req)
		samples = append(samples, time.Since(startedAt))
		if resp.Code != http.StatusOK {
			b.Fatalf("unexpected status code: %d", resp.Code)
		}
		var parsed PollResponse
		if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
			b.Fatalf("decode poll response: %v", err)
		}
		if len(parsed.Messages) != 1 {
			b.Fatalf("expected one realtime message, got %d", len(parsed.Messages))
		}
	}
	b.StopTimer()
	benchtest.ReportLatencyProfile(b, samples)
}
