package database

import (
	"context"
	"testing"

	postgres "github.com/TaskForceAI/infrastructure/postgres/pkg"
	"github.com/stretchr/testify/require"
)

func TestGetQueries(t *testing.T) {
	postgres.Close()
	t.Cleanup(postgres.Close)
	t.Setenv("DATABASE_URL", "")
	queries, err := GetQueries(context.Background())
	require.Error(t, err)
	require.Nil(t, queries)

	t.Setenv("DATABASE_URL", "postgres://user:pass@localhost:5432/taskforceai")
	queries, err = GetQueries(context.Background())
	require.NoError(t, err)
	require.NotNil(t, queries)
}
