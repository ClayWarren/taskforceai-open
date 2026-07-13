package callback

import (
	"context"
	"errors"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/workos/workos-go/v6/pkg/usermanagement"
)

type nonTransactorDB struct{}

func (nonTransactorDB) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, errors.New("not implemented")
}

func (nonTransactorDB) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("not implemented")
}

func (nonTransactorDB) QueryRow(context.Context, string, ...any) pgx.Row {
	return nil
}

func TestLinkOrCreateWorkOSUser_GetPoolUnavailable(t *testing.T) {
	t.Setenv("DATABASE_URL", "")

	_, err := linkOrCreateWorkOSUser(context.Background(), db.New(nonTransactorDB{}), usermanagement.User{
		ID:    "workos_pool",
		Email: "pool@example.com",
	})
	assert.Error(t, err)
}
