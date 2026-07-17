package account

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFromDBUserMapsSubscriptionSourceAndPeriods(t *testing.T) {
	start := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	end := start.Add(30 * 24 * time.Hour)
	customerID := "cus_123"
	revenueCatID := "rc_123"
	source := db.SubscriptionSourceSTRIPE

	user := FromDBUser(db.User{
		ID:                    42,
		Email:                 "user@example.com",
		FullName:              new("User Example"),
		Plan:                  "pro",
		CustomerID:            &customerID,
		SubscriptionID:        new("sub_123"),
		SubscriptionStatus:    new("active"),
		SubscriptionSource:    &source,
		CurrentPeriodStart:    pgtype.Timestamp{Time: start, Valid: true},
		CurrentPeriodEnd:      pgtype.Timestamp{Time: end, Valid: true},
		CancelAtPeriodEnd:     true,
		RevenuecatAppUserID:   &revenueCatID,
		PaymentMethodBrand:    new("visa"),
		PaymentMethodLast4:    new("4242"),
		AutoRechargeEnabled:   true,
		AutoRechargeAmount:    pgtype.Numeric{Valid: true},
		AutoRechargeThreshold: pgtype.Numeric{Valid: true},
		CreditBalance:         pgtype.Numeric{Valid: true},
		ApiTier:               db.DeveloperApiTierPRO,
		ApiRequestsUsed:       10,
		ApiRequestsLimit:      100,
		ApiCurrentPeriodStart: pgtype.Timestamp{Time: start, Valid: true},
		ApiCurrentPeriodEnd:   pgtype.Timestamp{Time: end, Valid: true},
	})

	assert.Equal(t, int32(42), user.ID)
	assert.Equal(t, "user@example.com", user.Email)
	assert.Equal(t, "pro", user.Plan)
	assert.Equal(t, &customerID, user.CustomerID)
	assert.Equal(t, new("STRIPE"), user.SubscriptionSource)
	assert.Equal(t, &start, user.CurrentPeriodStart)
	assert.Equal(t, &end, user.CurrentPeriodEnd)
	assert.True(t, user.CancelAtPeriodEnd)
	assert.Equal(t, &revenueCatID, user.RevenueCatAppUserID)
	assert.True(t, user.AutoRechargeEnabled)
	assert.Equal(t, "PRO", user.APITier)
	assert.Equal(t, int32(10), user.APIRequestsUsed)
	assert.Equal(t, int32(100), user.APIRequestsLimit)
	assert.Equal(t, &start, user.APICurrentPeriodStart)
	assert.Equal(t, &end, user.APICurrentPeriodEnd)
}

func TestFromDBUserLeavesOptionalFieldsNil(t *testing.T) {
	user := FromDBUser(db.User{
		ID:                 42,
		Email:              "user@example.com",
		CurrentPeriodStart: pgtype.Timestamp{},
		CurrentPeriodEnd:   pgtype.Timestamp{},
		SubscriptionSource: nil,
	})

	assert.Nil(t, user.SubscriptionSource)
	assert.Nil(t, user.CurrentPeriodStart)
	assert.Nil(t, user.CurrentPeriodEnd)
}

func TestStoreLookupsForwardParametersAndMapUsers(t *testing.T) {
	ctx := context.Background()
	expected := db.User{ID: 42, Email: "user@example.com", Plan: "pro"}
	queries := &fakeUserQueries{user: expected}
	store := NewStore(queries)

	byID, err := store.GetByID(ctx, 42)
	require.NoError(t, err)
	assert.Equal(t, int32(42), queries.userID)
	assert.Equal(t, "user@example.com", byID.Email)

	byEmail, err := store.GetByEmail(ctx, "user@example.com")
	require.NoError(t, err)
	assert.Equal(t, "user@example.com", queries.email)
	assert.Equal(t, int32(42), byEmail.ID)

	byCustomer, err := store.GetByCustomerID(ctx, "cus_123")
	require.NoError(t, err)
	require.NotNil(t, queries.customerID)
	assert.Equal(t, "cus_123", *queries.customerID)
	assert.Equal(t, int32(42), byCustomer.ID)

	byRevenueCat, err := store.GetByRevenueCatAppUserID(ctx, "rc_123")
	require.NoError(t, err)
	require.NotNil(t, queries.revenueCatAppUserID)
	assert.Equal(t, "rc_123", *queries.revenueCatAppUserID)
	assert.Equal(t, int32(42), byRevenueCat.ID)
}

func TestIDStoreLookupPropagatesErrors(t *testing.T) {
	expectedErr := errors.New("missing user")
	queries := &fakeUserQueries{err: expectedErr}

	_, err := NewIDStore(queries).GetByID(context.Background(), 42)
	assert.ErrorIs(t, err, expectedErr)
}

type fakeUserQueries struct {
	user                db.User
	err                 error
	customerID          *string
	revenueCatAppUserID *string
	email               string
	userID              int32
}

func (f *fakeUserQueries) GetUserByID(_ context.Context, userID int32) (db.User, error) {
	f.userID = userID
	return f.user, f.err
}

func (f *fakeUserQueries) GetUserByCustomerID(_ context.Context, customerID *string) (db.User, error) {
	f.customerID = customerID
	return f.user, f.err
}

func (f *fakeUserQueries) GetUserByEmail(_ context.Context, email string) (db.User, error) {
	f.email = email
	return f.user, f.err
}

func (f *fakeUserQueries) GetUserByRevenueCatAppUserID(_ context.Context, appUserID *string) (db.User, error) {
	f.revenueCatAppUserID = appUserID
	return f.user, f.err
}
