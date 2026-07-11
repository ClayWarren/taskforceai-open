package postgres

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/cenkalti/backoff/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Transactor is an interface that allows starting a transaction.
// Both *pgxpool.Pool and pgxmock.PgxPoolIface satisfy this.
type Transactor interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

// WithTx is a helper to run a function within a transaction.
func WithTx(ctx context.Context, pool Transactor, fn func(pgx.Tx) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}

	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback(ctx)
			panic(p)
		}
	}()

	if err := fn(tx); err != nil {
		_ = tx.Rollback(ctx)
		return err
	}

	return tx.Commit(ctx)
}

var (
	pool   *pgxpool.Pool
	poolMu sync.Mutex

	parsePoolConfig   = pgxpool.ParseConfig
	newPoolWithConfig = pgxpool.NewWithConfig
	initDBMetrics     = InitDBMetrics
	pingDBPool        = (*pgxpool.Pool).Ping
)

// GetPool returns a singleton connection pool.
// It reads DATABASE_URL from the environment.
func GetPool(_ context.Context) (*pgxpool.Pool, error) {
	poolMu.Lock()
	defer poolMu.Unlock()

	if pool != nil {
		return pool, nil
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		err := fmt.Errorf("DATABASE_URL environment variable is not set")
		slog.Error("Database pool initialization failed", "error", err)
		return nil, err
	}

	config, err := parsePoolConfig(dbURL)
	if err != nil {
		wrappedErr := fmt.Errorf("failed to parse DATABASE_URL: %w", err)
		slog.Error("Database pool configuration parsing failed", "error", err)
		return nil, wrappedErr
	}

	// Sensible defaults for serverless (Vercel)
	// MaxConns should stay low because Vercel spins up many isolated instances (cold starts).
	// A high value here (e.g. 10) * 1000 instances = 10,000 connections -> Crash.
	// We use 5 to allow moderate parallelism without exhausting Postgres connection limits.
	maxConns := int32(5)
	if v := os.Getenv("DB_MAX_CONNS"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 32); err == nil && n > 0 {
			maxConns = int32(n)
		}
	}
	// Initialize database metrics
	initDBMetrics("adapters")

	config.MaxConns = maxConns
	config.MinConns = 0
	config.ConnConfig.Tracer = NewMetricsTracer()
	config.MaxConnLifetime = 30 * time.Minute

	initCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	createdPool, err := newPoolWithConfig(initCtx, config)
	if err != nil {
		slog.Error("Database pool creation failed", "error", err)
		return nil, err
	}

	pool = createdPool
	return pool, nil
}

// HealthCheck performs a ping to the database with a short timeout.
func HealthCheck(ctx context.Context) error {
	p, err := GetPool(ctx)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	return pingDBPool(p, ctx)
}

// WithRetry executes the given function with exponential backoff on transient database errors.
func WithRetry[T any](ctx context.Context, operation func() (T, error)) (T, error) {
	return backoff.Retry(ctx, func() (T, error) {
		res, err := operation()
		if err != nil && !IsTransientError(err) {
			return res, backoff.Permanent(err)
		}
		return res, err
	}, backoff.WithBackOff(backoff.NewExponentialBackOff()))
}

// IsTransientError returns true if the error is a transient database error
// that should be retried.
func IsTransientError(err error) bool {
	if err == nil {
		return false
	}
	// Check for common transient pgx/postgres errors
	if pgErr, ok := errors.AsType[*pgconn.PgError](err); ok {
		// https://www.postgresql.org/docs/current/errcodes-appendix.html
		// 57P01: admin_shutdown
		// 57P02: crash_shutdown
		// 57P03: cannot_connect_now
		// 08001: sqlclient_unable_to_establish_sqlconnection
		// 08003: connection_does_not_exist
		// 08006: connection_failure
		// 53300: too_many_connections
		switch pgErr.Code {
		case "57P01", "57P02", "57P03", "08001", "08003", "08006", "53300":
			return true
		}
	}
	// Also check for network-related errors if possible
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return false // Don't retry if context is done
	}
	return false
}

// Close closes the connection pool. Call this on shutdown.
func Close() {
	poolMu.Lock()
	defer poolMu.Unlock()

	if pool != nil {
		pool.Close()
		pool = nil
	}
}
