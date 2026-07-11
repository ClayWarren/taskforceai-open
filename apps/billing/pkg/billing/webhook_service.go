package billing

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/TaskForceAI/infrastructure/email/pkg"
	"github.com/stripe/stripe-go/v82"
)

// WebhookError represents an error from webhook processing
type WebhookError string

const (
	ErrDBError      WebhookError = "DB_ERROR"
	ErrInvalidEvent WebhookError = "INVALID_EVENT"
	ErrStripeError  WebhookError = "STRIPE_ERROR"
)

// WebhookDependencies holds dependencies for the webhook service
type WebhookDependencies struct {
	Repo             WebhookRepository
	GetPlanByPriceID func(priceID *string) *BillingPlanDefinition
	EmailService     email.EmailService
}

// WebhookService handles Stripe webhook events
type WebhookService struct {
	deps WebhookDependencies
}

// NewWebhookService creates a new webhook service
func NewWebhookService(deps WebhookDependencies) *WebhookService {
	if deps.GetPlanByPriceID == nil {
		deps.GetPlanByPriceID = GetPlanByPriceId
	}
	return &WebhookService{deps: deps}
}

// HandleEventResult represents the result of handling an event
type HandleEventResult struct {
	Processed bool
}

// HandleEvent processes a Stripe webhook event
func (s *WebhookService) HandleEvent(ctx context.Context, event *stripe.Event) (*HandleEventResult, WebhookError) {
	if event == nil || strings.TrimSpace(event.ID) == "" || strings.TrimSpace(string(event.Type)) == "" {
		recordStripeWebhook(ctx, false, "")
		return nil, ErrInvalidEvent
	}

	eventType := string(event.Type)
	alreadyProcessed, err := s.deps.Repo.HasProcessedEvent(ctx, event.ID)
	if err != nil {
		return nil, ErrDBError
	}
	if alreadyProcessed {
		slog.Warn("Ignoring duplicate webhook event", "eventId", event.ID, "type", event.Type)
		recordStripeWebhook(ctx, true, eventType)
		return &HandleEventResult{Processed: false}, ""
	}

	claim, err := s.deps.Repo.RecordEvent(ctx, event.ID, eventType)
	if err != nil {
		recordStripeWebhook(ctx, false, eventType)
		return nil, ErrDBError
	}
	if claim == "" {
		slog.Warn("Webhook event is already being processed", "eventId", event.ID, "type", event.Type)
		recordStripeWebhook(ctx, false, eventType)
		return nil, ErrDBError
	}

	// Handle by type (only handling specific events we care about)
	switch event.Type {
	case "customer.subscription.created", "customer.subscription.updated":
		if werr := s.handleSubscriptionUpdate(ctx, event.Data.Raw, stripeEventCreatedAt(event.Created)); werr != "" {
			return s.handleEventFailure(ctx, event.ID, eventType, claim, werr)
		}
	case "customer.subscription.deleted":
		if werr := s.handleSubscriptionDeleted(ctx, event.Data.Raw, stripeEventCreatedAt(event.Created)); werr != "" {
			return s.handleEventFailure(ctx, event.ID, eventType, claim, werr)
		}
	case "invoice.payment_succeeded":
		if werr := s.handlePaymentSucceeded(ctx, event.Data.Raw); werr != "" {
			return s.handleEventFailure(ctx, event.ID, eventType, claim, werr)
		}
	case "invoice.payment_failed":
		if werr := s.handlePaymentFailed(ctx, event.Data.Raw); werr != "" {
			return s.handleEventFailure(ctx, event.ID, eventType, claim, werr)
		}
	default:
		slog.Info("Unhandled webhook event type", "type", event.Type)
	}

	if err := s.deps.Repo.CompleteEvent(ctx, event.ID, claim); err != nil {
		recordStripeWebhook(ctx, false, eventType)
		return nil, ErrDBError
	}

	recordStripeWebhook(ctx, true, eventType)
	return &HandleEventResult{Processed: true}, ""
}

