package billing

import (
	"context"
	"errors"
	"math"
	"math/big"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPgPaymentsRepository_UpdateCustomerID(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewPaymentsRepository(queries)

	mock.ExpectExec("UPDATE users SET customer_id").
		WithArgs(int32(100), pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	err := repo.UpdateCustomerID(context.Background(), 100, "cus_123")

	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestPgPaymentsRepository_UpdateCustomerID_ExecError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewPaymentsRepository(queries)

	mock.ExpectExec("UPDATE users SET customer_id").
		WithArgs(int32(100), pgxmock.AnyArg()).
		WillReturnError(errors.New("update failed"))

	err := repo.UpdateCustomerID(context.Background(), 100, "cus_123")

	require.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestPgPaymentsRepository_UpdateCustomerID_Overflow(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewPaymentsRepository(queries)

	err := repo.UpdateCustomerID(context.Background(), math.MaxInt32+1, "cus_123")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "exceeds int32 range")
}

func TestPgPaymentsRepository_UpdateCustomerID_Underflow(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewPaymentsRepository(queries)

	err := repo.UpdateCustomerID(context.Background(), math.MinInt32-1, "cus_123")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "exceeds int32 range")
}

func TestPgPaymentsRepository_UpdateSubscription(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewPaymentsRepository(queries)

	status := "active"
	cancelAt := false
	now := time.Now()
	end := now.Add(30 * 24 * time.Hour)

	mock.ExpectExec("UPDATE users SET").
		WithArgs(int32(100), &status, &cancelAt, pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	err := repo.UpdateSubscription(context.Background(), 100, SubscriptionUpdate{
		SubscriptionStatus: &status,
		CancelAtPeriodEnd:  &cancelAt,
		CurrentPeriodStart: &now,
		CurrentPeriodEnd:   &end,
	})

	assert.NoError(t, err)
}

func TestPgPaymentsRepository_UpdateSubscription_ExecError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewPaymentsRepository(queries)

	status := "active"
	mock.ExpectExec("UPDATE users SET subscription_status").
		WithArgs(int32(100), &status, pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnError(errors.New("update failed"))

	err := repo.UpdateSubscription(context.Background(), 100, SubscriptionUpdate{
		SubscriptionStatus: &status,
	})

	require.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestPgPaymentsRepository_UpdateSubscription_NilCancelAtPeriodEndPreserved(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewPaymentsRepository(queries)

	status := "active"
	now := time.Now()
	end := now.Add(30 * 24 * time.Hour)
	var cancelAtPeriodEnd *bool

	mock.ExpectExec("UPDATE users SET").
		WithArgs(int32(100), &status, cancelAtPeriodEnd, pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	err := repo.UpdateSubscription(context.Background(), 100, SubscriptionUpdate{
		SubscriptionStatus: &status,
		CurrentPeriodStart: &now,
		CurrentPeriodEnd:   &end,
	})

	assert.NoError(t, err)
}

func TestPgWebhookRepository_DeleteEvent(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewWebhookRepository(db.New(mock))

	mock.ExpectExec("DELETE FROM webhook_events").
		WithArgs("evt_delete", pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("DELETE", 1))

	assert.NoError(t, repo.DeleteEvent(context.Background(), "evt_delete", "claim-delete"))
}

func TestPgWebhookRepository_CompleteEvent(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	repo := NewWebhookRepository(db.New(mock))

	mock.ExpectExec("UPDATE webhook_events").
		WithArgs("evt_complete", pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	assert.NoError(t, repo.CompleteEvent(context.Background(), "evt_complete", "claim-complete"))
}

func TestPgWebhookRepository_CompleteEvent_Error(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	repo := NewWebhookRepository(db.New(mock))

	mock.ExpectExec("UPDATE webhook_events").
		WithArgs("evt_complete", pgxmock.AnyArg()).
		WillReturnError(errors.New("complete failed"))

	assert.Error(t, repo.CompleteEvent(context.Background(), "evt_complete", "claim-complete"))
}

func TestPgWebhookRepository_DeleteEvent_Error(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewWebhookRepository(db.New(mock))

	mock.ExpectExec("DELETE FROM webhook_events").
		WithArgs("evt_delete", pgxmock.AnyArg()).
		WillReturnError(errors.New("delete failed"))

	assert.Error(t, repo.DeleteEvent(context.Background(), "evt_delete", "claim-delete"))
}

func TestPgWebhookRepository_RejectsLostClaim(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	repo := NewWebhookRepository(db.New(mock))

	mock.ExpectExec("UPDATE webhook_events").
		WithArgs("evt_complete", pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 0))
	mock.ExpectExec("DELETE FROM webhook_events").
		WithArgs("evt_delete", pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("DELETE", 0))

	require.ErrorContains(
		t,
		repo.CompleteEvent(context.Background(), "evt_complete", "stale-claim"),
		"claim lost",
	)
	require.ErrorContains(
		t,
		repo.DeleteEvent(context.Background(), "evt_delete", "stale-claim"),
		"claim lost",
	)
}

func TestPgWebhookRepository_FindUserByCustomerID(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewWebhookRepository(queries)

	customerID := "cus_123"

	mock.ExpectQuery("SELECT (.+) FROM users WHERE customer_id").
		WithArgs(&customerID).
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID:               100,
			Email:            "test@example.com",
			Plan:             "pro",
			APITier:          db.DeveloperApiTier("starter"),
			APIRequestsLimit: 100,
			Billing: &dbtest.UserBilling{
				CustomerID:    &customerID,
				CreditBalance: pgtype.Numeric{Int: big.NewInt(0), Valid: true},
			},
		}))

	user, err := repo.FindUserByCustomerID(context.Background(), customerID)

	require.NoError(t, err)
	require.NotNil(t, user)
	assert.Equal(t, 100, user.ID)
}

func TestPgWebhookRepository_FindUserByCustomerID_Error(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewWebhookRepository(db.New(mock))

	customerID := "cus_err"
	mock.ExpectQuery("SELECT (.+) FROM users WHERE customer_id").
		WithArgs(&customerID).
		WillReturnError(errors.New("db error"))

	user, err := repo.FindUserByCustomerID(context.Background(), customerID)

	require.Error(t, err)
	assert.Nil(t, user)
}

func TestPgWebhookRepository_FindUserByCustomerID_NotFound(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewWebhookRepository(queries)

	customerID := "nonexistent"

	mock.ExpectQuery("SELECT (.+) FROM users WHERE customer_id").
		WithArgs(&customerID).
		WillReturnError(pgx.ErrNoRows)

	user, err := repo.FindUserByCustomerID(context.Background(), customerID)

	require.ErrorIs(t, err, ErrBillingUserNotFound)
	assert.Nil(t, user)
}

func TestPgWebhookRepository_FindUserByID(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewWebhookRepository(queries)

	customerID := "cus_123"

	mock.ExpectQuery("SELECT (.+) FROM users WHERE id").
		WithArgs(int32(100)).
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID:               100,
			Email:            "test@example.com",
			Plan:             "pro",
			APITier:          db.DeveloperApiTier("starter"),
			APIRequestsLimit: 100,
			Billing: &dbtest.UserBilling{
				CustomerID:    &customerID,
				CreditBalance: pgtype.Numeric{Int: big.NewInt(0), Valid: true},
			},
		}))

	user, err := repo.FindUserByID(context.Background(), 100)

	require.NoError(t, err)
	require.NotNil(t, user)
	assert.Equal(t, 100, user.ID)
	assert.Equal(t, "test@example.com", user.Email)
	assert.Equal(t, &customerID, user.CustomerID)
}

