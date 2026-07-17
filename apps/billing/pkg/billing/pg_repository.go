package billing

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"math/big"
	"time"

	"github.com/TaskForceAI/adapters/pkg/account"
	"github.com/TaskForceAI/adapters/pkg/convert"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Ensure implementations satisfy interfaces
var (
	_ PaymentsRepository           = (*PgPaymentsRepository)(nil)
	_ AccountSettingsRepository    = (*PgAccountSettingsRepository)(nil)
	_ WebhookRepository            = (*PgWebhookRepository)(nil)
	_ MobileSubscriptionRepository = (*PgMobileSubscriptionRepository)(nil)
)

type billingStore interface {
	GetUserByID(ctx context.Context, userID int32) (account.User, error)
	GetUserByCustomerID(ctx context.Context, customerID string) (account.User, error)
	GetUserByEmail(ctx context.Context, email string) (account.User, error)
	GetUserByAppUserID(ctx context.Context, appUserID string) (account.User, error)
	UpdateCustomerID(ctx context.Context, input billingCustomerUpdate) error
	UpdateSubscriptionStatus(ctx context.Context, input billingSubscriptionStatusUpdate) error
	UpdateAutoRecharge(ctx context.Context, input billingAutoRechargeUpdate) error
	WebhookEventExists(ctx context.Context, stripeEventID string) (bool, error)
	RecordWebhookEvent(ctx context.Context, input billingWebhookEventRecord) (int64, error)
	CompleteWebhookEvent(ctx context.Context, input billingWebhookEventClaim) (int64, error)
	DeleteWebhookEvent(ctx context.Context, input billingWebhookEventClaim) (int64, error)
	ResetWebhookSubscription(ctx context.Context, input billingResetSubscriptionInput) error
	UpdateWebhookUser(ctx context.Context, input billingWebhookUserUpdate) error
	ResetMobileSubscription(ctx context.Context, input billingResetSubscriptionInput) error
	UpdateMobileSubscription(ctx context.Context, input billingMobileSubscriptionUpdate) error
}

type sqlcBillingStore struct {
	q *db.Queries
}

type billingCustomerUpdate struct {
	ID         int32
	CustomerID *string
}

type billingSubscriptionStatusUpdate struct {
	ID                 int32
	SubscriptionStatus *string
	CancelAtPeriodEnd  *bool
	CurrentPeriodStart pgtype.Timestamp
	CurrentPeriodEnd   pgtype.Timestamp
}

type billingWebhookEventRecord struct {
	StripeEventID string
	EventType     string
	ClaimToken    string
}

type billingWebhookEventClaim struct {
	StripeEventID string
	ClaimToken    string
}

type billingResetSubscriptionInput struct {
	ID                               int32
	Plan                             *string
	StripeSubscriptionEventCreatedAt pgtype.Timestamp
}

type billingWebhookUserUpdate struct {
	ID                               int32
	SubscriptionID                   *string
	SubscriptionStatus               *string
	SubscriptionSource               *SubscriptionSource
	CurrentPeriodStart               pgtype.Timestamp
	CurrentPeriodEnd                 pgtype.Timestamp
	CancelAtPeriodEnd                *bool
	StripeSubscriptionEventCreatedAt pgtype.Timestamp
	CustomerID                       *string
	Plan                             *string
	PriceID                          *string
	PaymentMethodBrand               *string
	PaymentMethodLast4               *string
}

type billingMobileSubscriptionUpdate struct {
	ID                          int32
	Plan                        *string
	SubscriptionID              *string
	SubscriptionStatus          *string
	SubscriptionSource          *SubscriptionSource
	CurrentPeriodStart          pgtype.Timestamp
	CurrentPeriodEnd            pgtype.Timestamp
	CancelAtPeriodEnd           *bool
	PriceID                     *string
	RevenueCatAppUserID         *string
	MobileProductID             *string
	MobileOriginalTransactionID *string
}

type billingAutoRechargeUpdate struct {
	ID                    int32
	AutoRechargeEnabled   bool
	AutoRechargeAmount    pgtype.Numeric
	AutoRechargeThreshold pgtype.Numeric
}

// --- Payments Repository ---

type paymentsRepository struct {
	store billingStore
}

type PgPaymentsRepository struct{ *paymentsRepository }

type PgAccountSettingsRepository struct {
	*paymentsRepository
}

func newPaymentsRepository(q *db.Queries) *paymentsRepository {
	return &paymentsRepository{store: sqlcBillingStore{q: q}}
}

