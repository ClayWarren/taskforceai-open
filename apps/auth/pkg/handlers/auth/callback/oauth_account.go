package callback

import (
	"context"
	"errors"
	"fmt"
	postgres "github.com/TaskForceAI/infrastructure/postgres/pkg"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/jackc/pgx/v5"
)

var errOAuthAccountDatabaseConnection = errors.New("database connection failed")

var getOAuthAccountPool = func(ctx context.Context) (postgres.Transactor, error) {
	return postgres.GetPool(ctx)
}

func replaceOAuthAccount(
	ctx context.Context,
	q *db.Queries,
	userID int,
	input auth.CreateAccountInput,
) error {
	var transactor postgres.Transactor
	if existingTransactor, isTx := q.GetDB().(postgres.Transactor); isTx {
		transactor = existingTransactor
	} else {
		pool, err := getOAuthAccountPool(ctx)
		if err != nil {
			return fmt.Errorf("%w: %w", errOAuthAccountDatabaseConnection, err)
		}
		transactor = pool
	}

	return postgres.WithTx(ctx, transactor, func(tx pgx.Tx) error {
		txQ := q.WithTx(tx)
		accountRepo := auth.NewAccountRepository(txQ)

		// #nosec G115 -- AuthenticatedUser IDs are database user IDs accepted by sqlc.
		if err := txQ.DeleteAccount(ctx, db.DeleteAccountParams{
			UserID:   int32(userID),
			Provider: input.Provider,
		}); err != nil {
			return fmt.Errorf("failed to delete existing account: %w", err)
		}

		if _, err := accountRepo.CreateAccount(ctx, input); err != nil {
			return fmt.Errorf("failed to store new account: %w", err)
		}
		return nil
	})
}
