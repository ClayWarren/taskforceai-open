package handler

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	appdatabase "github.com/TaskForceAI/billing-service/pkg/database"
	postgres "github.com/TaskForceAI/infrastructure/postgres/pkg"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/billing-service/pkg/billing"
	"github.com/TaskForceAI/infrastructure/email/pkg"
	"github.com/jackc/pgx/v5"
	"github.com/stripe/stripe-go/v82"
)

var (
	MarketingBaseURL = GetEnv("MARKETING_URL", "https://www.taskforceai.chat")
	WebBaseURL       = GetEnv("WEB_URL", "https://www.taskforceai.chat")
	LoginPath        = "/login"
	CancelPath       = "/pricing"
)

var (
	GetQueries = appdatabase.GetQueries
	GetPool    = postgres.GetPool
)

type StripeCustomerClient interface {
	GetOrCreateCustomer(ctx context.Context, userID, email, existingCustomerID string) (*stripe.Customer, error)
	CreateCheckoutSession(ctx context.Context, params *stripe.CheckoutSessionParams) (*stripe.CheckoutSession, error)
	GetSubscription(ctx context.Context, id string, params *stripe.SubscriptionParams) (*stripe.Subscription, error)
	UpdateSubscription(ctx context.Context, id string, params *stripe.SubscriptionParams) (*stripe.Subscription, error)
}

var NewStripeClient = func() (StripeCustomerClient, error) {
	return billing.NewStripeClient()
}
var VerifyStripeWebhookSignature = billing.VerifyWebhookSignature

const MaxWebhookBodySize = 1024 * 1024

var ErrPayloadTooLarge = errors.New("payload too large")

func GetEnv(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

type revenueCatIdentityFields struct {
	AppUserID         string   `json:"app_user_id"`
	OriginalAppUserID string   `json:"original_app_user_id"`
	Aliases           []string `json:"aliases"`
	TransferredFrom   []string `json:"transferred_from"`
	TransferredTo     []string `json:"transferred_to"`
}

type RevenueCatPayload struct {
	revenueCatIdentityFields
	Event *revenueCatIdentityFields `json:"event"`
}

func revenueCatAppUserIDCandidates(payload RevenueCatPayload) []string {
	seen := make(map[string]struct{})
	candidates := make([]string, 0, 8)
	add := func(appUserID string) {
		appUserID = strings.TrimSpace(appUserID)
		if appUserID == "" {
			return
		}
		if _, ok := seen[appUserID]; ok {
			return
		}
		seen[appUserID] = struct{}{}
		candidates = append(candidates, appUserID)
	}

	addIdentityFields := func(fields revenueCatIdentityFields) {
		add(fields.AppUserID)
		add(fields.OriginalAppUserID)
		for _, appUserID := range fields.Aliases {
			add(appUserID)
		}
		for _, appUserID := range fields.TransferredFrom {
			add(appUserID)
		}
		for _, appUserID := range fields.TransferredTo {
			add(appUserID)
		}
	}

	if payload.Event != nil {
		addIdentityFields(*payload.Event)
	}
	addIdentityFields(payload.revenueCatIdentityFields)
	return candidates
}

func ReadWebhookPayload(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	r.Body = http.MaxBytesReader(w, r.Body, MaxWebhookBodySize)
	payload, err := io.ReadAll(r.Body)
	if err != nil {
		if _, ok := errors.AsType[*http.MaxBytesError](err); ok {
			return nil, ErrPayloadTooLarge
		}
		return nil, err
	}
	return payload, nil
}

func getBillingQueries(w http.ResponseWriter, r *http.Request) (*db.Queries, bool) {
	q, err := GetQueries(r.Context())
	if err != nil {
		handler.JSONError(w, http.StatusServiceUnavailable, "Database unavailable")
		return nil, false
	}
	return q, true
}

func getCheckoutQueries(w http.ResponseWriter, r *http.Request) (*db.Queries, bool) {
	q, err := GetQueries(r.Context())
	if err != nil {
		http.Redirect(w, r, MarketingBaseURL+CancelPath+"?error=unavailable", http.StatusFound)
		return nil, false
	}
	return q, true
}

func readPostWebhookPayload(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	if r.Method != http.MethodPost {
		handler.JSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return nil, false
	}

	payload, err := ReadWebhookPayload(w, r)
	if err != nil {
		if errors.Is(err, ErrPayloadTooLarge) {
			handler.JSONError(w, http.StatusRequestEntityTooLarge, "Payload too large")
			return nil, false
		}
		handler.JSONError(w, http.StatusBadRequest, "Failed to read request body")
		return nil, false
	}
	return payload, true
}

// StripeWebhookHandler processes Stripe webhooks.
func StripeWebhookHandler(w http.ResponseWriter, r *http.Request) {
	payload, ok := readPostWebhookPayload(w, r)
	if !ok {
		return
	}

	sig := r.Header.Get("Stripe-Signature")
	event, err := VerifyStripeWebhookSignature(payload, sig)
	if err != nil {
		handler.JSONError(w, http.StatusBadRequest, "Invalid signature")
		return
	}

	q, ok := getBillingQueries(w, r)
	if !ok {
		return
	}

	repo := billing.NewWebhookRepository(q)
	svc := billing.NewWebhookService(billing.WebhookDependencies{
		Repo:         repo,
		EmailService: email.DefaultService(),
	})

	result, werr := svc.HandleEvent(r.Context(), event)
	if werr != "" {
		if werr == billing.ErrInvalidEvent {
			slog.Warn("Ignoring invalid Stripe webhook event", "eventId", event.ID, "type", event.Type)
			handler.JSON(w, http.StatusOK, map[string]bool{"processed": false})
			return
		}
		handler.JSONError(w, http.StatusInternalServerError, string(werr))
		return
	}
	// HandleEvent only returns a nil result alongside a non-empty werr (handled
	// above); the nil-guard here keeps the dereference safe for NilAway.
	handler.JSON(w, http.StatusOK, map[string]bool{"processed": result != nil && result.Processed})
}

// VerifyRevenueCatSignature validates legacy HMAC-SHA256 signed webhook payloads.
func VerifyRevenueCatSignature(payload []byte, signature, secret string) bool {
	if secret == "" || signature == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(signature), []byte(expected))
}