func TestPgWebhookRepository_FindUserByID_DBError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewWebhookRepository(db.New(mock))

	mock.ExpectQuery("SELECT (.+) FROM users WHERE id").
		WithArgs(int32(100)).
		WillReturnError(errors.New("db error"))

	user, err := repo.FindUserByID(context.Background(), 100)

	require.Error(t, err)
	assert.Nil(t, user)
}

func TestPgWebhookRepository_FindUserByID_NotFound(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewWebhookRepository(queries)

	mock.ExpectQuery("SELECT (.+) FROM users WHERE id").
		WithArgs(int32(999)).
		WillReturnError(pgx.ErrNoRows)

	user, err := repo.FindUserByID(context.Background(), 999)

	require.ErrorIs(t, err, ErrBillingUserNotFound)
	assert.Nil(t, user)
}

func TestPgWebhookRepository_FindUserByID_Overflow(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewWebhookRepository(queries)

	_, err := repo.FindUserByID(context.Background(), math.MaxInt32+1)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "exceeds int32 range")
}

func TestPgWebhookRepository_FindUserByID_Underflow(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewWebhookRepository(queries)

	_, err := repo.FindUserByID(context.Background(), math.MinInt32-1)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "exceeds int32 range")
}

func TestPgWebhookRepository_HasProcessedEvent(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewWebhookRepository(queries)

	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("evt_123").
		WillReturnRows(pgxmock.NewRows([]string{"exists"}).AddRow(true))

	exists, err := repo.HasProcessedEvent(context.Background(), "evt_123")

	require.NoError(t, err)
	assert.True(t, exists)
}

func TestPgWebhookRepository_HasProcessedEvent_Error(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewWebhookRepository(db.New(mock))

	mock.ExpectQuery("SELECT EXISTS").
		WithArgs("evt_err").
		WillReturnError(errors.New("db unavailable"))

	exists, err := repo.HasProcessedEvent(context.Background(), "evt_err")

	require.Error(t, err)
	assert.False(t, exists)
}

