package auth

import (
	"context"
	"math"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewRepositories(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	q := db.New(mock)

	assert.NotNil(t, NewAuthUserRepository(q))
	assert.NotNil(t, NewAuthUserRepository(q).(LoginRepository))
	assert.NotNil(t, NewRegisterRepository(q))
	assert.NotNil(t, NewDeviceLoginRepository(q))
	assert.NotNil(t, NewAccountRepository(q))
	assert.NotNil(t, NewAuditLogRepository(q))
}

func TestMarkDeviceLoginAsCompleted(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	q := db.New(mock)
	repo := &PgAuthRepository{q: q}

	mock.ExpectExec(`UPDATE device_logins`).
		WithArgs(int32(10), pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	ok, err := repo.MarkDeviceLoginAsCompleted(context.Background(), 10)
	require.NoError(t, err)
	assert.True(t, ok)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestMarkDeviceLoginAsCompleted_AlreadyCompleted(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	q := db.New(mock)
	repo := &PgAuthRepository{q: q}

	mock.ExpectExec(`UPDATE device_logins`).
		WithArgs(int32(10), pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 0))

	ok, err := repo.MarkDeviceLoginAsCompleted(context.Background(), 10)
	require.NoError(t, err)
	assert.False(t, ok)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestMarkDeviceLoginAsCompleted_InvalidID(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	repo := &PgAuthRepository{q: db.New(mock)}

	ok, err := repo.MarkDeviceLoginAsCompleted(context.Background(), math.MaxInt32+1)
	require.Error(t, err)
	assert.False(t, ok)
}

func TestMapDbDeviceLogin(t *testing.T) {
	now := time.Now()
	userID := int32(42)
	record := mapDbDeviceLogin(&db.DeviceLogin{
		ID:           7,
		DeviceCode:   "device",
		UserCode:     "user",
		Status:       db.DeviceLoginsStatusPENDING,
		ExpiresAt:    pgtype.Timestamp{Time: now, Valid: true},
		PollInterval: 5,
		UserID:       &userID,
		AuthorizedAt: pgtype.Timestamp{Valid: false},
		LastPolledAt: pgtype.Timestamp{Time: now, Valid: true},
		CompletedAt:  pgtype.Timestamp{Valid: false},
	})

	if assert.NotNil(t, record) {
		assert.Equal(t, 7, record.ID)
		assert.Equal(t, "device", record.DeviceCode)
		assert.Equal(t, "user", record.UserCode)
		assert.Equal(t, DeviceLoginStatus("PENDING"), record.Status)
		assert.Equal(t, 5, record.PollInterval)
		if assert.NotNil(t, record.UserID) {
			assert.Equal(t, 42, *record.UserID)
		}
		assert.NotNil(t, record.LastPolledAt)
		assert.Nil(t, record.AuthorizedAt)
		assert.Nil(t, record.CompletedAt)
	}
}

func TestMapDbUserToAuthUser_AllFields(t *testing.T) {
	fullName := "User Name"
	subID := "sub_123"
	customerID := "cus_123"
	source := db.SubscriptionSourceSTRIPE
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}

	user := mapDbUserToAuthUser(&db.User{
		ID:                   42,
		Email:                "user@example.com",
		FullName:             &fullName,
		Disabled:             true,
		ThemePreference:      "dark",
		MemoryEnabled:        true,
		WebSearchEnabled:     true,
		CodeExecutionEnabled: true,
		NotificationsEnabled: true,
		TrustLayerEnabled:    true,
		QuickModeEnabled:     true,
		Plan:                 "pro",
		MessageCount:         7,
		LastMessageTimestamp: ts,
		IsAdmin:              true,
		SubscriptionID:       &subID,
		SubscriptionStatus:   new("active"),
		SubscriptionSource:   &source,
		CustomerID:           &customerID,
		CancelAtPeriodEnd:    true,
	})

	assert.Equal(t, 42, user.ID)
	assert.Equal(t, "user@example.com", user.Email)
	assert.Equal(t, &fullName, user.FullName)
	assert.True(t, user.Disabled)
	assert.Equal(t, "dark", *user.ThemePreference)
	assert.True(t, user.MemoryEnabled)
	assert.True(t, user.WebSearchEnabled)
	assert.True(t, user.CodeExecutionEnabled)
	assert.True(t, user.NotificationsEnabled)
	assert.True(t, user.TrustLayerEnabled)
	assert.True(t, user.QuickModeEnabled)
	assert.Equal(t, "pro", *user.Plan)
	assert.Equal(t, 7, *user.MessageCount)
	assert.NotNil(t, user.LastMessageTimestamp)
	assert.True(t, user.IsAdmin)
	assert.Equal(t, &subID, user.SubscriptionID)
	assert.Equal(t, "active", *user.SubscriptionStatus)
	assert.Equal(t, "STRIPE", *user.SubscriptionSource)
	assert.Equal(t, &customerID, user.CustomerID)
	assert.True(t, user.CancelAtPeriodEnd)
}

func TestMapDbAccount_AllFields(t *testing.T) {
	refresh := "refresh"
	access := "access"
	expires := int32(123)
	tokenType := "bearer"
	scope := "openid"
	idToken := "id"
	sessionState := "state"

	account := mapDbAccount(&db.Account{
		ID:                "acc_1",
		UserID:            7,
		Type:              "oauth",
		Provider:          "workos",
		Provideraccountid: "acct",
		RefreshToken:      &refresh,
		AccessToken:       &access,
		ExpiresAt:         &expires,
		TokenType:         &tokenType,
		Scope:             &scope,
		IDToken:           &idToken,
		SessionState:      &sessionState,
	})

	assert.Equal(t, "acc_1", account.ID)
	assert.Equal(t, 7, account.UserID)
	assert.Equal(t, "oauth", account.Type)
	assert.Equal(t, "workos", account.Provider)
	assert.Equal(t, "acct", account.ProviderAccountID)
	assert.Nil(t, account.RefreshToken)
	assert.Nil(t, account.AccessToken)
	assert.Equal(t, 123, *account.ExpiresAt)
	assert.Equal(t, &tokenType, account.TokenType)
	assert.Equal(t, &scope, account.Scope)
	assert.Nil(t, account.IDToken)
	assert.Equal(t, &sessionState, account.SessionState)
}

//go:fix inline

func TestCreateAuditLog(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	q := db.New(mock)
	repo := &PgAuthRepository{q: q}

	columns := []string{"id", "timestamp", "user_id", "organization_id", "action", "resource", "resource_id", "ip_address", "user_agent", "details", "success", "error_message"}
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	mock.ExpectQuery(`INSERT INTO audit_logs`).
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), "LOGIN", "user", pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), true, pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(columns).AddRow(
			int32(1), ts, nil, nil, "LOGIN", "user", nil, nil, nil, []byte(`{"email":"us***@example.com"}`), true, nil,
		))

	err := repo.CreateAuditLog(context.Background(), AuditLogWrite{
		Action:   "LOGIN",
		Resource: "user",
		Details:  map[string]any{"email": "user@example.com"},
		Success:  true,
	})
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}
