package billing

import (
	"context"
	appdatabase "github.com/TaskForceAI/billing-service/pkg/database"

	"github.com/TaskForceAI/adapters/pkg/db"
)

func GetQueries(ctx context.Context) (*db.Queries, error) {
	return appdatabase.GetQueries(ctx)
}
