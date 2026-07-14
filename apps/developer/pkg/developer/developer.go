// Package developer provides API key management and usage tracking.
package developer

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"time"

	corepayments "github.com/TaskForceAI/core/pkg/payments"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

// DeveloperApiTier represents the API tier
type DeveloperApiTier = corepayments.DeveloperAPITier

const (
	TierStarter    = corepayments.DeveloperAPITierStarter
	TierPro        = corepayments.DeveloperAPITierPro
	TierEnterprise = corepayments.DeveloperAPITierEnterprise

	MaxActiveKeysPerUser = corepayments.MaxActiveDeveloperAPIKeysPerUser
)

var (
	ErrKeyLimitReached   = errors.New("KEY_LIMIT")
	ErrKeyAlreadyRevoked = errors.New("ALREADY_REVOKED")
	ErrKeyNotFound       = errors.New("NOT_FOUND")
	ErrInvalidTier       = errors.New("INVALID_TIER")
	ErrTierUpgradeDenied = errors.New("TIER_UPGRADE_DENIED")
	readRandom           = rand.Read
)

// DeveloperApiKeyRecord represents a stored API key
type DeveloperApiKeyRecord struct {
	ID           int              `json:"keyId"`
	DisplayKey   string           `json:"displayKey"`
	Tier         DeveloperApiTier `json:"tier"`
	RateLimit    int              `json:"rateLimit"`
	MonthlyQuota int              `json:"monthlyQuota"`
	CreatedAt    time.Time        `json:"createdAt"`
	LastUsedAt   *time.Time       `json:"lastUsedAt"`
	RevokedAt    *time.Time       `json:"revokedAt"`
}

// DeveloperRepository defines storage operations for keys and usage
type DeveloperRepository interface {
	// Key management
	ListKeysForUser(ctx context.Context, userID int) ([]DeveloperApiKeyRecord, error)
	CountActiveKeysForUser(ctx context.Context, userID int) (int, error)
	FindKeyForUser(ctx context.Context, keyID, userID int) (*DeveloperApiKeyRecord, error)
	RevokeKey(ctx context.Context, keyID int) error
	CreateApiKey(ctx context.Context, userID int, keyHash, displayKey string, tier DeveloperApiTier, rateLimit, monthlyQuota int) error

	// Usage tracking
	GetUsageTotalsForKeys(ctx context.Context, keyIDs []int, startOfHour, startOfDay, startOfWeek, startOfMonth time.Time) (map[int]UsageTotals, error)
	ListUsageHistory(ctx context.Context, keyIDs []int, since time.Time) ([]UsageHistoryRecord, error)
}

// UsageTotals represents aggregated usage counts
type UsageTotals struct {
	Hourly  int
	Daily   int
	Weekly  int
	Monthly int
}

// UsageHistoryRecord represents daily usage history
type UsageHistoryRecord struct {
	WindowStart time.Time
	Count       int
}

// CreateKeyInput is input for creating a key
type CreateKeyInput struct {
	UserID   int
	Tier     *DeveloperApiTier
	UserTier *DeveloperApiTier
}

// CreateKeyOutput is output for creating a key
type CreateKeyOutput struct {
	Key        string
	DisplayKey string
	Tier       DeveloperApiTier
}

// RevokeKeyOutput is output for revoking a key
type RevokeKeyOutput struct {
	DisplayKey string
}

// DeveloperKeysService handles API key operations
type DeveloperKeysService struct {
	repo DeveloperRepository
}

// NewDeveloperKeysService creates a new keys service
func NewDeveloperKeysService(repo DeveloperRepository) *DeveloperKeysService {
	return &DeveloperKeysService{repo: repo}
}

// ListKeys returns all keys for a user
func (s *DeveloperKeysService) ListKeys(ctx context.Context, userID int) ([]DeveloperApiKeyRecord, error) {
	keys, err := s.repo.ListKeysForUser(ctx, userID)
	if err != nil {
		slog.Error("Failed to list API keys", "error", err, "userId", userID)
	}
	return keys, err
}

