package account

import (
	"context"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/jackc/pgx/v5/pgtype"
)

type QuerySource interface {
	IDQuerySource
	GetUserByCustomerID(ctx context.Context, customerID *string) (db.User, error)
	GetUserByEmail(ctx context.Context, email string) (db.User, error)
	GetUserByRevenueCatAppUserID(ctx context.Context, appUserID *string) (db.User, error)
}

type IDQuerySource interface {
	GetUserByID(ctx context.Context, userID int32) (db.User, error)
}

type Store struct {
	q QuerySource
}

type IDStore struct {
	q IDQuerySource
}

type User struct {
	CreditBalance                    pgtype.Numeric
	AutoRechargeAmount               pgtype.Numeric
	AutoRechargeThreshold            pgtype.Numeric
	CurrentPeriodStart               *time.Time
	CurrentPeriodEnd                 *time.Time
	RevenueCatAppUserID              *string
	APICurrentPeriodStart            *time.Time
	APICurrentPeriodEnd              *time.Time
	LastMessageTimestamp             *time.Time
	PaymentMethodBrand               *string
	PaymentMethodLast4               *string
	SubscriptionID                   *string
	SubscriptionStatus               *string
	SubscriptionSource               *string
	CustomerID                       *string
	StripeSubscriptionEventCreatedAt *time.Time
	FullName                         *string
	ID                               int32
	APIRequestsUsed                  int32
	APIRequestsLimit                 int32
	MessageCount                     int32
	Email                            string
	Plan                             string
	APITier                          string
	ThemePreference                  string
	AutoRechargeEnabled              bool
	Disabled                         bool
	IsAdmin                          bool
	CancelAtPeriodEnd                bool
	MemoryEnabled                    bool
	WebSearchEnabled                 bool
	CodeExecutionEnabled             bool
	NotificationsEnabled             bool
	QuickModeEnabled                 bool
	TrustLayerEnabled                bool
}

func NewStore(q QuerySource) Store {
	return Store{q: q}
}

func NewIDStore(q IDQuerySource) IDStore {
	return IDStore{q: q}
}

func (s Store) GetByID(ctx context.Context, userID int32) (User, error) {
	return userResult(s.q.GetUserByID(ctx, userID))
}

func (s IDStore) GetByID(ctx context.Context, userID int32) (User, error) {
	return userResult(s.q.GetUserByID(ctx, userID))
}

func (s Store) GetByCustomerID(ctx context.Context, customerID string) (User, error) {
	return userResult(s.q.GetUserByCustomerID(ctx, &customerID))
}

func (s Store) GetByEmail(ctx context.Context, email string) (User, error) {
	return userResult(s.q.GetUserByEmail(ctx, email))
}

func (s Store) GetByRevenueCatAppUserID(ctx context.Context, appUserID string) (User, error) {
	return userResult(s.q.GetUserByRevenueCatAppUserID(ctx, &appUserID))
}

func userResult(user db.User, err error) (User, error) {
	if err != nil {
		return User{}, err
	}
	return FromDBUser(user), nil
}

func FromDBUser(user db.User) User {
	return User{
		CreditBalance:                    user.CreditBalance,
		AutoRechargeEnabled:              user.AutoRechargeEnabled,
		AutoRechargeAmount:               user.AutoRechargeAmount,
		AutoRechargeThreshold:            user.AutoRechargeThreshold,
		ID:                               user.ID,
		Email:                            user.Email,
		FullName:                         user.FullName,
		Disabled:                         user.Disabled,
		Plan:                             user.Plan,
		MessageCount:                     user.MessageCount,
		LastMessageTimestamp:             timestamp(user.LastMessageTimestamp),
		IsAdmin:                          user.IsAdmin,
		ThemePreference:                  user.ThemePreference,
		MemoryEnabled:                    user.MemoryEnabled,
		WebSearchEnabled:                 user.WebSearchEnabled,
		CodeExecutionEnabled:             user.CodeExecutionEnabled,
		NotificationsEnabled:             user.NotificationsEnabled,
		QuickModeEnabled:                 user.QuickModeEnabled,
		TrustLayerEnabled:                user.TrustLayerEnabled,
		CustomerID:                       user.CustomerID,
		SubscriptionID:                   user.SubscriptionID,
		SubscriptionStatus:               user.SubscriptionStatus,
		SubscriptionSource:               subscriptionSource(user.SubscriptionSource),
		CurrentPeriodStart:               timestamp(user.CurrentPeriodStart),
		CurrentPeriodEnd:                 timestamp(user.CurrentPeriodEnd),
		CancelAtPeriodEnd:                user.CancelAtPeriodEnd,
		PaymentMethodBrand:               user.PaymentMethodBrand,
		PaymentMethodLast4:               user.PaymentMethodLast4,
		StripeSubscriptionEventCreatedAt: timestamp(user.StripeSubscriptionEventCreatedAt),
		RevenueCatAppUserID:              user.RevenuecatAppUserID,
		APITier:                          string(user.ApiTier),
		APIRequestsUsed:                  user.ApiRequestsUsed,
		APIRequestsLimit:                 user.ApiRequestsLimit,
		APICurrentPeriodStart:            timestamp(user.ApiCurrentPeriodStart),
		APICurrentPeriodEnd:              timestamp(user.ApiCurrentPeriodEnd),
	}
}

func subscriptionSource(source *db.SubscriptionSource) *string {
	if source == nil {
		return nil
	}
	value := string(*source)
	return &value
}

func timestamp(value pgtype.Timestamp) *time.Time {
	if !value.Valid {
		return nil
	}
	return &value.Time
}