func stripeEventCreatedAt(created int64) *time.Time {
	if created <= 0 {
		return nil
	}
	t := time.Unix(created, 0).UTC()
	return &t
}

func (s *WebhookService) handleEventFailure(
	ctx context.Context,
	eventID string,
	eventType string,
	claim WebhookClaim,
	werr WebhookError,
) (*HandleEventResult, WebhookError) {
	if isRetryableWebhookError(werr) {
		if err := s.deps.Repo.DeleteEvent(ctx, eventID, claim); err != nil {
			slog.Error("Failed to release webhook event for retry", "eventId", eventID, "error", err)
			recordStripeWebhook(ctx, false, eventType)
			return nil, ErrDBError
		}
	}
	recordStripeWebhook(ctx, false, eventType)
	return nil, werr
}

func isRetryableWebhookError(werr WebhookError) bool {
	// Invalid events can become processable after config/user backfills
	// (for example, a newly introduced price ID not yet mapped), so release
	// the dedupe claim to allow replay.
	return werr == ErrDBError || werr == ErrStripeError || werr == ErrInvalidEvent
}

// parsedSubscription holds extracted subscription data for our domain
type parsedSubscription struct {
	ID                 string
	Status             string
	CustomerID         *string
	UserID             *int
	CancelAtPeriodEnd  bool
	CurrentPeriodStart *int64
	CurrentPeriodEnd   *int64
	PriceID            *string
}

type subscriptionIDField struct {
	ID string `json:"id"`
}

func (f *subscriptionIDField) UnmarshalJSON(data []byte) error {
	if string(data) == "null" {
		return nil
	}

	var id string
	if err := json.Unmarshal(data, &id); err == nil {
		f.ID = id
		return nil
	}

	var object struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(data, &object); err != nil {
		return err
	}
	f.ID = object.ID
	return nil
}

type stripeSubscriptionPayload struct {
	ID                string              `json:"id"`
	Status            string              `json:"status"`
	Customer          subscriptionIDField `json:"customer"`
	Metadata          map[string]string   `json:"metadata"`
	CancelAtPeriodEnd bool                `json:"cancel_at_period_end"`
	Items             struct {
		Data []struct {
			CurrentPeriodStart int64               `json:"current_period_start"`
			CurrentPeriodEnd   int64               `json:"current_period_end"`
			Price              subscriptionIDField `json:"price"`
		} `json:"data"`
	} `json:"items"`
}

func parseSubscription(data json.RawMessage) (*parsedSubscription, WebhookError) {
	var sub stripeSubscriptionPayload
	if err := json.Unmarshal(data, &sub); err != nil {
		return nil, ErrInvalidEvent
	}

	result := &parsedSubscription{
		ID:                sub.ID,
		Status:            sub.Status,
		CancelAtPeriodEnd: sub.CancelAtPeriodEnd,
	}

	// Customer is expanded in webhook payloads
	if sub.Customer.ID != "" {
		result.CustomerID = &sub.Customer.ID
	}

	// Extract user ID from metadata
	if userIDStr, ok := sub.Metadata["userId"]; ok {
		if uid, err := strconv.Atoi(userIDStr); err == nil {
			result.UserID = &uid
		}
	}

	// TaskForceAI currently sells one price per subscription. If multi-item
	// subscriptions are added, select the authoritative item instead of Data[0].
	// Period dates are on the first SubscriptionItem in stripe-go v82.
	if len(sub.Items.Data) > 0 {
		item := sub.Items.Data[0]
		if item.CurrentPeriodStart > 0 {
			result.CurrentPeriodStart = &item.CurrentPeriodStart
		}
		if item.CurrentPeriodEnd > 0 {
			result.CurrentPeriodEnd = &item.CurrentPeriodEnd
		}
		if item.Price.ID != "" {
			result.PriceID = &item.Price.ID
		}
	}

	return result, ""
}