// CreateKey creates a new API key
func (s *DeveloperKeysService) CreateKey(ctx context.Context, input CreateKeyInput) (output *CreateKeyOutput, err error) {
	ctx, span := getTelemetry().tracer.Start(ctx, "developer.CreateKey", trace.WithAttributes(attribute.Int("user_id", input.UserID)))
	defer func() {
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, err.Error())
		}
		span.End()
	}()

	count, err := s.repo.CountActiveKeysForUser(ctx, input.UserID)
	if err != nil {
		slog.Error("Failed to count active keys during key creation", "error", err, "userId", input.UserID)
		return nil, err
	}
	if count >= MaxActiveKeysPerUser {
		return nil, ErrKeyLimitReached
	}

	userTier := TierStarter
	if input.UserTier != nil {
		if !corepayments.IsValidDeveloperAPITier(*input.UserTier) {
			return nil, ErrInvalidTier
		}
		userTier = *input.UserTier
	}

	tier := userTier
	if input.Tier != nil {
		if !corepayments.IsValidDeveloperAPITier(*input.Tier) {
			return nil, ErrInvalidTier
		}
		if corepayments.DeveloperAPITierRank(*input.Tier) > corepayments.DeveloperAPITierRank(userTier) {
			return nil, ErrTierUpgradeDenied
		}
		tier = *input.Tier
	}
	tier = corepayments.NormalizeDeveloperAPITier(string(tier))

	// Generate key
	bytes := make([]byte, 18)
	if _, err := readRandom(bytes); err != nil {
		slog.Error("Failed to generate random bytes for API key", "error", err)
		return nil, err
	}
	rawKey := fmt.Sprintf("tfai_%s", hex.EncodeToString(bytes))
	keyHashBytes := sha256.Sum256([]byte(rawKey))
	keyHash := hex.EncodeToString(keyHashBytes[:])
	displayKey := fmt.Sprintf("%s…%s", rawKey[:10], rawKey[len(rawKey)-4:])

	limits := corepayments.DeveloperAPILimitsForTier(tier)
	rateLimit := limits.HourlyRateLimit
	monthlyQuota := limits.MonthlyQuota

	if err := s.repo.CreateApiKey(ctx, input.UserID, keyHash, displayKey, tier, rateLimit, monthlyQuota); err != nil {
		slog.Error("Failed to create API key in repository", "error", err, "userId", input.UserID)
		return nil, err
	}

	recordKeyCreation(ctx, string(tier))
	return &CreateKeyOutput{Key: rawKey, DisplayKey: displayKey, Tier: tier}, nil
}

// RevokeKey revokes an API key
func (s *DeveloperKeysService) RevokeKey(ctx context.Context, userID, keyID int) (output *RevokeKeyOutput, err error) {
	ctx, span := getTelemetry().tracer.Start(ctx, "developer.RevokeKey", trace.WithAttributes(
		attribute.Int("user_id", userID),
		attribute.Int("key_id", keyID),
	))
	defer func() {
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, err.Error())
		}
		span.End()
	}()

	key, err := s.repo.FindKeyForUser(ctx, keyID, userID)
	if err != nil {
		slog.Error("Failed to find API key for revocation", "error", err, "userId", userID, "keyId", keyID)
		return nil, err
	}

	if key.RevokedAt != nil {
		return nil, ErrKeyAlreadyRevoked
	}

	if err := s.repo.RevokeKey(ctx, keyID); err != nil {
		slog.Error("Failed to revoke API key in repository", "error", err, "userId", userID, "keyId", keyID)
		return nil, err
	}

	recordKeyRevocation(ctx)

	display := key.DisplayKey
	if display == "" {
		display = fmt.Sprintf("Key #%d", keyID)
	}

	return &RevokeKeyOutput{DisplayKey: display}, nil
}

// UsageUser represents a user context for usage stats
type UsageUser struct {
	ID                    int
	APIRequestsUsed       *int
	APIRequestsLimit      *int
	APICurrentPeriodStart *time.Time
	APICurrentPeriodEnd   *time.Time
}

// APIKeyUsage represents usage stats for a specific key
type APIKeyUsage struct {
	KeyID              int              `json:"keyId"`
	DisplayKey         string           `json:"displayKey"`
	Tier               DeveloperApiTier `json:"tier"`
	CreatedAt          string           `json:"createdAt"`
	LastUsedAt         *string          `json:"lastUsedAt"`
	RevokedAt          *string          `json:"revokedAt"`
	HourlyLimit        int              `json:"hourlyLimit"`
	MonthlyQuota       int              `json:"monthlyQuota"`
	CurrentHourlyUsage int              `json:"currentHourlyUsage"`
	DailyUsage         int              `json:"dailyUsage"`
	WeeklyUsage        int              `json:"weeklyUsage"`
	MonthlyUsage       int              `json:"monthlyUsage"`
}

// UsageStats represents aggregated usage stats for a user
type UsageStats struct {
	TotalRequests     int            `json:"totalRequests"`
	RequestsThisMonth int            `json:"requestsThisMonth"`
	RequestsThisWeek  int            `json:"requestsThisWeek"`
	RequestsToday     int            `json:"requestsToday"`
	MonthlyQuota      int            `json:"monthlyQuota"`
	MonthlyRemaining  int            `json:"monthlyRemaining"`
	PeriodStart       *string        `json:"periodStart"`
	PeriodEnd         *string        `json:"periodEnd"`
	APIKeys           []APIKeyUsage  `json:"apiKeys"`
	UsageHistory      []HistoryEntry `json:"usageHistory"`
}