func NewPaymentsRepository(q *db.Queries) *PgPaymentsRepository {
	return &PgPaymentsRepository{paymentsRepository: newPaymentsRepository(q)}
}

func NewAccountSettingsRepository(q *db.Queries) *PgAccountSettingsRepository {
	return &PgAccountSettingsRepository{paymentsRepository: newPaymentsRepository(q)}
}

func (r *paymentsRepository) FindUserByID(ctx context.Context, userID int) (*PaymentsAccountUser, error) {
	return findBillingUserByIntID(ctx, r.store, userID, "user_id", "payments repository", mapBillingUserToPaymentsAccountUser)
}

func (r *paymentsRepository) FindUserByEmail(ctx context.Context, email string) (*PaymentsAccountUser, error) {
	return findBillingUser(ctx, "payments repository", mapBillingUserToPaymentsAccountUser, "email", email, func(ctx context.Context) (account.User, error) {
		return r.store.GetUserByEmail(ctx, email)
	})
}

func (r *paymentsRepository) UpdateCustomerID(ctx context.Context, userID int, customerID string) error {
	dbUserID, err := convert.Int32(userID, "user_id")
	if err != nil {
		return err
	}
	err = r.store.UpdateCustomerID(ctx, billingCustomerUpdate{
		ID:         dbUserID,
		CustomerID: &customerID,
	})
	if err != nil {
		slog.Error("Failed to update customer ID", "error", err, "userId", userID, "customerId", customerID)
	}
	return err
}

func (r *paymentsRepository) UpdateSubscription(ctx context.Context, userID int, update SubscriptionUpdate) error {
	dbUserID, err := convert.Int32(userID, "user_id")
	if err != nil {
		return err
	}
	if update.ClearSubscription {
		err = r.store.ResetWebhookSubscription(ctx, billingResetSubscriptionInput{
			ID:   dbUserID,
			Plan: update.Plan,
		})
		if err != nil {
			slog.Error("Failed to reset user subscription", "error", err, "userId", userID)
		}
		return err
	}
	if update.Plan != nil || update.SubscriptionID != nil || update.SubscriptionSource != nil || update.PriceID != nil {
		err = r.store.UpdateWebhookUser(ctx, billingWebhookUserUpdate{
			ID:                 dbUserID,
			SubscriptionID:     update.SubscriptionID,
			SubscriptionStatus: update.SubscriptionStatus,
			SubscriptionSource: update.SubscriptionSource,
			CurrentPeriodStart: billingTimestamp(update.CurrentPeriodStart),
			CurrentPeriodEnd:   billingTimestamp(update.CurrentPeriodEnd),
			CancelAtPeriodEnd:  update.CancelAtPeriodEnd,
			Plan:               update.Plan,
			PriceID:            update.PriceID,
		})
		if err != nil {
			slog.Error("Failed to reconcile user subscription", "error", err, "userId", userID)
		}
		return err
	}
	params := billingSubscriptionStatusUpdate{
		ID: dbUserID,
	}

	if update.SubscriptionStatus != nil {
		params.SubscriptionStatus = update.SubscriptionStatus
	}
	if update.CancelAtPeriodEnd != nil {
		params.CancelAtPeriodEnd = update.CancelAtPeriodEnd
	}
	params.CurrentPeriodStart = billingTimestamp(update.CurrentPeriodStart)
	params.CurrentPeriodEnd = billingTimestamp(update.CurrentPeriodEnd)

	err = r.store.UpdateSubscriptionStatus(ctx, params)
	if err != nil {
		slog.Error("Failed to update user subscription", "error", err, "userId", userID)
	}
	return err
}

func (r *PgAccountSettingsRepository) UpdateAutoRecharge(ctx context.Context, userID int, update AutoRechargeUpdate) error {
	dbUserID, err := convert.Int32(userID, "user_id")
	if err != nil {
		return err
	}
	return r.store.UpdateAutoRecharge(ctx, billingAutoRechargeUpdate{
		ID:                    dbUserID,
		AutoRechargeEnabled:   update.Enabled,
		AutoRechargeAmount:    float64PtrToNumeric(update.Amount),
		AutoRechargeThreshold: float64PtrToNumeric(update.Threshold),
	})
}

// --- Webhook Repository ---

type PgWebhookRepository struct {
	store billingStore
}

func NewWebhookRepository(q *db.Queries) *PgWebhookRepository {
	return &PgWebhookRepository{store: sqlcBillingStore{q: q}}
}