func (s *WebhookService) findUserForSubscription(ctx context.Context, sub *parsedSubscription) (*WebhookUser, WebhookError) {
	if sub == nil {
		return nil, ErrInvalidEvent
	}
	if sub.UserID != nil {
		user, err := s.deps.Repo.FindUserByID(ctx, *sub.UserID)
		if err != nil && !errors.Is(err, ErrBillingUserNotFound) {
			return nil, ErrDBError
		}
		if err == nil && user != nil {
			return user, ""
		}
	}

	if sub.CustomerID == nil {
		return nil, ErrInvalidEvent
	}

	user, err := s.deps.Repo.FindUserByCustomerID(ctx, *sub.CustomerID)
	if errors.Is(err, ErrBillingUserNotFound) || (err == nil && user == nil) {
		return nil, ErrInvalidEvent
	}
	if err != nil {
		return nil, ErrDBError
	}

	return user, ""
}

func (s *WebhookService) handleSubscriptionUpdate(ctx context.Context, data json.RawMessage, eventCreatedAt *time.Time) WebhookError {
	sub, werr := parseSubscription(data)
	// parseSubscription only returns a nil result alongside a non-empty werr,
	// but the nil check keeps NilAway satisfied for the dereferences below.
	if werr != "" || sub == nil {
		return cmp.Or(werr, ErrInvalidEvent)
	}

	user, werr := s.findUserForSubscription(ctx, sub)
	if werr == ErrInvalidEvent && sub.CustomerID != nil {
		slog.Error("User not found for subscription", "subId", sub.ID, "cid", *sub.CustomerID)
		return "" // Continue processing
	}
	if werr != "" || user == nil {
		return cmp.Or(werr, ErrInvalidEvent)
	}
	if isStaleSubscriptionEvent(user, eventCreatedAt) {
		slog.Warn("Ignoring stale Stripe subscription event", "userId", user.ID, "subId", sub.ID, "eventCreatedAt", eventCreatedAt, "lastEventCreatedAt", user.StripeSubscriptionEventCreatedAt)
		return ""
	}
	if blocksSubscriptionReplacement(user, sub.ID) {
		slog.Warn("Ignoring update for non-current subscription", "userId", user.ID, "currentSubId", *user.SubscriptionID, "updatedSubId", sub.ID)
		return ""
	}

	plan := s.subscriptionPlanForUpdate(sub, user)

	source := SourceStripe
	update := WebhookUserUpdate{
		ClearSubscription:                false,
		SubscriptionID:                   &sub.ID,
		SubscriptionStatus:               &sub.Status,
		SubscriptionSource:               &source,
		CurrentPeriodStart:               TimestampToDate(ptrOr(sub.CurrentPeriodStart, 0)),
		CurrentPeriodEnd:                 TimestampToDate(ptrOr(sub.CurrentPeriodEnd, 0)),
		CancelAtPeriodEnd:                &sub.CancelAtPeriodEnd,
		StripeSubscriptionEventCreatedAt: eventCreatedAt,
		CustomerID:                       sub.CustomerID,
		Plan:                             &plan,
		PriceID:                          sub.PriceID,
		PaymentMethodBrand:               nil,
		PaymentMethodLast4:               nil,
		MobileProductID:                  nil,
		MobileOriginalTransactionID:      nil,
	}

	if err := s.deps.Repo.UpdateUser(ctx, user.ID, update); err != nil {
		return ErrDBError
	}

	slog.Info("Updated user subscription", "userId", user.ID, "status", sub.Status)
	if (user.SubscriptionID == nil || *user.SubscriptionID == "") && isActiveSubscriptionStatus(sub.Status) {
		recordSubscriptionChange(ctx, 1, plan)
	}
	return ""
}

