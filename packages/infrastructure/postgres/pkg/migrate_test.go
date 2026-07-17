package postgres

import (
	"context"
	"errors"
	"io"
	"os"
	"testing"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/source"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type stubMigrationSource struct{}

func (stubMigrationSource) Open(string) (source.Driver, error) { return stubMigrationSource{}, nil }
func (stubMigrationSource) Close() error                       { return nil }
func (stubMigrationSource) First() (uint, error)               { return 0, os.ErrNotExist }
func (stubMigrationSource) Prev(uint) (uint, error)            { return 0, os.ErrNotExist }
func (stubMigrationSource) Next(uint) (uint, error)            { return 0, os.ErrNotExist }
func (stubMigrationSource) ReadUp(uint) (io.ReadCloser, string, error) {
	return nil, "", os.ErrNotExist
}
func (stubMigrationSource) ReadDown(uint) (io.ReadCloser, string, error) {
	return nil, "", os.ErrNotExist
}

type stubMigrationRunner struct {
	err error
}

func (s stubMigrationRunner) Up() error {
	return s.err
}

func TestMigrateRejectsInvalidDatabaseURL(t *testing.T) {
	err := Migrate(context.Background(), "not-a-postgres-url")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to create migrate instance")
}

func TestMigrateSourceAndRunnerEdges(t *testing.T) {
	originalSource := newMigrationSource
	originalRunner := newMigrationRunner
	t.Cleanup(func() {
		newMigrationSource = originalSource
		newMigrationRunner = originalRunner
	})

	t.Run("source error", func(t *testing.T) {
		newMigrationSource = func() (source.Driver, error) {
			return nil, errors.New("source failed")
		}
		newMigrationRunner = originalRunner

		err := Migrate(context.Background(), "postgres://example")
		require.ErrorContains(t, err, "failed to create migration source")
	})

	t.Run("runner error", func(t *testing.T) {
		newMigrationSource = func() (source.Driver, error) {
			return stubMigrationSource{}, nil
		}
		newMigrationRunner = func(source.Driver, string) (migrationRunner, error) {
			return nil, errors.New("runner failed")
		}

		err := Migrate(context.Background(), "postgres://example")
		require.ErrorContains(t, err, "failed to create migrate instance")
	})

	t.Run("up error", func(t *testing.T) {
		newMigrationSource = func() (source.Driver, error) {
			return stubMigrationSource{}, nil
		}
		newMigrationRunner = func(source.Driver, string) (migrationRunner, error) {
			return stubMigrationRunner{err: errors.New("up failed")}, nil
		}

		err := Migrate(context.Background(), "postgres://example")
		require.ErrorContains(t, err, "failed to run migrations")
	})

	t.Run("no change", func(t *testing.T) {
		newMigrationSource = func() (source.Driver, error) {
			return stubMigrationSource{}, nil
		}
		newMigrationRunner = func(source.Driver, string) (migrationRunner, error) {
			return stubMigrationRunner{err: migrate.ErrNoChange}, nil
		}

		require.NoError(t, Migrate(context.Background(), "postgres://example"))
	})

	t.Run("success", func(t *testing.T) {
		newMigrationSource = func() (source.Driver, error) {
			return stubMigrationSource{}, nil
		}
		newMigrationRunner = func(source.Driver, string) (migrationRunner, error) {
			return stubMigrationRunner{}, nil
		}

		require.NoError(t, Migrate(context.Background(), "postgres://example"))
	})
}
