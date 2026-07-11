package billing

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/claywarren/revenuecat"
)

// MobileSyncResult represents the result of a mobile subscription sync
type MobileSyncResult struct {
	Plan               string  `json:"plan"`
	SubscriptionStatus *string `json:"subscription_status"`
	SubscriptionSource *string `json:"subscription_source"`
	CurrentPeriodEnd   *string `json:"current_period_end"`
}

// MobileSyncError represents an error from mobile sync
type MobileSyncError string

const (
	ErrUserNotFound    MobileSyncError = "USER_NOT_FOUND"
	ErrRevenueCatError MobileSyncError = "REVENUECAT_ERROR"
	ErrSyncFailed      MobileSyncError = "SYNC_FAILED"
)

var mobileSources = map[SubscriptionSource]bool{
	SourceAppStore:  true,
	SourcePlayStore: true,
}

var (
	errRevenueCatFetchFailed = errors.New("revenuecat fetch failed")
	// ErrMobileSyncUserNotFound identifies a missing numeric user fallback during mobile subscription sync.
	ErrMobileSyncUserNotFound = errors.New("mobile sync user not found")
)

// RevenueCatFetcher is an interface for fetching RevenueCat subscriber data
type RevenueCatFetcher interface {
	FetchSubscriber(ctx context.Context, appUserID string) (*revenuecat.Subscriber, RevenueCatError)
}

// DefaultRevenueCatFetcher implements RevenueCatFetcher using the global function
type DefaultRevenueCatFetcher struct{}

// FetchSubscriber fetches subscriber data from RevenueCat using the default client
func (f *DefaultRevenueCatFetcher) FetchSubscriber(ctx context.Context, appUserID string) (*revenuecat.Subscriber, RevenueCatError) {
	return FetchRevenueCatSubscriber(ctx, appUserID)
}

// MobileSubscriptionService handles mobile subscription synchronization
type MobileSubscriptionService struct {
	repo              MobileSubscriptionRepository
	revenueCatFetcher RevenueCatFetcher
}

// NewMobileSubscriptionService creates a new mobile subscription service
func NewMobileSubscriptionService(repo MobileSubscriptionRepository) *MobileSubscriptionService {
	return &MobileSubscriptionService{
		repo:              repo,
		revenueCatFetcher: &DefaultRevenueCatFetcher{},
	}
}

// SyncMobileSubscriptionByUserID syncs a user's mobile subscription by user ID
func (s *MobileSubscriptionService) SyncMobileSubscriptionByUserID(ctx context.Context, userID int) (*MobileSyncResult, error) {
	user, err := s.repo.FindUserByID(ctx, userID)
	if errors.Is(err, ErrBillingUserNotFound) || (err == nil && user == nil) {
		return nil, fmt.Errorf("%w: %d", ErrMobileSyncUserNotFound, userID)
	}
	if err != nil {
		return nil, err
	}
	return s.syncMobileSubscription(ctx, user)
}

// SyncMobileSubscriptionByAppUserID syncs a user's mobile subscription by app user ID
func (s *MobileSubscriptionService) SyncMobileSubscriptionByAppUserID(ctx context.Context, appUserID string) (*MobileSyncResult, MobileSyncError) {
	user, err := s.repo.FindUserByAppUserID(ctx, appUserID)
	if errors.Is(err, ErrBillingUserNotFound) || (err == nil && user == nil) {
		slog.Warn("User not found", "appUserId", appUserID)
		return nil, ErrUserNotFound
	}
	if err != nil {
		slog.Error("Failed to find user by app user ID", "error", err, "appUserId", appUserID)
		return nil, ErrSyncFailed
	}
	result, syncErr := s.syncMobileSubscription(ctx, user)
	if syncErr != nil {
		if errors.Is(syncErr, errRevenueCatFetchFailed) {
			return nil, ErrRevenueCatError
		}
		return nil, ErrSyncFailed
	}
	return result, ""
}