func (s *WebhookService) subscriptionPlanForUpdate(sub *parsedSubscription, user *WebhookUser) string {
	plan := string(PlanFree)
	if sub == nil {
		return plan
	}
	if !isActiveSubscriptionStatus(sub.Status) {
		slog.Info("Downgrading inactive Stripe subscription entitlements", "status", sub.Status, "subId", sub.ID, "userId", userIDForLog(user))
		return plan
	}
	if planDef := s.deps.GetPlanByPriceID(sub.PriceID); planDef != nil {
		return string(planDef.Plan)
	}
	slog.Error("Unrecognized price ID for active subscription; downgrading entitlements to free", "priceId", ptrOr(sub.PriceID, "nil"), "subId", sub.ID, "userId", userIDForLog(user))
	return plan
}

func userIDForLog(user *WebhookUser) int {
	if user == nil {
		return 0
	}
	return user.ID
}

func isActiveSubscriptionStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "active", "trialing":
		return true
	default:
		return false
	}
}

func blocksSubscriptionReplacement(user *WebhookUser, incomingSubscriptionID string) bool {
	if user == nil || user.SubscriptionID == nil || strings.TrimSpace(*user.SubscriptionID) == "" {
		return false
	}
	if *user.SubscriptionID == incomingSubscriptionID {
		return false
	}
	if user.SubscriptionStatus == nil || strings.TrimSpace(*user.SubscriptionStatus) == "" {
		return true
	}
	return isOpenSubscriptionStatus(*user.SubscriptionStatus)
}

func isOpenSubscriptionStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "active", "trialing", "past_due", "unpaid", "incomplete":
		return true
	default:
		return false
	}
}

func (s *WebhookService) handleSubscriptionDeleted(ctx context.Context, data json.RawMessage, eventCreatedAt *time.Time) WebhookError {
	sub, werr := parseSubscription(data)
	// parseSubscription only returns a nil result alongside a non-empty werr,
	// but the nil check keeps NilAway satisfied for the dereferences below.
	if werr != "" || sub == nil {
		return cmp.Or(werr, ErrInvalidEvent)
	}

	user, werr := s.findUserForSubscription(ctx, sub)
	if werr == ErrInvalidEvent && sub.CustomerID != nil {
		slog.Error("User not found for delete", "subId", sub.ID, "cid", *sub.CustomerID)
		return ""
	}
	if werr != "" || user == nil {
		return cmp.Or(werr, ErrInvalidEvent)
	}

	if isStaleSubscriptionDeleteEvent(user, eventCreatedAt) {
		slog.Warn("Ignoring stale Stripe subscription delete event", "userId", user.ID, "subId", sub.ID, "eventCreatedAt", eventCreatedAt, "lastEventCreatedAt", user.StripeSubscriptionEventCreatedAt)
		return ""
	}

	if user.SubscriptionID != nil && *user.SubscriptionID != "" && *user.SubscriptionID != sub.ID {
		slog.Warn("Ignoring delete for non-current subscription", "userId", user.ID, "currentSubId", *user.SubscriptionID, "deletedSubId", sub.ID)
		return ""
	}

	freePlan := string(PlanFree)
	falseVal := false
	update := WebhookUserUpdate{
		ClearSubscription:                true,
		SubscriptionID:                   nil,
		SubscriptionStatus:               nil,
		SubscriptionSource:               nil,
		CurrentPeriodStart:               nil,
		CurrentPeriodEnd:                 nil,
		CancelAtPeriodEnd:                &falseVal,
		StripeSubscriptionEventCreatedAt: eventCreatedAt,
		CustomerID:                       nil,
		Plan:                             &freePlan,
		PriceID:                          nil,
		PaymentMethodBrand:               nil,
		PaymentMethodLast4:               nil,
		MobileProductID:                  nil,
		MobileOriginalTransactionID:      nil,
	}

	if err := s.deps.Repo.UpdateUser(ctx, user.ID, update); err != nil {
		return ErrDBError
	}

	slog.Info("Subscription cleared", "userId", user.ID, "subId", sub.ID)
	recordSubscriptionChange(ctx, -1, ptrOr(user.Plan, "unknown"))
	return ""
}

