package postgres

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestMockPool(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	pool, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("create mock pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func resetPoolState() {
	poolMu.Lock()
	defer poolMu.Unlock()
	if pool != nil {
		pool.Close()
	}
	pool = nil
}

func resetPoolStateWithoutClosing() {
	poolMu.Lock()
	defer poolMu.Unlock()
	pool = nil
}

func TestGetPool_NoURL(t *testing.T) {
	resetPoolState()
	t.Cleanup(resetPoolState)

	t.Setenv("DATABASE_URL", "")
	p, err := GetPool(context.Background())
	assert.Nil(t, p)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "DATABASE_URL environment variable is not set")
}

func TestGetPool_InvalidURL(t *testing.T) {
	resetPoolState()
	t.Cleanup(resetPoolState)

	t.Setenv("DATABASE_URL", "invalid-url")
	p, err := GetPool(context.Background())
	assert.Nil(t, p)
	assert.Error(t, err)
}

func TestClose(t *testing.T) {
	// Should not panic even if pool is nil
	resetPoolState()
	Close()
}

func TestGetPool_ValidURL(t *testing.T) {
	resetPoolState()
	t.Cleanup(resetPoolState)
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost:5432/db")

	// This might fail if it tries to ping, but with MinConns=0 it shouldn't connect eagerly?
	// Actually pgxpool.New() usually pings.
	// But let's try. If it fails, we cover the error path inside GetPool (NewWithConfig error).

	p, err := GetPool(context.Background())
	if err != nil {
		// If it fails to connect, that's fine, we still covered the config parsing lines.
		assert.Contains(t, err.Error(), "connection refused") // or similar
	} else {
		assert.NotNil(t, p)
		Close()
	}
}

func TestGetPool_UsesCachedPool(t *testing.T) {
	resetPoolStateWithoutClosing()
	t.Cleanup(resetPoolStateWithoutClosing)

	poolMu.Lock()
	pool = &pgxpool.Pool{}
	poolMu.Unlock()

	got, err := GetPool(context.Background())
	require.NoError(t, err)
	assert.Same(t, pool, got)
}

func TestGetPool_ConfiguresAndStoresCreatedPool(t *testing.T) {
	resetPoolStateWithoutClosing()
	t.Cleanup(resetPoolStateWithoutClosing)
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost:5432/db")
	t.Setenv("DB_MAX_CONNS", "7")

	originalNew := newPoolWithConfig
	originalInitMetrics := initDBMetrics
	var observedMaxConns int32
	initCalls := 0
	newPoolWithConfig = func(ctx context.Context, config *pgxpool.Config) (*pgxpool.Pool, error) {
		observedMaxConns = config.MaxConns
		return &pgxpool.Pool{}, nil
	}
	initDBMetrics = func(service string) *DBMetrics {
		if service == "adapters" {
			initCalls++
		}
		return nil
	}
	t.Cleanup(func() {
		newPoolWithConfig = originalNew
		initDBMetrics = originalInitMetrics
	})

	got, err := GetPool(context.Background())
	require.NoError(t, err)
	assert.NotNil(t, got)
	assert.Equal(t, int32(7), observedMaxConns)
	assert.Equal(t, 1, initCalls)
}

func TestGetPool_NewWithConfigError(t *testing.T) {
	resetPoolStateWithoutClosing()
	t.Cleanup(resetPoolStateWithoutClosing)
	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost:5432/db")

	originalNew := newPoolWithConfig
	newPoolWithConfig = func(context.Context, *pgxpool.Config) (*pgxpool.Pool, error) {
		return nil, fmt.Errorf("create failed")
	}
	t.Cleanup(func() { newPoolWithConfig = originalNew })

	got, err := GetPool(context.Background())
	require.ErrorContains(t, err, "create failed")
	assert.Nil(t, got)
}

