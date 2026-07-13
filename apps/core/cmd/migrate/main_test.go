package main

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRun_MissingDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	old := migrateFunc
	migrateFunc = func(ctx context.Context, url string) error { return nil }
	defer func() { migrateFunc = old }()

	err := run(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "DATABASE_URL")
}

func TestRun_Success(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	old := migrateFunc
	called := false
	migrateFunc = func(ctx context.Context, url string) error {
		called = true
		if url != "postgres://example" {
			return errors.New("unexpected url")
		}
		return nil
	}
	defer func() { migrateFunc = old }()

	err := run(context.Background())
	require.NoError(t, err)
	assert.True(t, called)
}

func TestRun_MigrateError(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	old := migrateFunc
	migrateFunc = func(ctx context.Context, url string) error { return errors.New("fail") }
	defer func() { migrateFunc = old }()

	err := run(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "migration failed")
}

func TestMainFunction_Success(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://example")
	old := migrateFunc
	migrateFunc = func(ctx context.Context, url string) error { return nil }
	defer func() { migrateFunc = old }()

	main()
}

func TestMainFunction_ErrorExits(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	oldMigrate := migrateFunc
	migrateFunc = func(ctx context.Context, url string) error { return nil }
	defer func() { migrateFunc = oldMigrate }()

	oldExit := exitFunc
	var exitCode int
	exitFunc = func(code int) { exitCode = code }
	defer func() { exitFunc = oldExit }()

	main()

	assert.Equal(t, 1, exitCode)
}
