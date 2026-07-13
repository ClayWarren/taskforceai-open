package database

import (
	"context"

	"github.com/TaskForceAI/adapters/pkg/db"
	postgres "github.com/TaskForceAI/infrastructure/postgres/pkg"
)

// GetQueries composes the shared sqlc gateway with the Postgres pool.
func GetQueries(ctx context.Context) (*db.Queries, error) {
	pool, err := postgres.GetPool(ctx)
	if err != nil {
		return nil, err
	}
	return db.New(pool), nil
}
