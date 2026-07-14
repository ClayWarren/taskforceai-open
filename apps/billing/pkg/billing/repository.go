package billing

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

// ErrBillingUserNotFound distinguishes an absent billing record from a
// repository failure.
var ErrBillingUserNotFound = errors.New("billing user not found")

// SubscriptionUpdate represents fields to update on a subscription
type SubscriptionUpdate struct {
	ClearSubscription  bool
	Plan               *string
	SubscriptionID     *string
	SubscriptionSource *SubscriptionSource
	PriceID            *string
	SubscriptionStatus *string
	CancelAtPeriodEnd  *bool
	CurrentPeriodStart *time.Time
	CurrentPeriodEnd   *time.Time
}

// PaymentsAccountUser represents the user fields needed by billing account flows.
type PaymentsAccountUser struct {
	CreditBalance         pgtype.Numeric
	AutoRechargeEnabled   bool
	AutoRechargeAmount    pgtype.Numeric
	AutoRechargeThreshold pgtype.Numeric
	ID                    int
	Email                 string
	Plan                  string
	Disabled              bool
	CustomerID            *string
	RevenueCatAppUserID   *string
	SubscriptionID        *string
	SubscriptionStatus    *string
	SubscriptionSource    *SubscriptionSource
	CurrentPeriodStart    *time.Time
	CurrentPeriodEnd      *time.Time
	CancelAtPeriodEnd     bool
	PaymentMethodBrand    *string
	PaymentMethodLast4    *string
}

// PaymentsRepository handles payment-related database operations
type PaymentsRepository interface {
	FindUserByID(ctx context.Context, userID int) (*PaymentsAccountUser, error)
	FindUserByEmail(ctx context.Context, email string) (*PaymentsAccountUser, error)
	UpdateCustomerID(ctx context.Context, userID int, customerID string) error
	UpdateSubscription(ctx context.Context, userID int, update SubscriptionUpdate) error
}

type AutoRechargeUpdate struct {
	Enabled   bool
	Amount    *float64
	Threshold *float64
}

type AccountSettingsRepository interface {
	PaymentsRepository
	UpdateAutoRecharge(ctx context.Context, userID int, update AutoRechargeUpdate) error
}

// WebhookUser represents user data returned by webhook repository
type WebhookUser struct {
	ID                               int
	Email                            string
	FullName                         *string
	Plan                             *string
	CustomerID                       *string
	SubscriptionID                   *string
	SubscriptionStatus               *string
	StripeSubscriptionEventCreatedAt *time.Time
}

// WebhookUserUpdate represents fields to update from a webhook event
type WebhookUserUpdate struct {
	ClearSubscription                bool
	SubscriptionID                   *string
	SubscriptionStatus               *string
	SubscriptionSource               *SubscriptionSource
	CurrentPeriodStart               *time.Time
	CurrentPeriodEnd                 *time.Time
	CancelAtPeriodEnd                *bool
	StripeSubscriptionEventCreatedAt *time.Time
	CustomerID                       *string
	Plan                             *string
	PriceID                          *string
	PaymentMethodBrand               *string
	PaymentMethodLast4               *string
	MobileProductID                  *string
	MobileOriginalTransactionID      *string
}

// WebhookClaim is an opaque lease token that fences webhook state mutations.
type WebhookClaim string

// WebhookRepository handles webhook-related database operations
type WebhookRepository interface {
	HasProcessedEvent(ctx context.Context, stripeEventID string) (bool, error)
	RecordEvent(ctx context.Context, stripeEventID, eventType string) (WebhookClaim, error)
	CompleteEvent(ctx context.Context, stripeEventID string, claim WebhookClaim) error
	DeleteEvent(ctx context.Context, stripeEventID string, claim WebhookClaim) error
	FindUserByID(ctx context.Context, userID int) (*WebhookUser, error)
	FindUserByCustomerID(ctx context.Context, customerID string) (*WebhookUser, error)
	UpdateUser(ctx context.Context, userID int, update WebhookUserUpdate) error
}

// MobileSubscriptionUpdate represents fields for mobile subscription sync
type MobileSubscriptionUpdate struct {
	ClearSubscription           bool
	Plan                        *string
	SubscriptionID              *string
	SubscriptionStatus          *string
	SubscriptionSource          *SubscriptionSource
	CurrentPeriodStart          *time.Time
	CurrentPeriodEnd            *time.Time
	CancelAtPeriodEnd           *bool
	PriceID                     *string
	RevenueCatAppUserID         *string
	MobileProductID             *string
	MobileOriginalTransactionID *string
}

// MobileSubscriptionRepository handles mobile subscription database operations
type MobileSubscriptionRepository interface {
	FindUserByID(ctx context.Context, id int) (*MobileSyncUser, error)
	FindUserByAppUserID(ctx context.Context, appUserID string) (*MobileSyncUser, error)
	UpdateUser(ctx context.Context, id int, update MobileSubscriptionUpdate) (*MobileSyncUser, error)
}