func verifyRevenueCatWebhookAuth(r *http.Request, payload []byte, secret string) bool {
	authHeader := r.Header.Get("Authorization")
	if subtle.ConstantTimeCompare([]byte(authHeader), []byte("Bearer "+secret)) == 1 {
		return true
	}

	signature := r.Header.Get("X-RevenueCat-Signature")
	return VerifyRevenueCatSignature(payload, signature, secret)
}

// RevenueCatWebhookHandler processes RevenueCat webhooks.
func RevenueCatWebhookHandler(w http.ResponseWriter, r *http.Request) {
	payload, ok := readPostWebhookPayload(w, r)
	if !ok {
		return
	}

	secret := strings.TrimSpace(os.Getenv("REVENUECAT_WEBHOOK_SECRET"))
	if secret == "" {
		slog.Error("RevenueCat webhook secret is not configured")
		handler.JSONError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	if !verifyRevenueCatWebhookAuth(r, payload, secret) {
		slog.Warn("RevenueCat webhook authentication failed")
		handler.JSONError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	q, ok := getBillingQueries(w, r)
	if !ok {
		return
	}

	var rcPayload RevenueCatPayload
	if err := json.Unmarshal(payload, &rcPayload); err != nil {
		handler.JSONError(w, http.StatusBadRequest, "Invalid payload")
		return
	}

	appUserIDs := revenueCatAppUserIDCandidates(rcPayload)
	if len(appUserIDs) == 0 {
		handler.JSONError(w, http.StatusBadRequest, "Missing app_user_id")
		return
	}

	repo := billing.NewMobileSubscriptionRepository(q)
	svc := NewMobileSubscriptionService(repo)

	anySynced := false
	for _, appUserID := range appUserIDs {
		synced, err := syncRevenueCatWebhookCandidate(r.Context(), svc, appUserID)
		if err != nil {
			slog.Error("RevenueCat webhook sync failed", "error", err, "appUserId", appUserID)
			handler.JSONError(w, http.StatusInternalServerError, "Sync failed")
			return
		}
		if synced {
			anySynced = true
		}
	}
	if anySynced {
		handler.JSON(w, http.StatusOK, map[string]bool{"received": true})
		return
	}

	slog.Warn("RevenueCat webhook user not found; returning retryable response", "appUserIds", appUserIDs)
	handler.JSONError(w, http.StatusServiceUnavailable, "User not ready for subscription sync")
}

func syncRevenueCatWebhookCandidate(ctx context.Context, svc MobileSubscriptionService, appUserID string) (bool, error) {
	_, syncErr := svc.SyncMobileSubscriptionByAppUserID(ctx, appUserID)
	if syncErr == "" {
		return true, nil
	}
	if syncErr != billing.ErrUserNotFound {
		return false, fmt.Errorf("app-user sync failed: %s", syncErr)
	}

	userID, ok := revenueCatNumericAppUserID(appUserID)
	if !ok {
		return false, nil
	}
	_, err := svc.SyncMobileSubscriptionByUserID(ctx, userID)
	if err == nil {
		return true, nil
	}
	if errors.Is(err, billing.ErrMobileSyncUserNotFound) {
		return false, nil
	}
	return false, err
}

func revenueCatNumericAppUserID(appUserID string) (int, bool) {
	appUserID = strings.TrimSpace(appUserID)
	if appUserID == "" {
		return 0, false
	}
	id, err := strconv.Atoi(appUserID)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

// CheckoutHandler handles GET /api/v1/checkout?plan=pro|super
func CheckoutHandler(w http.ResponseWriter, r *http.Request) {
	if handler.HandleCORS(w, r) {
		return
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		handler.JSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	plan := r.URL.Query().Get("plan")

	q, ok := getCheckoutQueries(w, r)
	if !ok {
		return
	}

	dbUser, authEmail, err := loadBillingUserByEmailFromAuthContext(r, billing.NewPaymentsRepository(q))
	if err != nil {
		if errors.Is(err, errAuthRequired) {
			RedirectToLogin(w, r, plan)
			return
		}
		slog.Error("Checkout: user not found", "error", err, "email", authEmail)
		RedirectToLogin(w, r, plan)
		return
	}

	if dbUser.Disabled {
		http.Redirect(w, r, MarketingBaseURL+CancelPath+"?error=disabled", http.StatusFound)
		return
	}
	if hasOpenSubscription(dbUser) {
		subscriptionID := ""
		if dbUser.SubscriptionID != nil {
			subscriptionID = *dbUser.SubscriptionID
		}
		slog.Warn("Checkout rejected because user already has an open subscription", "userId", dbUser.ID, "subscriptionId", subscriptionID)
		http.Redirect(w, r, MarketingBaseURL+CancelPath+"?error=active_subscription", http.StatusFound)
		return
	}

	if isCrossSiteCheckoutRequest(r) {
		slog.Warn("Checkout rejected due to cross-site request context", "secFetchSite", strings.TrimSpace(strings.ToLower(r.Header.Get("Sec-Fetch-Site"))))
		http.Redirect(w, r, MarketingBaseURL+CancelPath+"?error=forbidden", http.StatusFound)
		return
	}

	priceID, err := resolveHostedCheckoutPriceID(plan)
	if err != nil {
		if errors.Is(err, errInvalidHostedPlanSelection) {
			http.Redirect(w, r, MarketingBaseURL+CancelPath, http.StatusFound)
			return
		}
		http.Redirect(w, r, MarketingBaseURL+CancelPath+"?error=invalid_plan", http.StatusFound)
		return
	}

	stripeClient, stripeCustomer, priorCustomerID, err := getStripeCheckoutContext(r.Context(), dbUser)
	if err != nil {
		if errors.Is(err, errStripeNotConfigured) {
			http.Redirect(w, r, MarketingBaseURL+CancelPath+"?error=config", http.StatusFound)
			return
		}
		http.Redirect(w, r, MarketingBaseURL+CancelPath+"?error=customer", http.StatusFound)
		return
	}

	persistStripeCustomerIDIfChanged(r.Context(), billing.NewPaymentsRepository(q), dbUser.ID, priorCustomerID, stripeCustomer.ID, "Checkout")

	sess, err := createSubscriptionCheckoutSession(
		r.Context(),
		stripeClient,
		stripeCustomer.ID,
		subscriptionCheckoutSessionOptions{
			UserID:               dbUser.ID,
			PriceID:              priceID,
			SuccessURL:           checkoutSuccessURL(r, true),
			CancelURL:            checkoutCancelURL(r),
			AllowPromotionCodes:  true,
			SubscriptionMetadata: checkoutMetadata(dbUser, plan, ""),
		},
	)
	if err != nil {
		http.Redirect(w, r, MarketingBaseURL+CancelPath+"?error=checkout", http.StatusFound)
		return
	}

	slog.Info("Hosted checkout session created", "userId", dbUser.ID, "plan", plan, "hasPriorCustomer", priorCustomerID != "")
	http.Redirect(w, r, sess.URL, http.StatusFound)
}

func isCrossSiteCheckoutRequest(r *http.Request) bool {
	secFetchSite := strings.TrimSpace(strings.ToLower(r.Header.Get("Sec-Fetch-Site")))
	return secFetchSite == "cross-site"
}

func validateSubscriptionCancellationChange(dbUser *billing.PaymentsAccountUser, cancelAtPeriodEnd bool) error {
	if dbUser.SubscriptionID == nil {
		if cancelAtPeriodEnd {
			return errors.New("no active subscription found to cancel")
		}
		return errors.New("subscription is not scheduled for cancellation")
	}
	if !cancelAtPeriodEnd && !dbUser.CancelAtPeriodEnd {
		return errors.New("subscription is not scheduled for cancellation")
	}
	if !isStripeManagedSubscription(dbUser) {
		if cancelAtPeriodEnd {
			return errors.New("only Stripe subscriptions can be cancelled via this endpoint")
		}
		return errors.New("only Stripe subscriptions can be reactivated via this endpoint")
	}
	return nil
}

func hasOpenSubscription(dbUser *billing.PaymentsAccountUser) bool {
	if hasOpenRevenueCatSubscription(dbUser) {
		return true
	}
	if dbUser == nil || dbUser.SubscriptionID == nil || strings.TrimSpace(*dbUser.SubscriptionID) == "" {
		return false
	}
	if dbUser.SubscriptionStatus == nil || strings.TrimSpace(*dbUser.SubscriptionStatus) == "" {
		return true
	}
	switch strings.ToLower(strings.TrimSpace(*dbUser.SubscriptionStatus)) {
	case "active", "trialing", "past_due", "unpaid":
		return true
	default:
		return false
	}
}

func hasOpenRevenueCatSubscription(user *billing.PaymentsAccountUser) bool {
	if user == nil || user.RevenueCatAppUserID == nil || strings.TrimSpace(*user.RevenueCatAppUserID) == "" || user.Plan == string(billing.PlanFree) {
		return false
	}
	if user.SubscriptionStatus == nil || strings.TrimSpace(*user.SubscriptionStatus) == "" {
		return true
	}
	switch strings.ToLower(strings.TrimSpace(*user.SubscriptionStatus)) {
	case "active", "trialing":
		return true
	default:
		return false
	}
}

// Helpers

func RedirectToLogin(w http.ResponseWriter, r *http.Request, plan string) {
	callbackURL := "/api/v1/checkout?plan=" + url.QueryEscape(plan)
	loginURL := WebBaseURL + LoginPath + "?plan=" + url.QueryEscape(plan) + "&callbackUrl=" + url.QueryEscape(callbackURL)
	http.Redirect(w, r, loginURL, http.StatusFound)
}

func ResolveOrigin(r *http.Request) string {
	return resolveOrigin(r.Header.Get("Origin"))
}

func resolveOrigin(originHeader string) string {
	fallbackOrigin := "https://www.taskforceai.chat"
	if siteURL := strings.TrimSpace(os.Getenv("NEXT_PUBLIC_SITE_URL")); siteURL != "" {
		if normalized, ok := normalizeOrigin(siteURL); ok {
			fallbackOrigin = normalized
		}
	}

	trustedOrigins := map[string]struct{}{
		fallbackOrigin: {},
	}
	for _, allowed := range handler.AllowedOrigins() {
		if normalized, ok := normalizeOrigin(allowed); ok {
			trustedOrigins[normalized] = struct{}{}
		}
	}

	origin := strings.TrimSpace(originHeader)
	if origin == "" {
		return fallbackOrigin
	}

	normalizedOrigin, ok := normalizeOrigin(origin)
	if !ok {
		slog.Warn("Checkout received malformed origin header", "origin", origin)
		return fallbackOrigin
	}

	if _, exists := trustedOrigins[normalizedOrigin]; !exists {
		slog.Warn("Checkout received untrusted origin header", "origin", normalizedOrigin)
		return fallbackOrigin
	}

	return normalizedOrigin
}

func normalizeOrigin(origin string) (string, bool) {
	trimmed := strings.TrimSpace(origin)
	if trimmed == "" {
		return "", false
	}

	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", false
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", false
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", false
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", false
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return "", false
	}

	return strings.ToLower(parsed.Scheme) + "://" + strings.ToLower(parsed.Host), true
}

func syncSubscription(ctx context.Context, repo billing.PaymentsRepository, user *billing.PaymentsAccountUser) {
	if user == nil || user.SubscriptionID == nil || !isStripeManagedSubscription(user) {
		return
	}

	stripeClient, err := NewStripeClient()
	if err != nil {
		return
	}

	sub, err := stripeClient.GetSubscription(ctx, *user.SubscriptionID, nil)
	if err != nil {
		return
	}

	update := stripeSubscriptionUpdate(sub)
	if err := repo.UpdateSubscription(ctx, user.ID, update); err != nil {
		slog.Warn("SyncSubscription: failed to update subscription in DB", "error", err, "userId", user.ID)
	}
}

func stripeSubscriptionUpdate(sub *stripe.Subscription) billing.SubscriptionUpdate {
	if sub == nil {
		return billing.SubscriptionUpdate{}
	}

	status := strings.ToLower(strings.TrimSpace(string(sub.Status)))
	if status == "canceled" || status == "incomplete_expired" {
		freePlan := string(billing.PlanFree)
		return billing.SubscriptionUpdate{ClearSubscription: true, Plan: &freePlan}
	}

	source := billing.SourceStripe
	update := billing.SubscriptionUpdate{
		SubscriptionID:     &sub.ID,
		SubscriptionSource: &source,
		SubscriptionStatus: stripe.String(string(sub.Status)),
		CancelAtPeriodEnd:  &sub.CancelAtPeriodEnd,
	}

	if sub.Items != nil && len(sub.Items.Data) > 0 {
		item := sub.Items.Data[0]
		update.CurrentPeriodStart = billing.TimestampToDate(item.CurrentPeriodStart)
		update.CurrentPeriodEnd = billing.TimestampToDate(item.CurrentPeriodEnd)
		if item.Price != nil && strings.TrimSpace(item.Price.ID) != "" {
			update.PriceID = &item.Price.ID
		}
	}

	if status == "active" || status == "trialing" {
		if planDef := billing.GetPlanByPriceId(update.PriceID); planDef != nil {
			plan := string(planDef.Plan)
			update.Plan = &plan
		} else {
			slog.Warn("SyncSubscription: preserving plan for unmapped active Stripe price", "subscriptionId", sub.ID, "priceId", ptrString(update.PriceID))
		}
	} else {
		freePlan := string(billing.PlanFree)
		update.Plan = &freePlan
	}

	return update
}

func ptrString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func shouldSyncStripeSubscription(user *billing.PaymentsAccountUser, forceSync bool) bool {
	if user == nil || user.SubscriptionID == nil {
		return false
	}
	if !forceSync && user.SubscriptionStatus != nil {
		return false
	}
	return isStripeManagedSubscription(user)
}

func syncStripeSubscriptionAndReload(
	ctx context.Context,
	repo billing.PaymentsRepository,
	user *billing.PaymentsAccountUser,
) *billing.PaymentsAccountUser {
	syncSubscription(ctx, repo, user)

	updatedUser, err := repo.FindUserByID(ctx, user.ID)
	if errors.Is(err, billing.ErrBillingUserNotFound) || (err == nil && updatedUser == nil) {
		return user
	}
	if err != nil {
		slog.Warn("Failed to refetch user after sub sync", "error", err, "userId", user.ID)
		return user
	}
	return updatedUser
}

func subscriptionResponse(user *billing.PaymentsAccountUser) any {
	if user == nil || (user.SubscriptionID == nil && !hasOpenRevenueCatSubscription(user)) {
		return nil
	}
	response := map[string]any{
		"status":               "unknown",
		"cancel_at_period_end": user.CancelAtPeriodEnd,
	}
	if user.SubscriptionID != nil {
		response["subscription_id"] = *user.SubscriptionID
	}
	if user.SubscriptionStatus != nil {
		response["status"] = *user.SubscriptionStatus
	}
	if user.CurrentPeriodStart != nil {
		response["current_period_start"] = user.CurrentPeriodStart.Unix()
	}
	if user.CurrentPeriodEnd != nil {
		response["current_period_end"] = user.CurrentPeriodEnd.Unix()
	}
	return response
}

// Interfaces

type MobileSubscriptionService interface {
	SyncMobileSubscriptionByUserID(ctx context.Context, userID int) (*billing.MobileSyncResult, error)
	SyncMobileSubscriptionByAppUserID(ctx context.Context, appUserID string) (*billing.MobileSyncResult, billing.MobileSyncError)
}

var NewMobileSubscriptionService = func(repo billing.MobileSubscriptionRepository) MobileSubscriptionService {
	return billing.NewMobileSubscriptionService(repo)
}

var errAuthRequired = errors.New("auth required")
var errBillingUserLookupByEmail = errors.New("billing user lookup by email failed")
var errInvalidHostedPlanSelection = errors.New("invalid hosted plan selection")
var errHostedPlanNotConfigured = errors.New("hosted plan not configured")
var errInvalidAPICheckoutPriceSelection = errors.New("invalid api checkout price selection")
var errStripeNotConfigured = errors.New("stripe not configured")
var errStripeCustomerLookup = errors.New("stripe customer lookup failed")

type subscriptionCheckoutSessionOptions struct {
	UserID               int
	PriceID              string
	SuccessURL           string
	CancelURL            string
	AllowPromotionCodes  bool
	SubscriptionMetadata map[string]string
}

func isStripeManagedSubscription(user *billing.PaymentsAccountUser) bool {
	if user == nil {
		return false
	}
	// Backward compatibility: old rows may not have subscription_source set.
	if user.SubscriptionSource == nil {
		if user.SubscriptionID == nil && user.RevenueCatAppUserID != nil && strings.TrimSpace(*user.RevenueCatAppUserID) != "" {
			return false
		}
		return true
	}
	return *user.SubscriptionSource == billing.SourceStripe
}

func updateSubscriptionCancellationState(
	ctx context.Context,
	repo billing.PaymentsRepository,
	dbUser *billing.PaymentsAccountUser,
	cancelAtPeriodEnd bool,
	logPrefix string,
) error {
	stripeClient, err := NewStripeClient()
	if err != nil {
		return errStripeNotConfigured
	}

	params := &stripe.SubscriptionParams{CancelAtPeriodEnd: new(bool)}
	*params.CancelAtPeriodEnd = cancelAtPeriodEnd
	sub, err := stripeClient.UpdateSubscription(ctx, *dbUser.SubscriptionID, params)
	if err != nil {
		slog.Error(logPrefix+": Stripe update failed", "error", err, "userId", dbUser.ID)
		return err
	}

	err = repo.UpdateSubscription(ctx, dbUser.ID, billing.SubscriptionUpdate{
		CancelAtPeriodEnd:  &cancelAtPeriodEnd,
		SubscriptionStatus: stripe.String(string(sub.Status)),
	})
	if err != nil {
		slog.Error(logPrefix+": DB update failed", "error", err, "userId", dbUser.ID)
		return err
	}

	return nil
}

func loadBillingUserByEmailFromAuthContext(
	r *http.Request,
	repo billing.PaymentsRepository,
) (*billing.PaymentsAccountUser, string, error) {
	user := handler.GetAuthenticatedUser(r)
	if user == nil {
		return nil, "", errAuthRequired
	}

	dbUser, err := repo.FindUserByEmail(r.Context(), user.Email)
	if errors.Is(err, billing.ErrBillingUserNotFound) || (err == nil && dbUser == nil) {
		return nil, user.Email, fmt.Errorf("%w: %w", errBillingUserLookupByEmail, pgx.ErrNoRows)
	}
	if err != nil {
		return nil, user.Email, fmt.Errorf("%w: %w", errBillingUserLookupByEmail, err)
	}
	return dbUser, user.Email, nil
}

func resolveHostedCheckoutPriceID(plan string) (string, error) {
	planDef := billing.GetPlanByName(plan)
	if planDef == nil {
		return "", errInvalidHostedPlanSelection
	}
	if planDef.StripePriceID == nil {
		return "", errHostedPlanNotConfigured
	}

	return *planDef.StripePriceID, nil
}

func resolveAPICheckoutPlanByPriceID(priceID string) (*billing.BillingPlanDefinition, error) {
	planDef := billing.GetPlanByPriceId(&priceID)
	if planDef == nil {
		return nil, errInvalidAPICheckoutPriceSelection
	}

	return planDef, nil
}

func checkoutSuccessURL(r *http.Request, includeSessionID bool) string {
	return checkoutSuccessURLForOrigin(ResolveOrigin(r), includeSessionID)
}

func checkoutSuccessURLForOrigin(origin string, includeSessionID bool) string {
	url := origin + "/home?checkout=success"
	if includeSessionID {
		url += "&session_id={CHECKOUT_SESSION_ID}"
	}
	return url
}

func checkoutCancelURL(r *http.Request) string {
	return checkoutCancelURLForOrigin(ResolveOrigin(r))
}

func checkoutCancelURLForOrigin(origin string) string {
	return origin + "/pricing?checkout=cancelled"
}

func checkoutMetadata(dbUser *billing.PaymentsAccountUser, plan, customerID string) map[string]string {
	metadata := map[string]string{
		"userId": fmt.Sprintf("%d", dbUser.ID),
		"email":  dbUser.Email,
		"plan":   plan,
	}
	if customerID != "" {
		metadata["customerId"] = customerID
	}
	return metadata
}

func getOrCreateStripeCustomerForUser(
	ctx context.Context,
	stripeClient StripeCustomerClient,
	dbUser *billing.PaymentsAccountUser,
) (*stripe.Customer, string, error) {
	customerID := ""
	if dbUser.CustomerID != nil {
		customerID = *dbUser.CustomerID
	}

	stripeCustomer, err := stripeClient.GetOrCreateCustomer(
		ctx,
		fmt.Sprintf("%d", dbUser.ID),
		dbUser.Email,
		customerID,
	)
	if err != nil {
		return nil, customerID, err
	}

	return stripeCustomer, customerID, nil
}

func getStripeCheckoutContext(
	ctx context.Context,
	dbUser *billing.PaymentsAccountUser,
) (StripeCustomerClient, *stripe.Customer, string, error) {
	stripeClient, err := NewStripeClient()
	if err != nil {
		return nil, nil, "", errStripeNotConfigured
	}

	stripeCustomer, priorCustomerID, err := getOrCreateStripeCustomerForUser(ctx, stripeClient, dbUser)
	if err != nil {
		return nil, nil, "", fmt.Errorf("%w: %w", errStripeCustomerLookup, err)
	}

	return stripeClient, stripeCustomer, priorCustomerID, nil
}

func persistStripeCustomerIDIfChanged(
	ctx context.Context,
	repo billing.PaymentsRepository,
	userID int,
	priorCustomerID string,
	stripeCustomerID string,
	logPrefix string,
) {
	if priorCustomerID == stripeCustomerID {
		return
	}

	err := repo.UpdateCustomerID(ctx, userID, stripeCustomerID)
	if err != nil {
		slog.Error(logPrefix+": failed to update customer ID", "error", err, "userId", userID)
	}
}

func buildSubscriptionCheckoutParams(
	userID int,
	customerID string,
	priceID string,
	successURL string,
	cancelURL string,
	attemptID string,
) *stripe.CheckoutSessionParams {
	return &stripe.CheckoutSessionParams{
		Params: stripe.Params{
			IdempotencyKey: stripe.String(checkoutIdempotencyKey(userID, priceID, attemptID)),
		},
		Mode:     stripe.String(string(stripe.CheckoutSessionModeSubscription)),
		Customer: stripe.String(customerID),
		LineItems: []*stripe.CheckoutSessionLineItemParams{
			{
				Price:    stripe.String(priceID),
				Quantity: stripe.Int64(1),
			},
		},
		SuccessURL: stripe.String(successURL),
		CancelURL:  stripe.String(cancelURL),
	}
}

func checkoutIdempotencyKey(userID int, priceID, attemptID string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(priceID) + "\x00" + strings.TrimSpace(attemptID)))
	return fmt.Sprintf("billing-checkout-%d-%x", userID, digest[:12])
}

func createSubscriptionCheckoutSession(
	ctx context.Context,
	stripeClient StripeCustomerClient,
	customerID string,
	opts subscriptionCheckoutSessionOptions,
) (*stripe.CheckoutSession, error) {
	params := buildSubscriptionCheckoutParams(opts.UserID, customerID, opts.PriceID, opts.SuccessURL, opts.CancelURL, rand.Text())
	if opts.AllowPromotionCodes {
		params.AllowPromotionCodes = new(true)
	}
	if len(opts.SubscriptionMetadata) > 0 {
		params.SubscriptionData = &stripe.CheckoutSessionSubscriptionDataParams{
			Metadata: opts.SubscriptionMetadata,
		}
	}

	return stripeClient.CreateCheckoutSession(ctx, params)
}
