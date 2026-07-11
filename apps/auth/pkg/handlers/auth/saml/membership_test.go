package saml

import (
	"context"
	"errors"
	postgres "github.com/TaskForceAI/infrastructure/postgres/pkg"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/workos/workos-go/v6/pkg/sso"
)

type samlNonTransactorDBTX struct{}

func (samlNonTransactorDBTX) Exec(context.Context, string, ...interface{}) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, errors.New("unused")
}

func (samlNonTransactorDBTX) Query(context.Context, string, ...interface{}) (pgx.Rows, error) {
	return nil, errors.New("unused")
}

func (samlNonTransactorDBTX) QueryRow(context.Context, string, ...interface{}) pgx.Row {
	return samlUnusedRow{}
}

type samlUnusedRow struct{}

func (samlUnusedRow) Scan(...interface{}) error {
	return errors.New("unused")
}

func TestEnsureSAMLMembership_CreatesMembership(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	workosID := "org_1"
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	mock.ExpectQuery("SELECT (.+) FROM organizations WHERE workos_organization_id").
		WithArgs(&workosID).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "name", "slug", "domain", "created_at", "updated_at", "plan",
			"subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings",
		}).AddRow(
			int32(5), "Org", "org", nil, ts, ts, "free",
			nil, nil, nil, &workosID, false, []byte("{}"),
		))

	mock.ExpectQuery("SELECT (.+) FROM memberships").
		WithArgs(int32(5), int32(1)).
		WillReturnError(pgx.ErrNoRows)

	mock.ExpectQuery("INSERT INTO memberships").
		WithArgs(int32(5), int32(1), db.OrganizationRoleMEMBER).
		WillReturnRows(pgxmock.NewRows([]string{"id", "organization_id", "user_id", "role", "created_at", "updated_at"}).
			AddRow(int32(99), int32(5), int32(1), db.OrganizationRoleMEMBER, ts, ts))

	err := ensureSAMLMembership(context.Background(), db.New(mock), 1, workosID)
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestEnsureSAMLMembership_ExistingMembership(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	workosID := "org_2"
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	mock.ExpectQuery("SELECT (.+) FROM organizations WHERE workos_organization_id").
		WithArgs(&workosID).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "name", "slug", "domain", "created_at", "updated_at", "plan",
			"subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings",
		}).AddRow(
			int32(6), "Org", "org", nil, ts, ts, "free",
			nil, nil, nil, &workosID, false, []byte("{}"),
		))

	mock.ExpectQuery("SELECT (.+) FROM memberships").
		WithArgs(int32(6), int32(2)).
		WillReturnRows(pgxmock.NewRows([]string{"id", "organization_id", "user_id", "role", "created_at", "updated_at"}).
			AddRow(int32(1), int32(6), int32(2), db.OrganizationRoleMEMBER, ts, ts))

	err := ensureSAMLMembership(context.Background(), db.New(mock), 2, workosID)
	assert.NoError(t, err)
}

func TestEnsureSAMLMembership_LookupError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	workosID := "org_err"
	mock.ExpectQuery("SELECT (.+) FROM organizations WHERE workos_organization_id").
		WithArgs(&workosID).
		WillReturnError(errors.New("db down"))

	err := ensureSAMLMembership(context.Background(), db.New(mock), 1, workosID)
	assert.Error(t, err)
}

func TestEnsureSAMLMembership_OrgNotFound(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	workosID := "org_missing"
	mock.ExpectQuery("SELECT (.+) FROM organizations WHERE workos_organization_id").
		WithArgs(&workosID).
		WillReturnError(pgx.ErrNoRows)

	err := ensureSAMLMembership(context.Background(), db.New(mock), 1, workosID)
	assert.ErrorIs(t, err, errSAMLOrgNotFound)
}

func TestEnsureSAMLMembership_SkipsWhenOrgIDZero(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	workosID := "org_zero"
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	mock.ExpectQuery("SELECT (.+) FROM organizations WHERE workos_organization_id").
		WithArgs(&workosID).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "name", "slug", "domain", "created_at", "updated_at", "plan",
			"subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings",
		}).AddRow(
			int32(0), "Org", "org", nil, ts, ts, "free",
			nil, nil, nil, &workosID, false, []byte("{}"),
		))

	err := ensureSAMLMembership(context.Background(), db.New(mock), 1, workosID)
	assert.NoError(t, err)
}

func TestSAMLTransactorUsesInjectedPoolWhenQueriesDBIsNotTransactor(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	original := getSAMLDBPool
	getSAMLDBPool = func(context.Context) (postgres.Transactor, error) {
		return mock, nil
	}
	t.Cleanup(func() { getSAMLDBPool = original })

	transactor, err := samlTransactor(context.Background(), db.New(samlNonTransactorDBTX{}))

	require.NoError(t, err)
	assert.Same(t, mock, transactor)
}

func TestSAMLEmailDomain(t *testing.T) {
	assert.Equal(t, "example.com", samlEmailDomain(" User@Example.COM "))
	assert.Empty(t, samlEmailDomain("not-an-email"))
}

func TestValidateSAMLProfileOrganization(t *testing.T) {
	t.Run("missing domain or organization", func(t *testing.T) {
		err := validateSAMLProfileOrganization(context.Background(), db.New(dbtest.NewMockPool(t)), sso.Profile{
			Email:          "not-an-email",
			OrganizationID: "org_1",
		})

		assert.ErrorIs(t, err, errSAMLEmailOrgMismatch)
	})

	t.Run("organization not found", func(t *testing.T) {
		mock := dbtest.NewMockPool(t)
		domain := "example.com"
		mock.ExpectQuery("SELECT (.+) FROM organizations WHERE domain").
			WithArgs(&domain).
			WillReturnError(pgx.ErrNoRows)

		err := validateSAMLProfileOrganization(context.Background(), db.New(mock), sso.Profile{
			Email:          "user@example.com",
			OrganizationID: "org_1",
		})

		require.ErrorIs(t, err, errSAMLOrgNotFound)
		assert.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("lookup error", func(t *testing.T) {
		mock := dbtest.NewMockPool(t)
		domain := "example.com"
		mock.ExpectQuery("SELECT (.+) FROM organizations WHERE domain").
			WithArgs(&domain).
			WillReturnError(errors.New("db down"))

		err := validateSAMLProfileOrganization(context.Background(), db.New(mock), sso.Profile{
			Email:          "user@example.com",
			OrganizationID: "org_1",
		})

		require.ErrorContains(t, err, "db down")
		assert.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("workos organization mismatch", func(t *testing.T) {
		mock := dbtest.NewMockPool(t)
		expectSAMLDomainOrgRow(mock, "example.com", "org_other", 12)

		err := validateSAMLProfileOrganization(context.Background(), db.New(mock), sso.Profile{
			Email:          "user@example.com",
			OrganizationID: "org_1",
		})

		require.ErrorIs(t, err, errSAMLEmailOrgMismatch)
		assert.NoError(t, mock.ExpectationsWereMet())
	})
}
