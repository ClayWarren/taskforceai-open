package billing

import (
	"context"
	"errors"
	"math"
	"math/big"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/account"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func userColumns() []string {
	return dbtest.UserColumns()
}

func TestFloat64ToNumeric(t *testing.T) {
	n := float64ToNumeric(12.34)
	assert.True(t, n.Valid)

	nilNumeric := float64PtrToNumeric(nil)
	assert.False(t, nilNumeric.Valid)
}

func TestFloat64ToNumericRejectsOutOfRange(t *testing.T) {
	assert.False(t, float64ToNumeric(math.Inf(1)).Valid)
	assert.False(t, float64ToNumeric(math.NaN()).Valid)
	assert.False(t, float64ToNumeric(float64(math.MaxInt64)).Valid)
}

func TestToNullSubscriptionSource(t *testing.T) {
	assert.Nil(t, toNullSubscriptionSource(nil))

	source := SourceAppStore
	dbSource := toNullSubscriptionSource(&source)

	require.NotNil(t, dbSource)
	assert.Equal(t, db.SubscriptionSource(SourceAppStore), *dbSource)
}

func TestMapBillingUserToMobileSyncUser(t *testing.T) {
	appUserID := "rcapp_123"
	subID := "sub_123"
	status := "active"
	now := time.Now()

	periodEnd := now.Add(30 * 24 * time.Hour)
	source := "mobile"
	user := account.User{
		ID:                  100,
		Email:               "test@example.com",
		RevenueCatAppUserID: &appUserID,
		Plan:                "pro",
		SubscriptionID:      &subID,
		SubscriptionStatus:  &status,
		CurrentPeriodStart:  &now,
		CurrentPeriodEnd:    &periodEnd,
		SubscriptionSource:  &source,
	}

	mobileUser := mapBillingUserToMobileSyncUser(user)

	assert.Equal(t, 100, mobileUser.ID)
	assert.Equal(t, "test@example.com", mobileUser.Email)
	assert.Equal(t, &appUserID, mobileUser.RevenueCatAppUserID)
	assert.Equal(t, "pro", mobileUser.Plan)
	assert.NotNil(t, mobileUser.SubscriptionSource)
	assert.NotNil(t, mobileUser.CurrentPeriodStart)
	assert.NotNil(t, mobileUser.CurrentPeriodEnd)
}

func TestMapBillingUserToWebhookUser(t *testing.T) {
	customerID := "cus_123"
	subscriptionID := "sub_123"
	user := account.User{
		ID:             100,
		Email:          "test@example.com",
		Plan:           "pro",
		CustomerID:     &customerID,
		SubscriptionID: &subscriptionID,
	}

	webhookUser := mapBillingUserToWebhookUser(user)

	assert.Equal(t, 100, webhookUser.ID)
	assert.Equal(t, "test@example.com", webhookUser.Email)
	assert.Equal(t, &customerID, webhookUser.CustomerID)
	assert.Equal(t, &subscriptionID, webhookUser.SubscriptionID)
}

func sampleBillingUserRow() []any {
	const id int32 = 100
	const email = "billing@example.com"
	customerID := "cus_123"
	subID := "sub_123"
	status := "active"
	brand := "visa"
	last4 := "4242"
	source := db.SubscriptionSourceSTRIPE
	now := time.Now()
	return dbtest.UserValues(dbtest.User{
		ID: id, Email: email, Plan: "pro",
		APITier: db.DeveloperApiTier("starter"), APIRequestsLimit: 100,
		Billing: &dbtest.UserBilling{
			SubscriptionID:        &subID,
			SubscriptionStatus:    &status,
			SubscriptionSource:    &source,
			PaymentMethodBrand:    &brand,
			PaymentMethodLast4:    &last4,
			CurrentPeriodStart:    pgtype.Timestamp{Time: now, Valid: true},
			CurrentPeriodEnd:      pgtype.Timestamp{Time: now.Add(30 * 24 * time.Hour), Valid: true},
			CustomerID:            &customerID,
			CreditBalance:         pgtype.Numeric{Int: big.NewInt(1250), Exp: -2, Valid: true},
			AutoRechargeEnabled:   true,
			AutoRechargeAmount:    pgtype.Numeric{Int: big.NewInt(1000), Exp: -2, Valid: true},
			AutoRechargeThreshold: pgtype.Numeric{Int: big.NewInt(500), Exp: -2, Valid: true},
		},
	})
}

