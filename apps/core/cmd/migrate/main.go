package main

import (
	"context"
	"fmt"
	postgres "github.com/TaskForceAI/infrastructure/postgres/pkg"
	"log/slog"
	"os"
)

var migrateFunc = postgres.Migrate
var exitFunc = os.Exit

func run(ctx context.Context) error {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return fmt.Errorf("DATABASE_URL environment variable is not set")
	}

	if err := migrateFunc(ctx, databaseURL); err != nil {
		return fmt.Errorf("migration failed: %w", err)
	}

	return nil
}

func main() {
	if err := run(context.Background()); err != nil {
		slog.Error("Migration failed", "error", err)
		exitFunc(1)
		return
	}
	slog.Info("Migration completed successfully")
}
