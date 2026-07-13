package integrations

import (
	"context"
	"strconv"

	"github.com/TaskForceAI/adapters/pkg/db"
)

type Account struct {
	ID       string
	Provider string
}

type DeviceLogin struct {
	ID string
}

type Repository interface {
	GetAccountsByUserID(ctx context.Context, userID int32) ([]Account, error)
	GetActiveDeviceLoginsByUserID(ctx context.Context, userID int32) ([]DeviceLogin, error)
	DeleteAccount(ctx context.Context, userID int32, provider string) error
	DeleteDeviceLoginByUserID(ctx context.Context, userID int32) error
}

type Queries interface {
	GetAccountsByUserID(ctx context.Context, userID int32) ([]accountRow, error)
	GetActiveDeviceLoginsByUserID(ctx context.Context, userID *int32) ([]deviceLoginRow, error)
	DeleteAccount(ctx context.Context, params deleteAccountInput) error
	DeleteDeviceLoginByUserID(ctx context.Context, userID *int32) error
}

type accountRow struct {
	ID       string
	Provider string
}

type deviceLoginRow struct {
	ID int32
}

type deleteAccountInput struct {
	UserID   int32
	Provider string
}

type sqlcQueries struct {
	q *db.Queries
}

type PgRepository struct {
	q Queries
}

func NewRepository(q *db.Queries) *PgRepository {
	return &PgRepository{q: sqlcQueries{q: q}}
}

func (q sqlcQueries) GetAccountsByUserID(ctx context.Context, userID int32) ([]accountRow, error) {
	rows, err := q.q.GetAccountsByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}

	accounts := make([]accountRow, len(rows))
	for i, row := range rows {
		accounts[i] = accountRow{
			ID:       row.ID,
			Provider: row.Provider,
		}
	}
	return accounts, nil
}

func (q sqlcQueries) GetActiveDeviceLoginsByUserID(ctx context.Context, userID *int32) ([]deviceLoginRow, error) {
	rows, err := q.q.GetActiveDeviceLoginsByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}

	deviceLogins := make([]deviceLoginRow, len(rows))
	for i, row := range rows {
		deviceLogins[i] = deviceLoginRow{ID: row.ID}
	}
	return deviceLogins, nil
}

func (q sqlcQueries) DeleteAccount(ctx context.Context, params deleteAccountInput) error {
	return q.q.DeleteAccount(ctx, db.DeleteAccountParams{
		UserID:   params.UserID,
		Provider: params.Provider,
	})
}

func (q sqlcQueries) DeleteDeviceLoginByUserID(ctx context.Context, userID *int32) error {
	return q.q.DeleteDeviceLoginByUserID(ctx, userID)
}

func (r *PgRepository) GetAccountsByUserID(ctx context.Context, userID int32) ([]Account, error) {
	dbAccs, err := r.q.GetAccountsByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	accs := make([]Account, len(dbAccs))
	for i, a := range dbAccs {
		accs[i] = Account(a)
	}
	return accs, nil
}

func (r *PgRepository) GetActiveDeviceLoginsByUserID(ctx context.Context, userID int32) ([]DeviceLogin, error) {
	// Using int32 pointer as required by generated code if applicable, assumed from handler usage
	uid := userID
	dbDevs, err := r.q.GetActiveDeviceLoginsByUserID(ctx, &uid)
	if err != nil {
		return nil, err
	}
	devs := make([]DeviceLogin, len(dbDevs))
	for i, d := range dbDevs {
		devs[i] = DeviceLogin{ID: strconv.FormatInt(int64(d.ID), 10)}
	}
	return devs, nil
}

func (r *PgRepository) DeleteAccount(ctx context.Context, userID int32, provider string) error {
	return r.q.DeleteAccount(ctx, deleteAccountInput{
		UserID:   userID,
		Provider: provider,
	})
}

func (r *PgRepository) DeleteDeviceLoginByUserID(ctx context.Context, userID int32) error {
	uid := userID
	return r.q.DeleteDeviceLoginByUserID(ctx, &uid)
}