func mobileBillingUserRow(plan string, appUserID *string) []any {
	values := dbtest.UserValues(dbtest.User{
		ID:               100,
		Email:            "test@example.com",
		Plan:             plan,
		Baseline:         dbtest.BaselineBilling,
		APITier:          db.DeveloperApiTier("starter"),
		APIRequestsLimit: 100,
		Billing: &dbtest.UserBilling{
			CreditBalance: pgtype.Numeric{Int: big.NewInt(0), Valid: true},
		},
	})
	for idx, column := range userColumns() {
		if column == "revenuecat_app_user_id" {
			values[idx] = appUserID
			return values
		}
	}
	panic("revenuecat_app_user_id column missing from user columns")
}

func TestNewAccountSettingsRepository(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewAccountSettingsRepository(db.New(mock))
	assert.NotNil(t, repo)
}

func TestPgAccountSettingsRepository_UpdateAutoRecharge(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewAccountSettingsRepository(db.New(mock))

	amount := 10.0
	threshold := 5.0
	mock.ExpectExec("UPDATE users SET auto_recharge_enabled").
		WithArgs(int32(100), true, pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	err := repo.UpdateAutoRecharge(context.Background(), 100, AutoRechargeUpdate{
		Enabled:   true,
		Amount:    &amount,
		Threshold: &threshold,
	})

	assert.NoError(t, err)
}

func TestPgAccountSettingsRepository_UpdateAutoRecharge_NilPointers(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewAccountSettingsRepository(db.New(mock))

	mock.ExpectExec("UPDATE users SET auto_recharge_enabled").
		WithArgs(int32(100), false, pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	err := repo.UpdateAutoRecharge(context.Background(), 100, AutoRechargeUpdate{
		Enabled: false,
	})

	assert.NoError(t, err)
}

func TestPgAccountSettingsRepository_UpdateAutoRecharge_Overflow(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewAccountSettingsRepository(db.New(mock))

	err := repo.UpdateAutoRecharge(context.Background(), math.MaxInt32+1, AutoRechargeUpdate{Enabled: true})

	require.Error(t, err)
	assert.Contains(t, err.Error(), "exceeds int32 range")
}

func TestPgPaymentsRepository_UpdateSubscription_Overflow(t *testing.T) {
	repo := NewPaymentsRepository(db.New(nil))

	err := repo.UpdateSubscription(context.Background(), math.MaxInt32+1, SubscriptionUpdate{})

	require.Error(t, err)
	assert.Contains(t, err.Error(), "exceeds int32 range")
}

func TestPgMobileSubscriptionRepository_FindUserByAppUserID(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewMobileSubscriptionRepository(queries)

	appUserID := "rcapp_123"

	mock.ExpectQuery("SELECT (.+) FROM users WHERE revenuecat_app_user_id").
		WithArgs(&appUserID).
		WillReturnRows(pgxmock.NewRows(userColumns()).AddRow(mobileBillingUserRow("pro", &appUserID)...))

	user, err := repo.FindUserByAppUserID(context.Background(), appUserID)

	require.NoError(t, err)
	require.NotNil(t, user)
	assert.Equal(t, &appUserID, user.RevenueCatAppUserID)
}

func TestPgMobileSubscriptionRepository_FindUserByAppUserID_Error(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewMobileSubscriptionRepository(queries)

	appUserID := "error"
	mock.ExpectQuery("SELECT .* FROM users WHERE revenuecat_app_user_id").
		WithArgs(&appUserID).
		WillReturnError(errors.New("db error"))

	_, err := repo.FindUserByAppUserID(context.Background(), appUserID)

	assert.Error(t, err)
}

func TestPgMobileSubscriptionRepository_FindUserByAppUserID_NotFound(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewMobileSubscriptionRepository(queries)

	appUserID := "nonexistent"
	mock.ExpectQuery("SELECT .* FROM users WHERE revenuecat_app_user_id").
		WithArgs(&appUserID).
		WillReturnError(pgx.ErrNoRows)

	user, err := repo.FindUserByAppUserID(context.Background(), appUserID)

	require.ErrorIs(t, err, ErrBillingUserNotFound)
	assert.Nil(t, user)
}

func TestPgMobileSubscriptionRepository_FindUserByID(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewMobileSubscriptionRepository(queries)

	appUserID := "rcapp_123"

	mock.ExpectQuery("SELECT (.+) FROM users WHERE id").
		WithArgs(int32(100)).
		WillReturnRows(pgxmock.NewRows(userColumns()).AddRow(mobileBillingUserRow("pro", &appUserID)...))

	user, err := repo.FindUserByID(context.Background(), 100)

	require.NoError(t, err)
	require.NotNil(t, user)
	assert.Equal(t, 100, user.ID)
}

func TestPgMobileSubscriptionRepository_FindUserByID_NotFound(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewMobileSubscriptionRepository(queries)

	mock.ExpectQuery("SELECT (.+) FROM users WHERE id").
		WithArgs(int32(999)).
		WillReturnError(pgx.ErrNoRows)

	user, err := repo.FindUserByID(context.Background(), 999)

	require.ErrorIs(t, err, ErrBillingUserNotFound)
	assert.Nil(t, user)
}

func TestPgMobileSubscriptionRepository_UpdateUser_ClearSubscription(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewMobileSubscriptionRepository(queries)

	appUserID := "rcapp_123"
	plan := "free"

	mock.ExpectExec("UPDATE users SET").
		WithArgs(int32(100), &plan).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	mock.ExpectQuery("SELECT (.+) FROM users WHERE id").
		WithArgs(int32(100)).
		WillReturnRows(pgxmock.NewRows(userColumns()).AddRow(mobileBillingUserRow("free", &appUserID)...))

	user, err := repo.UpdateUser(context.Background(), 100, MobileSubscriptionUpdate{
		ClearSubscription: true,
		Plan:              &plan,
	})

	require.NoError(t, err)
	require.NotNil(t, user)
	assert.Equal(t, "free", user.Plan)
}

func TestPgMobileSubscriptionRepository_UpdateUser_ExecError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewMobileSubscriptionRepository(queries)

	mock.ExpectExec("UPDATE users SET").
		WillReturnError(errors.New("update error"))

	plan := "pro"
	_, err := repo.UpdateUser(context.Background(), 100, MobileSubscriptionUpdate{
		Plan: &plan,
	})

	assert.Error(t, err)
}

func TestPgMobileSubscriptionRepository_UpdateUser_Overflow(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewMobileSubscriptionRepository(queries)

	_, err := repo.UpdateUser(context.Background(), math.MaxInt32+1, MobileSubscriptionUpdate{})

	require.Error(t, err)
	assert.Contains(t, err.Error(), "exceeds int32 range")
}

func TestPgMobileSubscriptionRepository_UpdateUser_RefetchError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewMobileSubscriptionRepository(queries)

	mock.ExpectExec("UPDATE users SET").
		WithArgs(
			int32(100), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
			pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
			pgxmock.AnyArg(), pgxmock.AnyArg(),
		).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	mock.ExpectQuery("SELECT (.+) FROM users WHERE id").
		WithArgs(int32(100)).
		WillReturnError(errors.New("refetch error"))

	plan := "pro"
	_, err := repo.UpdateUser(context.Background(), 100, MobileSubscriptionUpdate{
		Plan: &plan,
	})

	assert.Error(t, err)
}

