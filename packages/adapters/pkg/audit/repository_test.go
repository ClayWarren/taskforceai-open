package audit

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPgAuditLogRepository_Create(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewAuditLogRepository(db.New(mock))

	uid := "user-1"
	oid := int32(1)

	mock.ExpectQuery("INSERT INTO audit_logs").
		WithArgs(
			&uid,
			&oid,
			"login",
			"user",
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			true,
			pgxmock.AnyArg(),
		).
		WillReturnRows(dbtest.AuditLogRow(dbtest.AuditLog{UserID: &uid, OrganizationID: &oid, Action: "login", Success: true}))

	err := repo.Create(context.Background(), AuditLogWrite{
		UserID:         &uid,
		OrganizationID: &oid,
		Action:         "login",
		Resource:       "user",
		Success:        true,
	})

	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestPgAuditLogRepository_CreateFallsBackForUnmarshalableDetails(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	repo := NewAuditLogRepository(db.New(mock))

	mock.ExpectQuery("INSERT INTO audit_logs").
		WithArgs(
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			"login",
			"user",
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			[]byte("{}"),
			true,
			pgxmock.AnyArg(),
		).
		WillReturnRows(dbtest.AuditLogRow(dbtest.AuditLog{Action: "login", Success: true}))

	err := repo.Create(context.Background(), AuditLogWrite{
		Action:   "login",
		Resource: "user",
		Details:  map[string]any{"bad": func() {}},
		Success:  true,
	})

	require.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestPgAuditLogRepository_CreateMany(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewAuditLogRepository(db.New(mock))

	uid := "user-1"

	mock.ExpectExec("INSERT INTO audit_logs").
		WithArgs(
			&uid, pgxmock.AnyArg(), "login", "user", pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), true, pgxmock.AnyArg(),
			&uid, pgxmock.AnyArg(), "logout", "user", pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), true, pgxmock.AnyArg(),
		).
		WillReturnResult(pgconn.NewCommandTag("INSERT 0 2"))

	err := repo.CreateMany(context.Background(), []AuditLogWrite{
		{UserID: &uid, Action: "login", Resource: "user", Success: true},
		{UserID: &uid, Action: "logout", Resource: "user", Success: true},
	})

	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestPgAuditLogRepository_CreateManyEmptyIsNoop(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	repo := NewAuditLogRepository(db.New(mock))

	require.NoError(t, repo.CreateMany(context.Background(), nil))
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestPgAuditLogRepository_CreateManyFallsBackForUnmarshalableDetails(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	repo := NewAuditLogRepository(db.New(mock))

	mock.ExpectExec("INSERT INTO audit_logs").
		WithArgs(
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			"login",
			"user",
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			[]byte("{}"),
			true,
			pgxmock.AnyArg(),
		).
		WillReturnResult(pgconn.NewCommandTag("INSERT 0 1"))

	err := repo.CreateMany(context.Background(), []AuditLogWrite{{
		Action:   "login",
		Resource: "user",
		Details:  map[string]any{"bad": func() {}},
		Success:  true,
	}})

	require.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestPgAuditLogRepository_FindByUser(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewAuditLogRepository(db.New(mock))

	uid := "user-1"

	mock.ExpectQuery("SELECT (.+) FROM audit_logs WHERE user_id").
		WithArgs(&uid, int32(10)).
		WillReturnRows(dbtest.AuditLogRow(dbtest.AuditLog{UserID: &uid, Action: "LOGIN", Success: true}))

	logs, err := repo.FindByUser(context.Background(), uid, 10)

	require.NoError(t, err)
	assert.Len(t, logs, 1)
	assert.Equal(t, "LOGIN", logs[0].Action)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestPgAuditLogRepository_FindByOrganization(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewAuditLogRepository(db.New(mock))

	oid := int32(1)

	mock.ExpectQuery("SELECT (.+) FROM audit_logs WHERE organization_id").
		WithArgs(&oid, int32(10)).
		WillReturnRows(dbtest.AuditLogRow(dbtest.AuditLog{OrganizationID: &oid, Action: "LOGIN", Success: true}))

	logs, err := repo.FindByOrganization(context.Background(), oid, 10)

	require.NoError(t, err)
	assert.Len(t, logs, 1)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestPgAuditLogRepository_FindByResource(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewAuditLogRepository(db.New(mock))

	res := "user"
	resID := "user-1"

	mock.ExpectQuery("SELECT (.+) FROM audit_logs WHERE resource = (.+) AND resource_id").
		WithArgs(res, &resID, int32(10)).
		WillReturnRows(dbtest.AuditLogRow(dbtest.AuditLog{Action: "LOGIN", Resource: res, ResourceID: &resID, Success: true}))

	logs, err := repo.FindByResource(context.Background(), res, resID, 10)

	require.NoError(t, err)
	assert.Len(t, logs, 1)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestPgAuditLogRepository_FindFailedLoginAttempts(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewAuditLogRepository(db.New(mock))

	mock.ExpectQuery("SELECT (.+) FROM audit_logs WHERE action = 'LOGIN' AND success = false").
		WithArgs(24, int32(10)).
		WillReturnRows(dbtest.AuditLogRow(dbtest.AuditLog{Action: "LOGIN", Success: false}))

	logs, err := repo.FindFailedLoginAttempts(context.Background(), 24, 10)

	require.NoError(t, err)
	assert.Len(t, logs, 1)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestPgAuditLogRepository_FindForPeriod(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewAuditLogRepository(db.New(mock))

	start := time.Now().Add(-24 * time.Hour)
	end := time.Now()
	actions := []string{"LOGIN", "LOGOUT"}

	mock.ExpectQuery("SELECT (.+) FROM audit_logs WHERE timestamp >= (.+) AND timestamp <= (.+) AND action = ANY").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), actions).
		WillReturnRows(dbtest.AuditLogRow(dbtest.AuditLog{Action: "LOGIN", Success: true}))

	logs, err := repo.FindForPeriod(context.Background(), start, end, actions)

	require.NoError(t, err)
	assert.Len(t, logs, 1)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestMapDbAuditLog(t *testing.T) {
	uid := "user-1"
	oid := int32(1)
	now := time.Now()

	logs := []db.AuditLog{
		{
			ID:             1,
			Timestamp:      pgtype.Timestamp{Time: now, Valid: true},
			UserID:         &uid,
			OrganizationID: &oid,
			Action:         "LOGIN",
			Resource:       "user",
			Success:        true,
		},
	}

	records := mapDbAuditLogs(logs)

	assert.Len(t, records, 1)
	assert.Equal(t, 1, records[0].ID)
	assert.Equal(t, "LOGIN", records[0].Action)
	assert.Equal(t, &uid, records[0].UserID)
	assert.Equal(t, &oid, records[0].OrganizationID)
}

func TestMapDbAuditLogHandlesDetailsAndOptionalFields(t *testing.T) {
	uid := "user-1"
	oid := int32(42)
	resourceID := "resource-1"
	ipAddress := "127.0.0.1"
	userAgent := "test-agent"
	errorMessage := "denied"
	now := time.Date(2026, 5, 21, 12, 0, 0, 0, time.UTC)

	record := mapDbAuditLog(&db.AuditLog{
		ID:             7,
		Timestamp:      pgtype.Timestamp{Time: now, Valid: true},
		UserID:         &uid,
		OrganizationID: &oid,
		Action:         "LOGIN",
		Resource:       "session",
		ResourceID:     &resourceID,
		IpAddress:      &ipAddress,
		UserAgent:      &userAgent,
		Details:        []byte(`{"reason":"mfa"}`),
		Success:        false,
		ErrorMessage:   &errorMessage,
	})

	assert.Equal(t, 7, record.ID)
	assert.Equal(t, now, record.Timestamp)
	assert.Equal(t, &uid, record.UserID)
	assert.Equal(t, &oid, record.OrganizationID)
	assert.Equal(t, &resourceID, record.ResourceID)
	assert.Equal(t, &ipAddress, record.IPAddress)
	assert.Equal(t, &userAgent, record.UserAgent)
	assert.Equal(t, &errorMessage, record.ErrorMessage)
	assert.False(t, record.Success)

	details, ok := record.Details.(map[string]any)
	if !ok {
		t.Fatalf("expected details map, got %#v", record.Details)
	}
	assert.Equal(t, "mfa", details["reason"])
}

func TestMapDbAuditLogHandlesInvalidDetails(t *testing.T) {
	record := mapDbAuditLog(&db.AuditLog{
		ID:       8,
		Action:   "LOGIN",
		Resource: "session",
		Details:  []byte(`{`),
		Success:  true,
	})

	assert.True(t, record.Timestamp.IsZero())
	assert.Nil(t, record.Details)
}

func TestMarshalAuditDetailsFallbackAndAuditLimitBounds(t *testing.T) {
	got, err := marshalAuditDetails(AuditLogWrite{Details: map[string]any{"bad": func() {}}})
	require.Error(t, err)
	assert.Equal(t, []byte("{}"), got)

	got, err = marshalAuditDetails(AuditLogWrite{Details: map[string]any{"ok": true}})
	require.NoError(t, err)
	assert.JSONEq(t, `{"ok":true}`, string(got))

	assert.Equal(t, int32(0), auditLimit(-1))
	assert.Equal(t, int32(math.MaxInt32), auditLimit(math.MaxInt32+1))
	assert.Equal(t, int32(25), auditLimit(25))
}

func TestPgAuditLogRepository_CreateError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewAuditLogRepository(db.New(mock))
	mock.ExpectQuery("INSERT INTO audit_logs").
		WithArgs(
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			true,
			pgxmock.AnyArg(),
		).
		WillReturnError(errors.New("insert failed"))

	err := repo.Create(context.Background(), AuditLogWrite{
		Action:   "login",
		Resource: "user",
		Success:  true,
	})
	require.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestPgAuditLogRepository_CreateManyPartialFailure(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewAuditLogRepository(db.New(mock))
	mock.ExpectExec("INSERT INTO audit_logs").
		WithArgs(
			pgxmock.AnyArg(), pgxmock.AnyArg(), "login", "user", pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), true, pgxmock.AnyArg(),
			pgxmock.AnyArg(), pgxmock.AnyArg(), "logout", "user", pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), true, pgxmock.AnyArg(),
		).
		WillReturnError(errors.New("batch insert failed"))

	err := repo.CreateMany(context.Background(), []AuditLogWrite{
		{Action: "login", Resource: "user", Success: true},
		{Action: "logout", Resource: "user", Success: true},
	})
	require.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestPgAuditLogRepository_FindMethodsReturnErrors(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewAuditLogRepository(db.New(mock))
	uid := "user-1"
	orgID := int32(1)
	resID := "user-1"

	mock.ExpectQuery("SELECT (.+) FROM audit_logs WHERE user_id").
		WithArgs(&uid, int32(10)).
		WillReturnError(errors.New("user query failed"))
	_, err := repo.FindByUser(context.Background(), uid, 10)
	require.Error(t, err)

	mock.ExpectQuery("SELECT (.+) FROM audit_logs WHERE organization_id").
		WithArgs(&orgID, int32(10)).
		WillReturnError(errors.New("org query failed"))
	_, err = repo.FindByOrganization(context.Background(), orgID, 10)
	require.Error(t, err)

	mock.ExpectQuery("SELECT (.+) FROM audit_logs WHERE resource = (.+) AND resource_id").
		WithArgs("user", &resID, int32(10)).
		WillReturnError(errors.New("resource query failed"))
	_, err = repo.FindByResource(context.Background(), "user", resID, 10)
	require.Error(t, err)

	mock.ExpectQuery("SELECT (.+) FROM audit_logs WHERE action = 'LOGIN' AND success = false").
		WithArgs(24, int32(10)).
		WillReturnError(errors.New("failed login query failed"))
	_, err = repo.FindFailedLoginAttempts(context.Background(), 24, 10)
	require.Error(t, err)

	mock.ExpectQuery("SELECT (.+) FROM audit_logs WHERE timestamp >= (.+) AND timestamp <= (.+) AND action = ANY").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), []string{"LOGIN"}).
		WillReturnError(errors.New("period query failed"))
	_, err = repo.FindForPeriod(context.Background(), time.Now().Add(-time.Hour), time.Now(), []string{"LOGIN"})
	require.Error(t, err)

	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestPgAuditLogRepository_CapsTakeValues(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewAuditLogRepository(db.New(mock))
	uid := "user-1"

	mock.ExpectQuery("SELECT (.+) FROM audit_logs WHERE user_id").
		WithArgs(&uid, int32(math.MaxInt32)).
		WillReturnRows(pgxmock.NewRows(dbtest.AuditLogColumns()))

	_, err := repo.FindByUser(context.Background(), uid, math.MaxInt32+1)
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}