func (s *MobileSubscriptionService) syncMobileSubscription(ctx context.Context, user *MobileSyncUser) (*MobileSyncResult, error) {
	// Skip Stripe users with active subscriptions
	if user.SubscriptionSource != nil && *user.SubscriptionSource == SourceStripe &&
		(user.Plan == "pro" || user.Plan == "super") {
		slog.Info("Skip Stripe user", "uid", user.ID)
		return formatSyncResult(user), nil
	}

	if strings.TrimSpace(os.Getenv("REVENUECAT_SECRET_KEY")) == "" {
		return nil, fmt.Errorf("REVENUECAT_SECRET_KEY not configured")
	}

	appUserID := revenueCatAppUserIDForMobileSync(user)

	// Fetch from RevenueCat
	sub, rcErr := s.revenueCatFetcher.FetchSubscriber(ctx, appUserID)

	// Handle RevenueCat errors or missing subscriber
	if rcErr != "" || sub == nil || sub.Entitlements == nil {
		if rcErr == ErrRevenueCatNotFound || (sub != nil && sub.Entitlements == nil) {
			return s.resetSubscription(ctx, user)
		}
		return nil, fmt.Errorf("%w: RevenueCat fetch failed", errRevenueCatFetchFailed)
	}

	// Find active entitlement
	activeEntitlementID, activeEntitlement := s.determineActiveEntitlement(sub.Entitlements)

	if activeEntitlement == nil {
		slog.Info("No active entitlements", "uid", user.ID)
		return s.resetSubscription(ctx, user)
	}

	// Resolve plan
	planDef := ResolvePlanFromRevenueCat(&activeEntitlementID, &activeEntitlement.ProductIdentifier)
	if planDef == nil {
		slog.Warn("Plan mismatch", "uid", user.ID, "eid", activeEntitlementID, "pid", activeEntitlement.ProductIdentifier)
		return s.resetSubscription(ctx, user)
	}

	// Build update
	update := s.buildSubscriptionUpdate(user, sub, activeEntitlement, appUserID, planDef)

	updated, err := s.repo.UpdateUser(ctx, user.ID, update)
	if err != nil {
		return nil, fmt.Errorf("failed to sync mobile subscription")
	}

	slog.Info("Synced mobile subscription", "uid", user.ID, "plan", updated.Plan, "src", updated.SubscriptionSource)
	return formatSyncResult(updated), nil
}

func revenueCatAppUserIDForMobileSync(user *MobileSyncUser) string {
	if user == nil {
		return ""
	}
	if user.RevenueCatAppUserID != nil {
		if appUserID := strings.TrimSpace(*user.RevenueCatAppUserID); appUserID != "" {
			return appUserID
		}
	}
	if user.ID > 0 {
		return strconv.Itoa(user.ID)
	}
	return ""
}