func isStaleSubscriptionEvent(user *WebhookUser, eventCreatedAt *time.Time) bool {
	return user != nil &&
		eventCreatedAt != nil &&
		user.StripeSubscriptionEventCreatedAt != nil &&
		!eventCreatedAt.After(*user.StripeSubscriptionEventCreatedAt)
}

func isStaleSubscriptionDeleteEvent(user *WebhookUser, eventCreatedAt *time.Time) bool {
	// Deletes win timestamp ties so same-second delivery order cannot restore paid entitlements.
	return user != nil &&
		eventCreatedAt != nil &&
		user.StripeSubscriptionEventCreatedAt != nil &&
		eventCreatedAt.Before(*user.StripeSubscriptionEventCreatedAt)
}

type parsedInvoice struct {
	ID         *string
	CustomerID *string
	AmountPaid *int64
	Currency   *string
	PriceID    *string
}

type stripeInvoicePayload struct {
	ID         string              `json:"id"`
	Customer   subscriptionIDField `json:"customer"`
	AmountPaid int64               `json:"amount_paid"`
	Currency   string              `json:"currency"`
	Lines      struct {
		Data []struct {
			Pricing *struct {
				PriceDetails *struct {
					Price string `json:"price"`
				} `json:"price_details"`
			} `json:"pricing"`
		} `json:"data"`
	} `json:"lines"`
}

func parseInvoice(data json.RawMessage) (*parsedInvoice, WebhookError) {
	var inv stripeInvoicePayload
	if err := json.Unmarshal(data, &inv); err != nil {
		return nil, ErrInvalidEvent
	}

	result := &parsedInvoice{
		ID: &inv.ID,
	}

	if inv.Customer.ID != "" {
		result.CustomerID = &inv.Customer.ID
	}

	if inv.AmountPaid > 0 {
		result.AmountPaid = &inv.AmountPaid
	}
	if inv.Currency != "" {
		currency := strings.ToUpper(inv.Currency)
		result.Currency = &currency
	}

	// TaskForceAI currently emits one subscription line per invoice. If
	// multi-line subscription invoices are added, select the authoritative line
	// instead of Data[0]. Price is in Lines.Data[].Pricing.PriceDetails.Price in stripe-go v82.
	if len(inv.Lines.Data) > 0 {
		line := inv.Lines.Data[0]
		if line.Pricing != nil && line.Pricing.PriceDetails != nil && line.Pricing.PriceDetails.Price != "" {
			result.PriceID = &line.Pricing.PriceDetails.Price
		}
	}

	return result, ""
}

func (s *WebhookService) handlePaymentSucceeded(ctx context.Context, data json.RawMessage) WebhookError {
	inv, werr := parseInvoice(data)
	// parseInvoice only returns a nil result alongside a non-empty werr, but the
	// nil check keeps NilAway satisfied for the dereferences below.
	if werr != "" || inv == nil {
		return cmp.Or(werr, ErrInvalidEvent)
	}

	if inv.CustomerID == nil {
		slog.Error("No customer ID on invoice", "invId", ptrOr(inv.ID, ""))
		return ErrInvalidEvent
	}

	user, err := s.deps.Repo.FindUserByCustomerID(ctx, *inv.CustomerID)
	if errors.Is(err, ErrBillingUserNotFound) || (err == nil && user == nil) {
		slog.Error("User not found for payment_succeeded invoice", "customerId", *inv.CustomerID, "invId", ptrOr(inv.ID, ""))
		return ErrInvalidEvent
	}
	if err != nil {
		return ErrDBError
	}

	var update WebhookUserUpdate
	if inv.PriceID != nil {
		update.PriceID = inv.PriceID
	}

	// Update if we have changes
	if update.PriceID != nil {
		if err := s.deps.Repo.UpdateUser(ctx, user.ID, update); err != nil {
			return ErrDBError
		}
		slog.Info("Payment metadata updated", "userId", user.ID)
	}

	if inv.AmountPaid != nil {
		currency := strings.ToUpper(ptrOr(inv.Currency, "USD"))
		amount := normalizeInvoiceAmount(*inv.AmountPaid, currency)
		s.sendPaymentConfirmationEmail(ctx, user, amount, currency)
		slog.Info("Payment confirmed", "userId", user.ID, "amount", amount)
		recordPayment(ctx, true, amount, currency)
	}

	return ""
}