func (r *PgWebhookRepository) HasProcessedEvent(ctx context.Context, stripeEventID string) (bool, error) {
	exists, err := r.store.WebhookEventExists(ctx, stripeEventID)
	if err != nil {
		slog.Error("Failed to check if webhook event exists", "error", err, "stripeEventId", stripeEventID)
	}
	return exists, err
}

func (r *PgWebhookRepository) RecordEvent(ctx context.Context, stripeEventID, eventType string) (WebhookClaim, error) {
	claim := WebhookClaim(rand.Text())
	rowsAffected, err := r.store.RecordWebhookEvent(ctx, billingWebhookEventRecord{
		StripeEventID: stripeEventID,
		EventType:     eventType,
		ClaimToken:    string(claim),
	})
	if err != nil {
		slog.Error("Failed to record webhook event", "error", err, "stripeEventId", stripeEventID, "type", eventType)
		return "", err
	}
	if rowsAffected == 0 {
		return "", nil
	}
	return claim, nil
}

func (r *PgWebhookRepository) CompleteEvent(ctx context.Context, stripeEventID string, claim WebhookClaim) error {
	rowsAffected, err := r.store.CompleteWebhookEvent(ctx, billingWebhookEventClaim{
		StripeEventID: stripeEventID,
		ClaimToken:    string(claim),
	})
	if err != nil {
		slog.Error("Failed to complete webhook event", "error", err, "stripeEventId", stripeEventID)
		return err
	}
	if rowsAffected != 1 {
		return fmt.Errorf("webhook claim lost before completion: %s", stripeEventID)
	}
	return nil
}

func (r *PgWebhookRepository) DeleteEvent(ctx context.Context, stripeEventID string, claim WebhookClaim) error {
	rowsAffected, err := r.store.DeleteWebhookEvent(ctx, billingWebhookEventClaim{
		StripeEventID: stripeEventID,
		ClaimToken:    string(claim),
	})
	if err != nil {
		slog.Error("Failed to delete webhook event", "error", err, "stripeEventId", stripeEventID)
		return err
	}
	if rowsAffected != 1 {
		return fmt.Errorf("webhook claim lost before release: %s", stripeEventID)
	}
	return nil
}

func (r *PgWebhookRepository) FindUserByID(ctx context.Context, userID int) (*WebhookUser, error) {
	return findBillingUserByIntID(ctx, r.store, userID, "user_id", "webhook repository", mapBillingUserToWebhookUser)
}

func (r *PgWebhookRepository) FindUserByCustomerID(ctx context.Context, customerID string) (*WebhookUser, error) {
	return findBillingUser(ctx, "webhook repository", mapBillingUserToWebhookUser, "customerId", customerID, func(ctx context.Context) (account.User, error) {
		return r.store.GetUserByCustomerID(ctx, customerID)
	})
}

func (r *PgWebhookRepository) UpdateUser(ctx context.Context, userID int, update WebhookUserUpdate) error {
	dbUserID, err := convert.Int32(userID, "user_id")
	if err != nil {
		return err
	}
	if update.ClearSubscription {
		err := r.store.ResetWebhookSubscription(ctx, billingResetSubscriptionInput{
			ID:                               dbUserID,
			Plan:                             update.Plan,
			StripeSubscriptionEventCreatedAt: billingTimestamp(update.StripeSubscriptionEventCreatedAt),
		})
		if err != nil {
			slog.Error("Failed to reset user subscription from webhook", "error", err, "userId", userID)
		}
		return err
	}

	err = r.store.UpdateWebhookUser(ctx, billingWebhookUserUpdate{
		ID:                               dbUserID,
		SubscriptionID:                   update.SubscriptionID,
		SubscriptionStatus:               update.SubscriptionStatus,
		SubscriptionSource:               update.SubscriptionSource,
		CurrentPeriodStart:               billingTimestamp(update.CurrentPeriodStart),
		CurrentPeriodEnd:                 billingTimestamp(update.CurrentPeriodEnd),
		CancelAtPeriodEnd:                update.CancelAtPeriodEnd,
		StripeSubscriptionEventCreatedAt: billingTimestamp(update.StripeSubscriptionEventCreatedAt),
		CustomerID:                       update.CustomerID,
		Plan:                             update.Plan,
		PriceID:                          update.PriceID,
		PaymentMethodBrand:               update.PaymentMethodBrand,
		PaymentMethodLast4:               update.PaymentMethodLast4,
	})
	if err != nil {
		slog.Error("Failed to update user from webhook", "error", err, "userId", userID)
	}
	return err
}