// HistoryEntry is a single day's usage in stats
type HistoryEntry struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

// DeveloperUsageService handles usage stats
type DeveloperUsageService struct {
	repo DeveloperRepository
}

// NewDeveloperUsageService creates a new usage service
func NewDeveloperUsageService(repo DeveloperRepository) *DeveloperUsageService {
	return &DeveloperUsageService{repo: repo}
}

// GetUsageStats returns usage stats for a user
func (s *DeveloperUsageService) GetUsageStats(ctx context.Context, user UsageUser) (*UsageStats, error) {
	now := time.Now().UTC()
	startOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())

	// Start of week (Sunday)
	offset := int(now.Weekday())
	startOfWeek := time.Date(now.Year(), now.Month(), now.Day()-offset, 0, 0, 0, 0, now.Location())

	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	startOfHour := time.Date(now.Year(), now.Month(), now.Day(), now.Hour(), 0, 0, 0, now.Location())

	keys, err := s.repo.ListKeysForUser(ctx, user.ID)
	if err != nil {
		slog.Error("Failed to list API keys for usage stats", "error", err, "userId", user.ID)
		return nil, err
	}

	// Initialize as empty slice to ensure [] in JSON instead of null
	keyStats := make([]APIKeyUsage, len(keys))
	keyIDs := make([]int, len(keys))

	for i, key := range keys {
		keyIDs[i] = key.ID
	}

	usageTotalsByKey := make(map[int]UsageTotals, len(keyIDs))
	if len(keyIDs) > 0 {
		usageTotalsByKey, err = s.repo.GetUsageTotalsForKeys(ctx, keyIDs, startOfHour, startOfDay, startOfWeek, startOfMonth)
		if err != nil {
			slog.Error("Failed to get usage totals for keys", "error", err, "userId", user.ID)
			return nil, err
		}
	}

	for i, key := range keys {
		totals := usageTotalsByKey[key.ID]
		keyStats[i] = APIKeyUsage{
			KeyID:              key.ID,
			DisplayKey:         key.DisplayKey,
			Tier:               key.Tier,
			CreatedAt:          key.CreatedAt.Format(time.RFC3339),
			LastUsedAt:         formatTime(key.LastUsedAt),
			RevokedAt:          formatTime(key.RevokedAt),
			HourlyLimit:        key.RateLimit,
			MonthlyQuota:       key.MonthlyQuota,
			CurrentHourlyUsage: totals.Hourly,
			DailyUsage:         totals.Daily,
			WeeklyUsage:        totals.Weekly,
			MonthlyUsage:       totals.Monthly,
		}
	}

	history := []UsageHistoryRecord{}
	if len(keyIDs) > 0 {
		thirtyDaysAgo := now.AddDate(0, 0, -30)
		loadedHistory, err := s.repo.ListUsageHistory(ctx, keyIDs, thirtyDaysAgo)
		if err != nil {
			slog.Error("Failed to list usage history for stats", "error", err, "userId", user.ID)
			return nil, err
		}
		history = loadedHistory
	}

	// Aggregate history
	dailyMap := make(map[string]int, len(history))
	for _, rec := range history {
		d := rec.WindowStart.Format("2006-01-02")
		dailyMap[d] += rec.Count
	}

	histEntries := make([]HistoryEntry, 0, len(dailyMap))
	for d, c := range dailyMap {
		histEntries = append(histEntries, HistoryEntry{Date: d, Count: c})
	}
	sort.Slice(histEntries, func(i, j int) bool {
		return histEntries[i].Date < histEntries[j].Date
	})

	totalMonthly := 0
	totalWeekly := 0
	totalDaily := 0
	for _, ks := range keyStats {
		totalMonthly += ks.MonthlyUsage
		totalWeekly += ks.WeeklyUsage
		totalDaily += ks.DailyUsage
	}

	apiRequestsUsed := 0
	if user.APIRequestsUsed != nil {
		apiRequestsUsed = *user.APIRequestsUsed
	}
	apiRequestsLimit := 0
	if user.APIRequestsLimit != nil {
		apiRequestsLimit = *user.APIRequestsLimit
	}
	remaining := max(apiRequestsLimit-apiRequestsUsed, 0)

	return &UsageStats{
		TotalRequests:     apiRequestsUsed,
		RequestsThisMonth: totalMonthly,
		RequestsThisWeek:  totalWeekly,
		RequestsToday:     totalDaily,
		MonthlyQuota:      apiRequestsLimit,
		MonthlyRemaining:  remaining,
		PeriodStart:       formatTime(user.APICurrentPeriodStart),
		PeriodEnd:         formatTime(user.APICurrentPeriodEnd),
		APIKeys:           keyStats,
		UsageHistory:      histEntries,
	}, nil
}

func formatTime(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := value.Format(time.RFC3339)
	return &formatted
}