func (s *WebhookService) sendPaymentConfirmationEmail(ctx context.Context, user *WebhookUser, amount float64, currency string) {
	if s.deps.EmailService == nil {
		return
	}
	if err := s.deps.EmailService.SendPaymentConfirmationEmail(
		ctx,
		user.Email,
		billingEmailDisplayName(user),
		ptrOr(user.Plan, string(PlanPro)),
		amount,
		currency,
	); err != nil {
		slog.Warn("Failed to send payment confirmation email", "userId", user.ID, "error", err)
		return
	}
	slog.Info("Payment email sent", "userId", user.ID)
}

func (s *WebhookService) sendSubscriptionFailureEmail(ctx context.Context, user *WebhookUser) {
	if s.deps.EmailService == nil {
		return
	}
	if err := s.deps.EmailService.SendSubscriptionFailureEmail(
		ctx,
		user.Email,
		billingEmailDisplayName(user),
		ptrOr(user.Plan, string(PlanPro)),
		"Payment declined",
	); err != nil {
		slog.Warn("Failed to send subscription failure email", "userId", user.ID, "error", err)
		return
	}
	slog.Info("Payment failure email sent", "userId", user.ID)
}

func billingEmailDisplayName(user *WebhookUser) string {
	if user.FullName != nil && *user.FullName != "" {
		return *user.FullName
	}
	return user.Email
}

func (s *WebhookService) handlePaymentFailed(ctx context.Context, data json.RawMessage) WebhookError {
	inv, werr := parseInvoice(data)
	// parseInvoice only returns a nil result alongside a non-empty werr, but the
	// nil check keeps NilAway satisfied for the dereferences below.
	if werr != "" || inv == nil {
		return cmp.Or(werr, ErrInvalidEvent)
	}

	if inv.CustomerID == nil {
		return ""
	}

	user, err := s.deps.Repo.FindUserByCustomerID(ctx, *inv.CustomerID)
	if errors.Is(err, ErrBillingUserNotFound) || (err == nil && user == nil) {
		return ""
	}
	if err != nil {
		return ErrDBError
	}

	s.sendSubscriptionFailureEmail(ctx, user)
	slog.Info("Payment failed", "userId", user.ID)
	recordPayment(ctx, false, 0, "USD")

	return ""
}

// Helper to dereference pointer or return default
func ptrOr[T any](p *T, def T) T {
	if p == nil {
		return def
	}
	return *p
}

var zeroDecimalCurrencies = map[string]struct{}{
	"BIF": {}, "CLP": {}, "DJF": {}, "GNF": {}, "JPY": {}, "KMF": {}, "KRW": {},
	"MGA": {}, "PYG": {}, "RWF": {}, "UGX": {}, "VND": {}, "VUV": {}, "XAF": {},
	"XOF": {}, "XPF": {},
}

// NormalizeInvoiceAmount converts Stripe minor units to a display value.
func NormalizeInvoiceAmount(amountMinor int64, currency string) float64 {
	if _, ok := zeroDecimalCurrencies[strings.ToUpper(currency)]; ok {
		return float64(amountMinor)
	}
	return float64(amountMinor) / 100.0
}

func normalizeInvoiceAmount(amountMinor int64, currency string) float64 {
	return NormalizeInvoiceAmount(amountMinor, currency)
}