func mapBillingUserToWebhookUser(u account.User) *WebhookUser {
	return &WebhookUser{
		ID:                               int(u.ID),
		Email:                            u.Email,
		FullName:                         u.FullName,
		Plan:                             &u.Plan,
		CustomerID:                       u.CustomerID,
		SubscriptionID:                   u.SubscriptionID,
		SubscriptionStatus:               u.SubscriptionStatus,
		StripeSubscriptionEventCreatedAt: u.StripeSubscriptionEventCreatedAt,
	}
}

func mapBillingUserToPaymentsAccountUser(u account.User) *PaymentsAccountUser {
	var subscriptionSource *SubscriptionSource
	if u.SubscriptionSource != nil {
		source := SubscriptionSource(*u.SubscriptionSource)
		subscriptionSource = &source
	}

	return &PaymentsAccountUser{
		CreditBalance:         u.CreditBalance,
		AutoRechargeEnabled:   u.AutoRechargeEnabled,
		AutoRechargeAmount:    u.AutoRechargeAmount,
		AutoRechargeThreshold: u.AutoRechargeThreshold,
		ID:                    int(u.ID),
		Email:                 u.Email,
		Plan:                  u.Plan,
		Disabled:              u.Disabled,
		CustomerID:            u.CustomerID,
		RevenueCatAppUserID:   u.RevenueCatAppUserID,
		SubscriptionID:        u.SubscriptionID,
		SubscriptionStatus:    u.SubscriptionStatus,
		SubscriptionSource:    subscriptionSource,
		CurrentPeriodStart:    u.CurrentPeriodStart,
		CurrentPeriodEnd:      u.CurrentPeriodEnd,
		CancelAtPeriodEnd:     u.CancelAtPeriodEnd,
		PaymentMethodBrand:    u.PaymentMethodBrand,
		PaymentMethodLast4:    u.PaymentMethodLast4,
	}
}

// --- Mobile Subscription Repository ---

type PgMobileSubscriptionRepository struct {
	store billingStore
}

func NewMobileSubscriptionRepository(q *db.Queries) *PgMobileSubscriptionRepository {
	return &PgMobileSubscriptionRepository{store: sqlcBillingStore{q: q}}
}

func (r *PgMobileSubscriptionRepository) FindUserByID(ctx context.Context, id int) (*MobileSyncUser, error) {
	return findBillingUserByIntID(ctx, r.store, id, "id", "mobile subscription repository", mapBillingUserToMobileSyncUser)
}

func (r *PgMobileSubscriptionRepository) FindUserByAppUserID(ctx context.Context, appUserID string) (*MobileSyncUser, error) {
	return findBillingUser(ctx, "mobile subscription repository", mapBillingUserToMobileSyncUser, "appUserId", appUserID, func(ctx context.Context) (account.User, error) {
		return r.store.GetUserByAppUserID(ctx, appUserID)
	})
}

func (r *PgMobileSubscriptionRepository) UpdateUser(ctx context.Context, id int, update MobileSubscriptionUpdate) (*MobileSyncUser, error) {
	dbUserID, err := convert.Int32(id, "id")
	if err != nil {
		return nil, err
	}
	if update.ClearSubscription {
		err := r.store.ResetMobileSubscription(ctx, billingResetSubscriptionInput{
			ID:   dbUserID,
			Plan: update.Plan,
		})
		if err != nil {
			slog.Error("Failed to reset user mobile subscription", "error", err, "userId", id)
			return nil, err
		}

		return r.FindUserByID(ctx, id)
	}

	err = r.store.UpdateMobileSubscription(ctx, billingMobileSubscriptionUpdate{
		ID:                          dbUserID,
		Plan:                        update.Plan,
		SubscriptionID:              update.SubscriptionID,
		SubscriptionStatus:          update.SubscriptionStatus,
		SubscriptionSource:          update.SubscriptionSource,
		CurrentPeriodStart:          billingTimestamp(update.CurrentPeriodStart),
		CurrentPeriodEnd:            billingTimestamp(update.CurrentPeriodEnd),
		CancelAtPeriodEnd:           update.CancelAtPeriodEnd,
		PriceID:                     update.PriceID,
		RevenueCatAppUserID:         update.RevenueCatAppUserID,
		MobileProductID:             update.MobileProductID,
		MobileOriginalTransactionID: update.MobileOriginalTransactionID,
	})
	if err != nil {
		slog.Error("Failed to update user mobile subscription", "error", err, "userId", id)
		return nil, err
	}

	// Fetch updated user
	return r.FindUserByID(ctx, id)
}