func TestPgMobileSubscriptionRepository_UpdateUser_RefetchNotFound(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewMobileSubscriptionRepository(queries)

	mock.ExpectExec("UPDATE users SET").
		WithArgs(
			int32(100), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
			pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
			pgxmock.AnyArg(), pgxmock.AnyArg(),
		).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	mock.ExpectQuery("SELECT (.+) FROM users WHERE id").
		WithArgs(int32(100)).
		WillReturnError(pgx.ErrNoRows)

	plan := "pro"
	_, err := repo.UpdateUser(context.Background(), 100, MobileSubscriptionUpdate{
		Plan: &plan,
	})

	require.ErrorIs(t, err, ErrBillingUserNotFound)
}

func TestPgMobileSubscriptionRepository_UpdateUser_ResetSubscriptionError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewMobileSubscriptionRepository(db.New(mock))

	plan := "free"
	mock.ExpectExec("UPDATE users SET").
		WithArgs(int32(100), &plan).
		WillReturnError(errors.New("reset failed"))

	user, err := repo.UpdateUser(context.Background(), 100, MobileSubscriptionUpdate{
		ClearSubscription: true,
		Plan:              &plan,
	})

	require.Error(t, err)
	assert.Nil(t, user)
}

func TestPgMobileSubscriptionRepository_UpdateUser_Success(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewMobileSubscriptionRepository(queries)

	appUserID := "rcapp_123"
	plan := "pro"

	// UpdateUserMobileSubscription arguments:
	// 1: ID, 2: Plan, 3: SubID, 4: SubStatus, 5: SubSource, 6: PeriodStart,
	// 7: PeriodEnd, 8: CancelAtPeriodEnd, 9: PriceID, 10: AppUserID, 11: MobilePID, 12: MobileTxID
	mock.ExpectExec("UPDATE users SET").
		WithArgs(
			int32(100), &plan, pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
			pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), &appUserID,
			pgxmock.AnyArg(), pgxmock.AnyArg(),
		).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	// Expect re-fetch
	mock.ExpectQuery("SELECT (.+) FROM users WHERE id").
		WithArgs(int32(100)).
		WillReturnRows(pgxmock.NewRows(userColumns()).AddRow(mobileBillingUserRow("pro", &appUserID)...))

	user, err := repo.UpdateUser(context.Background(), 100, MobileSubscriptionUpdate{
		Plan:                &plan,
		RevenueCatAppUserID: &appUserID,
	})

	require.NoError(t, err)
	require.NotNil(t, user)
	assert.Equal(t, "pro", user.Plan)
}

