package postgres

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"log/slog"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source"
	"github.com/golang-migrate/migrate/v4/source/iofs"
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

type migrationRunner interface {
	Up() error
}

var (
	newMigrationSource = func() (source.Driver, error) {
		return iofs.New(migrationFiles, "migrations")
	}
	newMigrationRunner = func(driver source.Driver, databaseURL string) (migrationRunner, error) {
		return migrate.NewWithSourceInstance("iofs", driver, databaseURL)
	}
)

// Migrate runs database migrations.
func Migrate(ctx context.Context, databaseURL string) error {
	d, err := newMigrationSource()
	if err != nil {
		slog.Error("Failed to create migration source", "error", err)
		return fmt.Errorf("failed to create migration source: %w", err)
	}

	m, err := newMigrationRunner(d, databaseURL)
	if err != nil {
		slog.Error("Failed to create migrate instance", "error", err)
		return fmt.Errorf("failed to create migrate instance: %w", err)
	}

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		slog.Error("Failed to run migrations", "error", err)
		return fmt.Errorf("failed to run migrations: %w", err)
	}

	slog.Info("Database migrations applied successfully")
	return nil
}