func findBillingUserByIntID[T any](
	ctx context.Context,
	store billingStore,
	id int,
	fieldName string,
	repositoryName string,
	mapUser func(account.User) *T,
) (*T, error) {
	dbUserID, err := convert.Int32(id, fieldName)
	if err != nil {
		return nil, err
	}
	return findBillingUser(ctx, repositoryName, mapUser, "userId", id, func(ctx context.Context) (account.User, error) {
		return store.GetUserByID(ctx, dbUserID)
	})
}

func findBillingUser[T any](
	ctx context.Context,
	repositoryName string,
	mapUser func(account.User) *T,
	logKey string,
	logValue any,
	loadUser func(context.Context) (account.User, error),
) (*T, error) {
	user, err := loadUser(ctx)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: %s", ErrBillingUserNotFound, repositoryName)
		}
		slog.Error("Failed to find user in billing repository", "error", err, "repository", repositoryName, logKey, logValue)
		return nil, err
	}
	return mapUser(user), nil
}

func billingTimestamp(value *time.Time) pgtype.Timestamp {
	if value == nil {
		return pgtype.Timestamp{}
	}
	return pgtype.Timestamp{Time: *value, Valid: true}
}

func mapBillingUserToMobileSyncUser(u account.User) *MobileSyncUser {
	var subSource *SubscriptionSource
	if u.SubscriptionSource != nil {
		src := SubscriptionSource(*u.SubscriptionSource)
		subSource = &src
	}

	return &MobileSyncUser{
		ID:                  int(u.ID),
		Email:               u.Email,
		RevenueCatAppUserID: u.RevenueCatAppUserID,
		Plan:                u.Plan,
		SubscriptionSource:  subSource,
		SubscriptionID:      u.SubscriptionID,
		SubscriptionStatus:  u.SubscriptionStatus,
		CurrentPeriodStart:  u.CurrentPeriodStart,
		CurrentPeriodEnd:    u.CurrentPeriodEnd,
	}
}

func float64ToNumeric(f float64) pgtype.Numeric {
	var n pgtype.Numeric
	if math.IsNaN(f) || math.IsInf(f, 0) || math.Abs(f) > float64(math.MaxInt64)/100 {
		return n
	}
	_ = n.Scan(big.NewRat(int64(math.Round(f*100)), 100).FloatString(10))
	return n
}

func float64PtrToNumeric(f *float64) pgtype.Numeric {
	if f == nil {
		return pgtype.Numeric{Valid: false}
	}
	return float64ToNumeric(*f)
}

func (s sqlcBillingStore) GetUserByID(ctx context.Context, userID int32) (account.User, error) {
	return account.NewStore(s.q).GetByID(ctx, userID)
}

func (s sqlcBillingStore) GetUserByCustomerID(ctx context.Context, customerID string) (account.User, error) {
	return account.NewStore(s.q).GetByCustomerID(ctx, customerID)
}

func (s sqlcBillingStore) GetUserByEmail(ctx context.Context, email string) (account.User, error) {
	return account.NewStore(s.q).GetByEmail(ctx, email)
}

func (s sqlcBillingStore) GetUserByAppUserID(ctx context.Context, appUserID string) (account.User, error) {
	return account.NewStore(s.q).GetByRevenueCatAppUserID(ctx, appUserID)
}

func (s sqlcBillingStore) UpdateCustomerID(ctx context.Context, input billingCustomerUpdate) error {
	return s.q.UpdateUserCustomerID(ctx, db.UpdateUserCustomerIDParams{
		ID:         input.ID,
		CustomerID: input.CustomerID,
	})
}

func (s sqlcBillingStore) UpdateSubscriptionStatus(ctx context.Context, input billingSubscriptionStatusUpdate) error {
	return s.q.UpdateUserSubscriptionStatus(ctx, db.UpdateUserSubscriptionStatusParams{
		ID:                 input.ID,
		SubscriptionStatus: input.SubscriptionStatus,
		CancelAtPeriodEnd:  input.CancelAtPeriodEnd,
		CurrentPeriodStart: input.CurrentPeriodStart,
		CurrentPeriodEnd:   input.CurrentPeriodEnd,
	})
}

func (s sqlcBillingStore) WebhookEventExists(ctx context.Context, stripeEventID string) (bool, error) {
	return s.q.WebhookEventExists(ctx, stripeEventID)
}