func TestPgMobileSubscriptionRepository_UpdateUser_Underflow(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewMobileSubscriptionRepository(queries)

	_, err := repo.UpdateUser(context.Background(), math.MinInt32-1, MobileSubscriptionUpdate{})

	require.Error(t, err)
	assert.Contains(t, err.Error(), "exceeds int32 range")
}

func TestPgPaymentsRepository_FindUserByEmail_DBError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewPaymentsRepository(db.New(mock))

	mock.ExpectQuery("SELECT (.+) FROM users WHERE email").
		WithArgs("error@example.com").
		WillReturnError(errors.New("query failed"))

	user, err := repo.FindUserByEmail(context.Background(), "error@example.com")

	require.Error(t, err)
	assert.Nil(t, user)
}

func TestPgPaymentsRepository_FindUserByEmail_NotFound(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewPaymentsRepository(db.New(mock))

	mock.ExpectQuery("SELECT (.+) FROM users WHERE email").
		WithArgs("missing@example.com").
		WillReturnError(pgx.ErrNoRows)

	user, err := repo.FindUserByEmail(context.Background(), "missing@example.com")

	require.ErrorIs(t, err, ErrBillingUserNotFound)
	assert.Nil(t, user)
}

func TestPgPaymentsRepository_FindUserByEmail_Success(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewPaymentsRepository(db.New(mock))

	mock.ExpectQuery("SELECT (.+) FROM users WHERE email").
		WithArgs("billing@example.com").
		WillReturnRows(pgxmock.NewRows(userColumns()).AddRow(sampleBillingUserRow()...))

	user, err := repo.FindUserByEmail(context.Background(), "billing@example.com")

	require.NoError(t, err)
	require.NotNil(t, user)
	assert.Equal(t, "billing@example.com", user.Email)
}

func TestPgPaymentsRepository_FindUserByID_DBError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewPaymentsRepository(db.New(mock))

	mock.ExpectQuery("SELECT (.+) FROM users WHERE id").
		WithArgs(int32(100)).
		WillReturnError(errors.New("connection reset"))

	user, err := repo.FindUserByID(context.Background(), 100)

	require.Error(t, err)
	assert.Nil(t, user)
}

func TestPgPaymentsRepository_FindUserByID_NotFound(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewPaymentsRepository(db.New(mock))

	mock.ExpectQuery("SELECT (.+) FROM users WHERE id").
		WithArgs(int32(404)).
		WillReturnError(pgx.ErrNoRows)

	user, err := repo.FindUserByID(context.Background(), 404)

	require.ErrorIs(t, err, ErrBillingUserNotFound)
	assert.Nil(t, user)
}

func TestPgPaymentsRepository_FindUserByID_Overflow(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewPaymentsRepository(db.New(mock))

	_, err := repo.FindUserByID(context.Background(), math.MaxInt32+1)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "exceeds int32 range")
}

func TestPgPaymentsRepository_FindUserByID_Success(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewPaymentsRepository(db.New(mock))

	mock.ExpectQuery("SELECT (.+) FROM users WHERE id").
		WithArgs(int32(100)).
		WillReturnRows(pgxmock.NewRows(userColumns()).AddRow(sampleBillingUserRow()...))

	user, err := repo.FindUserByID(context.Background(), 100)

	require.NoError(t, err)
	require.NotNil(t, user)
	assert.Equal(t, 100, user.ID)
	assert.Equal(t, "billing@example.com", user.Email)
	assert.NotNil(t, user.CustomerID)
	assert.NotNil(t, user.SubscriptionSource)
	assert.NotNil(t, user.CurrentPeriodStart)
	assert.NotNil(t, user.CurrentPeriodEnd)
	assert.True(t, user.AutoRechargeEnabled)
}