func (s *MobileSubscriptionService) resetSubscription(ctx context.Context, user *MobileSyncUser) (*MobileSyncResult, error) {
	if user.SubscriptionSource != nil && mobileSources[*user.SubscriptionSource] {
		freePlan := "free"
		falseVal := false
		updated, err := s.repo.UpdateUser(ctx, user.ID, MobileSubscriptionUpdate{
			ClearSubscription:           true,
			Plan:                        &freePlan,
			SubscriptionID:              nil,
			SubscriptionStatus:          nil,
			SubscriptionSource:          nil,
			CurrentPeriodEnd:            nil,
			CurrentPeriodStart:          nil,
			CancelAtPeriodEnd:           &falseVal,
			PriceID:                     nil,
			MobileProductID:             nil,
			MobileOriginalTransactionID: nil,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to reset subscription")
		}
		return formatSyncResult(updated), nil
	}
	return formatSyncResult(user), nil
}

func (s *MobileSubscriptionService) determineActiveEntitlement(entitlements map[string]revenuecat.Entitlement) (string, *revenuecat.Entitlement) {
	now := time.Now()
	var bestID string
	var bestE revenuecat.Entitlement
	var found bool
	var bestRank int

	entitlementIDs := make([]string, 0, len(entitlements))
	for eid := range entitlements {
		entitlementIDs = append(entitlementIDs, eid)
	}
	sort.Strings(entitlementIDs)

	for _, eid := range entitlementIDs {
		e := entitlements[eid]
		// Is it active?
		if e.ExpiresDate != nil && e.ExpiresDate.Before(now) &&
			(e.GracePeriodExpiresDate == nil || e.GracePeriodExpiresDate.Before(now)) {
			continue
		}

		rank := 0
		if planDef := ResolvePlanFromRevenueCat(&eid, &e.ProductIdentifier); planDef != nil {
			switch planDef.Plan {
			case PlanSuper:
				rank = 3
			case PlanPro:
				rank = 2
			case PlanFree:
				rank = 1
			}
		}

		if !found {
			bestID = eid
			bestE = e
			found = true
			bestRank = rank
			continue
		}

		// Higher rank wins
		if rank > bestRank {
			bestID = eid
			bestE = e
			bestRank = rank
			continue
		}

		// Same rank, pick the one expiring later (or no expiry)
		if rank == bestRank {
			if e.ExpiresDate == nil && bestE.ExpiresDate != nil {
				bestID = eid
				bestE = e
				continue
			}
			if e.ExpiresDate != nil && bestE.ExpiresDate != nil && e.ExpiresDate.After(*bestE.ExpiresDate) {
				bestID = eid
				bestE = e
				continue
			}
		}
	}

	if !found {
		return "", nil
	}
	return bestID, &bestE
}

func (s *MobileSubscriptionService) buildSubscriptionUpdate(user *MobileSyncUser, sub *revenuecat.Subscriber, activeEntitlement *revenuecat.Entitlement, appUserID string, planDef *BillingPlanDefinition) MobileSubscriptionUpdate {
	// Get subscription details
	var subDetail *revenuecat.Subscription
	if sub.Subscriptions != nil {
		if detail, ok := sub.Subscriptions[activeEntitlement.ProductIdentifier]; ok {
			subDetail = &detail
		}
	}

	expiryTime := latestTime(activeEntitlement.ExpiresDate, activeEntitlement.GracePeriodExpiresDate)
	if subDetail != nil {
		expiryTime = latestTime(expiryTime, subDetail.ExpiresDate)
	}

	// Determine source
	var source *SubscriptionSource
	if subDetail != nil {
		src, err := MapStoreToSource(subDetail.Store)
		if err != "" {
			slog.Warn("Unknown or unsupported store in subscription", "userId", user.ID, "store", subDetail.Store, "error", err)
		}
		source = src
	}
	if source == nil {
		source = sourceFromPlanProduct(planDef, activeEntitlement.ProductIdentifier)
	}

	// Determine status
	status := "active"
	if expiryTime != nil && expiryTime.Before(time.Now()) {
		status = "expired"
	}

	// Build update
	plan := string(planDef.Plan)
	cancelAtPeriodEnd := subDetail != nil && subDetail.UnsubscribeDetectedAt != nil

	update := MobileSubscriptionUpdate{
		Plan:                &plan,
		SubscriptionStatus:  &status,
		SubscriptionSource:  source,
		PriceID:             &activeEntitlement.ProductIdentifier,
		RevenueCatAppUserID: &appUserID,
		MobileProductID:     &activeEntitlement.ProductIdentifier,
		CancelAtPeriodEnd:   &cancelAtPeriodEnd,
	}

	// Set subscription ID
	if subDetail != nil && subDetail.StoreTransactionID != "" {
		txnID := subDetail.StoreTransactionID
		update.SubscriptionID = &txnID
		update.MobileOriginalTransactionID = &txnID
	} else if user.SubscriptionID != nil {
		update.SubscriptionID = user.SubscriptionID
	}

	// Set period dates
	if subDetail != nil {
		purchaseDate := subDetail.PurchaseDate
		update.CurrentPeriodStart = &purchaseDate
	} else if user.CurrentPeriodStart != nil {
		update.CurrentPeriodStart = user.CurrentPeriodStart
	}

	if expiryTime != nil {
		update.CurrentPeriodEnd = expiryTime
	} else if user.CurrentPeriodEnd != nil {
		update.CurrentPeriodEnd = user.CurrentPeriodEnd
	}

	return update
}

func latestTime(times ...*time.Time) *time.Time {
	var latest *time.Time
	for _, t := range times {
		if t == nil {
			continue
		}
		if latest == nil || t.After(*latest) {
			latest = t
		}
	}
	return latest
}

func sourceFromPlanProduct(planDef *BillingPlanDefinition, productIdentifier string) *SubscriptionSource {
	if planDef == nil || productIdentifier == "" {
		return nil
	}
	if planDef.AppStoreProductID != nil && *planDef.AppStoreProductID == productIdentifier {
		src := SourceAppStore
		return &src
	}
	if planDef.PlayStoreProductID != nil && *planDef.PlayStoreProductID == productIdentifier {
		src := SourcePlayStore
		return &src
	}
	return nil
}

func formatSyncResult(user *MobileSyncUser) *MobileSyncResult {
	result := &MobileSyncResult{
		Plan: user.Plan,
	}
	if result.Plan == "" {
		result.Plan = "free"
	}
	if user.SubscriptionStatus != nil {
		result.SubscriptionStatus = user.SubscriptionStatus
	}
	if user.SubscriptionSource != nil {
		src := string(*user.SubscriptionSource)
		result.SubscriptionSource = &src
	}
	if user.CurrentPeriodEnd != nil {
		iso := user.CurrentPeriodEnd.Format(time.RFC3339)
		result.CurrentPeriodEnd = &iso
	}
	return result
}