func TestPgWebhookRepository_RecordEvent(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewWebhookRepository(queries)

	mock.ExpectExec("INSERT INTO webhook_events").
		WithArgs("evt_123", "checkout.session.completed", pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	claim, err := repo.RecordEvent(context.Background(), "evt_123", "checkout.session.completed")

	require.NoError(t, err)
	assert.NotEmpty(t, claim)
}

func TestPgWebhookRepository_RecordEvent_Error(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewWebhookRepository(db.New(mock))

	mock.ExpectExec("INSERT INTO webhook_events").
		WithArgs("evt_err", "checkout.session.completed", pgxmock.AnyArg()).
		WillReturnError(errors.New("insert failed"))

	claim, err := repo.RecordEvent(context.Background(), "evt_err", "checkout.session.completed")

	require.Error(t, err)
	assert.Empty(t, claim)
}

func TestPgWebhookRepository_RecordEvent_NoRowsAffected(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewWebhookRepository(db.New(mock))

	mock.ExpectExec("INSERT INTO webhook_events").
		WithArgs("evt_dup", "checkout.session.completed", pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("INSERT", 0))

	claim, err := repo.RecordEvent(context.Background(), "evt_dup", "checkout.session.completed")

	require.NoError(t, err)
	assert.Empty(t, claim)
}

func TestPgWebhookRepository_UpdateUser(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewWebhookRepository(queries)

	subID := "sub_123"
	status := "active"
	plan := "pro"
	cancelAt := false
	now := time.Now()

	// UpdateUserWebhookFull arguments:
	// 1: ID, 2: SubID, 3: SubStatus, 4: SubSource, 5: PeriodStart, 6: PeriodEnd,
	// 7: CancelAtPeriodEnd, 8: StripeEventCreatedAt, 9: CustomerID, 10: Plan,
	// 11: PriceID, 12: PMBrand, 13: PMLast4
	mock.ExpectExec(`(?s)UPDATE users SET.*stripe_subscription_event_created_at < \$8`).
		WithArgs(
			int32(100), &subID, &status, pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
			&cancelAt, pgxmock.AnyArg(), pgxmock.AnyArg(), &plan, pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
		).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	err := repo.UpdateUser(context.Background(), 100, WebhookUserUpdate{
		SubscriptionID:     &subID,
		SubscriptionStatus: &status,
		Plan:               &plan,
		CancelAtPeriodEnd:  &cancelAt,
		CurrentPeriodStart: &now,
		CurrentPeriodEnd:   &now,
	})

	assert.NoError(t, err)
}

func TestPgWebhookRepository_UpdateUser_ClearSubscription(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewWebhookRepository(queries)

	plan := "free"

	mock.ExpectExec(`(?s)UPDATE users SET.*stripe_subscription_event_created_at <= \$2`).
		WithArgs(int32(100), pgxmock.AnyArg(), &plan).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	err := repo.UpdateUser(context.Background(), 100, WebhookUserUpdate{
		ClearSubscription: true,
		Plan:              &plan,
	})

	assert.NoError(t, err)
}

func TestPgWebhookRepository_UpdateUser_ClearSubscriptionError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewWebhookRepository(db.New(mock))

	plan := "free"
	mock.ExpectExec("UPDATE users SET").
		WithArgs(int32(100), pgxmock.AnyArg(), &plan).
		WillReturnError(errors.New("reset failed"))

	err := repo.UpdateUser(context.Background(), 100, WebhookUserUpdate{
		ClearSubscription: true,
		Plan:              &plan,
	})

	assert.Error(t, err)
}

func TestPgWebhookRepository_UpdateUser_NonClearExecError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewWebhookRepository(db.New(mock))

	plan := "pro"
	mock.ExpectExec("UPDATE users SET").
		WillReturnError(errors.New("update failed"))

	err := repo.UpdateUser(context.Background(), 100, WebhookUserUpdate{
		Plan: &plan,
	})

	assert.Error(t, err)
}

func TestPgWebhookRepository_UpdateUser_Overflow(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewWebhookRepository(queries)

	err := repo.UpdateUser(context.Background(), math.MaxInt32+1, WebhookUserUpdate{})

	require.Error(t, err)
	assert.Contains(t, err.Error(), "exceeds int32 range")
}

func TestPgWebhookRepository_UpdateUser_Underflow(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewWebhookRepository(queries)

	err := repo.UpdateUser(context.Background(), math.MinInt32-1, WebhookUserUpdate{})

	require.Error(t, err)
	assert.Contains(t, err.Error(), "exceeds int32 range")
}