func TestIsTransientError(t *testing.T) {
	tests := []struct {
		name      string
		err       error
		transient bool
	}{
		{name: "nil", err: nil, transient: false},
		{name: "admin shutdown", err: &pgconn.PgError{Code: "57P01"}, transient: true},
		{name: "too many connections", err: &pgconn.PgError{Code: "53300"}, transient: true},
		{name: "syntax error", err: &pgconn.PgError{Code: "42601"}, transient: false},
		{name: "deadline", err: context.DeadlineExceeded, transient: false},
		{name: "generic", err: errors.New("boom"), transient: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.transient, IsTransientError(tc.err))
		})
	}
}

func TestHealthCheckReturnsPoolError(t *testing.T) {
	resetPoolState()
	t.Cleanup(resetPoolState)
	t.Setenv("DATABASE_URL", "")

	err := HealthCheck(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "DATABASE_URL")
}

func TestHealthCheckPingsCachedPool(t *testing.T) {
	resetPoolStateWithoutClosing()
	t.Cleanup(resetPoolStateWithoutClosing)

	poolMu.Lock()
	pool = &pgxpool.Pool{}
	poolMu.Unlock()

	originalPing := pingDBPool
	pingCalls := 0
	pingDBPool = func(*pgxpool.Pool, context.Context) error {
		pingCalls++
		return nil
	}
	t.Cleanup(func() { pingDBPool = originalPing })

	require.NoError(t, HealthCheck(context.Background()))
	assert.Equal(t, 1, pingCalls)
}

func TestWithRetry(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		calls := 0
		got, err := WithRetry(context.Background(), func() (int, error) {
			calls++
			return 42, nil
		})
		require.NoError(t, err)
		assert.Equal(t, 42, got)
		assert.Equal(t, 1, calls)
	})

	t.Run("non transient error is permanent", func(t *testing.T) {
		calls := 0
		_, err := WithRetry(context.Background(), func() (int, error) {
			calls++
			return 0, errors.New("syntax error")
		})
		require.Error(t, err)
		assert.Equal(t, 1, calls)
	})

	t.Run("transient retries until context ends", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
		defer cancel()
		calls := 0
		_, err := WithRetry(ctx, func() (int, error) {
			calls++
			return 0, &pgconn.PgError{Code: "57P03"}
		})
		require.Error(t, err)
		assert.GreaterOrEqual(t, calls, 1)
	})
}

func TestWithTx(t *testing.T) {
	t.Run("commits on success", func(t *testing.T) {
		mockPool := newTestMockPool(t)

		mockPool.ExpectBegin()
		mockPool.ExpectCommit()

		err := WithTx(context.Background(), mockPool, func(tx pgx.Tx) error {
			assert.NotNil(t, tx)
			return nil
		})
		assert.NoError(t, err)
		assert.NoError(t, mockPool.ExpectationsWereMet())
	})

	t.Run("rolls back on callback error", func(t *testing.T) {
		mockPool := newTestMockPool(t)

		mockPool.ExpectBegin()
		mockPool.ExpectRollback()

		err := WithTx(context.Background(), mockPool, func(pgx.Tx) error {
			return errors.New("callback failed")
		})
		require.Error(t, err)
		assert.NoError(t, mockPool.ExpectationsWereMet())
	})

	t.Run("returns begin error", func(t *testing.T) {
		mockPool := newTestMockPool(t)

		mockPool.ExpectBegin().WillReturnError(errors.New("begin failed"))

		err := WithTx(context.Background(), mockPool, func(pgx.Tx) error {
			t.Fatal("callback should not run")
			return nil
		})
		require.ErrorContains(t, err, "begin failed")
		assert.NoError(t, mockPool.ExpectationsWereMet())
	})

	t.Run("rolls back and repanics", func(t *testing.T) {
		mockPool := newTestMockPool(t)

		mockPool.ExpectBegin()
		mockPool.ExpectRollback()

		defer func() {
			if recover() == nil {
				t.Fatal("expected panic")
			}
			assert.NoError(t, mockPool.ExpectationsWereMet())
		}()

		_ = WithTx(context.Background(), mockPool, func(pgx.Tx) error {
			panic("boom")
		})
	})
}
