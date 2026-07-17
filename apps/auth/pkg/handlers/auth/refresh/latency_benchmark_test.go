package refresh

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/benchtest"
	"github.com/TaskForceAI/adapters/pkg/db"
	authpkg "github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pashagolub/pgxmock/v4"
)

func BenchmarkRefreshHandlerLatencyProfile(b *testing.B) {
	testSecret := setupRefreshHandlerAuth(b)

	now := time.Now().Unix()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub":   "123",
		"email": "refresh-benchmark@example.com",
		"iat":   now - 60,
		"exp":   now + 40,
	})
	tokenString, err := token.SignedString([]byte(testSecret))
	if err != nil {
		b.Fatalf("sign token: %v", err)
	}

	samples := make([]time.Duration, 0, b.N)
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		b.StopTimer()
		mockPool, err := pgxmock.NewPool()
		if err != nil {
			b.Fatalf("pgx mock: %v", err)
		}
		queries := db.New(mockPool)
		handler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
			return queries, nil
		})
		mockPool.ExpectQuery("(?s)SELECT (.+)disabled(.+)FROM users").
			WithArgs(int32(123)).
			WillReturnRows(refreshUserStatusRows(123, false))
		req := httptest.NewRequest(http.MethodPost, "/", nil)
		req.AddCookie(&http.Cookie{Name: authpkg.SessionCookieName, Value: tokenString})
		resp := httptest.NewRecorder()
		b.StartTimer()

		startedAt := time.Now()
		Handler(resp, req)
		samples = append(samples, time.Since(startedAt))
		if resp.Code != http.StatusOK {
			b.Fatalf("unexpected status code: %d", resp.Code)
		}
		b.StopTimer()
		if err := mockPool.ExpectationsWereMet(); err != nil {
			b.Fatalf("unmet pgx expectations: %v", err)
		}
		mockPool.Close()
	}
	b.StopTimer()
	benchtest.ReportLatencyProfile(b, samples)
}

func BenchmarkPostgresRefreshHandlerLatencyProfile(b *testing.B) {
	testSecret := setupRefreshHandlerAuth(b)
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if os.Getenv("TASKFORCE_LATENCY_DEPS") != "1" {
		b.Skip("set TASKFORCE_LATENCY_DEPS=1 to run dependency-backed latency benchmarks")
	}
	if databaseURL == "" {
		b.Skip("DATABASE_URL is required for dependency-backed refresh benchmarks")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		b.Fatalf("connect postgres: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		b.Fatalf("ping postgres: %v", err)
	}

	email := "latency-refresh-deps@example.com"
	var userID int32
	err = pool.QueryRow(ctx, `
INSERT INTO users (email, full_name, plan, disabled, api_tier, api_requests_limit)
VALUES ($1, $2, 'free', false, 'STARTER', 100)
ON CONFLICT (email) DO UPDATE SET
  disabled = false,
  api_tier = 'STARTER',
  api_requests_limit = 100
RETURNING id
`, email, "Latency Benchmark").Scan(&userID)
	if err != nil {
		pool.Close()
		b.Fatalf("seed postgres user: %v", err)
	}
	queries := db.New(pool)
	handler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return queries, nil
	})
	b.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_, _ = pool.Exec(cleanupCtx, "DELETE FROM users WHERE email = $1", email)
		pool.Close()
		handler.SetQueriesOverride(nil)
	})

	now := time.Now().Unix()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub":   strconv.FormatInt(int64(userID), 10),
		"email": email,
		"iat":   now - 60,
		"exp":   now + 40,
	})
	tokenString, err := token.SignedString([]byte(testSecret))
	if err != nil {
		b.Fatalf("sign token: %v", err)
	}

	samples := make([]time.Duration, 0, b.N)
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		b.StopTimer()
		req := httptest.NewRequest(http.MethodPost, "/", nil)
		req.AddCookie(&http.Cookie{Name: authpkg.SessionCookieName, Value: tokenString})
		resp := httptest.NewRecorder()
		b.StartTimer()

		startedAt := time.Now()
		Handler(resp, req)
		samples = append(samples, time.Since(startedAt))
		if resp.Code != http.StatusOK {
			b.Fatalf("unexpected status code: %d", resp.Code)
		}
	}
	b.StopTimer()
	benchtest.ReportLatencyProfile(b, samples)
}