func (s sqlcBillingStore) RecordWebhookEvent(ctx context.Context, input billingWebhookEventRecord) (int64, error) {
	claimToken := input.ClaimToken
	return s.q.RecordWebhookEvent(ctx, db.RecordWebhookEventParams{
		StripeEventID: input.StripeEventID,
		Type:          input.EventType,
		ClaimToken:    &claimToken,
	})
}

func (s sqlcBillingStore) CompleteWebhookEvent(ctx context.Context, input billingWebhookEventClaim) (int64, error) {
	claimToken := input.ClaimToken
	return s.q.CompleteWebhookEvent(ctx, db.CompleteWebhookEventParams{
		StripeEventID: input.StripeEventID,
		ClaimToken:    &claimToken,
	})
}

func (s sqlcBillingStore) DeleteWebhookEvent(ctx context.Context, input billingWebhookEventClaim) (int64, error) {
	claimToken := input.ClaimToken
	return s.q.DeleteWebhookEvent(ctx, db.DeleteWebhookEventParams{
		StripeEventID: input.StripeEventID,
		ClaimToken:    &claimToken,
	})
}

func (s sqlcBillingStore) ResetWebhookSubscription(ctx context.Context, input billingResetSubscriptionInput) error {
	return s.q.ResetUserWebhookSubscription(ctx, db.ResetUserWebhookSubscriptionParams{
		ID:                               input.ID,
		Plan:                             input.Plan,
		StripeSubscriptionEventCreatedAt: input.StripeSubscriptionEventCreatedAt,
	})
}

func (s sqlcBillingStore) UpdateWebhookUser(ctx context.Context, input billingWebhookUserUpdate) error {
	return s.q.UpdateUserWebhookFull(ctx, db.UpdateUserWebhookFullParams{
		ID:                               input.ID,
		SubscriptionID:                   input.SubscriptionID,
		SubscriptionStatus:               input.SubscriptionStatus,
		SubscriptionSource:               toNullSubscriptionSource(input.SubscriptionSource),
		CurrentPeriodStart:               input.CurrentPeriodStart,
		CurrentPeriodEnd:                 input.CurrentPeriodEnd,
		CancelAtPeriodEnd:                input.CancelAtPeriodEnd,
		StripeSubscriptionEventCreatedAt: input.StripeSubscriptionEventCreatedAt,
		CustomerID:                       input.CustomerID,
		Plan:                             input.Plan,
		PriceID:                          input.PriceID,
		PaymentMethodBrand:               input.PaymentMethodBrand,
		PaymentMethodLast4:               input.PaymentMethodLast4,
	})
}

func (s sqlcBillingStore) ResetMobileSubscription(ctx context.Context, input billingResetSubscriptionInput) error {
	return s.q.ResetUserMobileSubscription(ctx, db.ResetUserMobileSubscriptionParams{
		ID:   input.ID,
		Plan: input.Plan,
	})
}

func (s sqlcBillingStore) UpdateMobileSubscription(ctx context.Context, input billingMobileSubscriptionUpdate) error {
	return s.q.UpdateUserMobileSubscription(ctx, db.UpdateUserMobileSubscriptionParams{
		ID:                          input.ID,
		Plan:                        input.Plan,
		SubscriptionID:              input.SubscriptionID,
		SubscriptionStatus:          input.SubscriptionStatus,
		SubscriptionSource:          toNullSubscriptionSource(input.SubscriptionSource),
		CurrentPeriodStart:          input.CurrentPeriodStart,
		CurrentPeriodEnd:            input.CurrentPeriodEnd,
		CancelAtPeriodEnd:           input.CancelAtPeriodEnd,
		PriceID:                     input.PriceID,
		RevenuecatAppUserID:         input.RevenueCatAppUserID,
		MobileProductID:             input.MobileProductID,
		MobileOriginalTransactionID: input.MobileOriginalTransactionID,
	})
}

func (s sqlcBillingStore) UpdateAutoRecharge(ctx context.Context, input billingAutoRechargeUpdate) error {
	return s.q.UpdateUserAutoRecharge(ctx, db.UpdateUserAutoRechargeParams{
		ID:                    input.ID,
		AutoRechargeEnabled:   input.AutoRechargeEnabled,
		AutoRechargeAmount:    input.AutoRechargeAmount,
		AutoRechargeThreshold: input.AutoRechargeThreshold,
	})
}

func toNullSubscriptionSource(source *SubscriptionSource) *db.SubscriptionSource {
	if source == nil {
		return nil
	}

	dbSource := db.SubscriptionSource(*source)
	return &dbSource
}
