package developer

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestRevokeKeyOutput_Struct(t *testing.T) {
	output := RevokeKeyOutput{DisplayKey: "tfai_...xyz"}
	assert.Equal(t, "tfai_...xyz", output.DisplayKey)
}

func TestUsageHistoryRecord_Struct(t *testing.T) {
	now := time.Now()
	record := UsageHistoryRecord{
		WindowStart: now,
		Count:       500,
	}

	assert.Equal(t, now, record.WindowStart)
	assert.Equal(t, 500, record.Count)
}

func TestUsageService_GetUsageStats(t *testing.T) {
	mockRepo := new(MockDeveloperRepository)
	s := NewDeveloperUsageService(mockRepo)
	ctx := context.Background()

	k1 := DeveloperApiKeyRecord{ID: 10, DisplayKey: "k1", Tier: TierPro, RateLimit: 5000, MonthlyQuota: 100000, CreatedAt: time.Now()}
	k2 := DeveloperApiKeyRecord{ID: 11, DisplayKey: "k2", Tier: TierStarter, RateLimit: 1000, MonthlyQuota: 10000, CreatedAt: time.Now()}

	mockRepo.On("ListKeysForUser", ctx, 99).Return([]DeveloperApiKeyRecord{k1, k2}, nil)
	mockRepo.On("GetUsageTotalsForKey", ctx, 10, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(UsageTotals{
		Hourly: 10, Daily: 100, Weekly: 500, Monthly: 2000,
	}, nil)
	mockRepo.On("GetUsageTotalsForKey", ctx, 11, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(UsageTotals{
		Hourly: 5, Daily: 50, Weekly: 250, Monthly: 1000,
	}, nil)
	mockRepo.On("ListUsageHistory", ctx, []int{10, 11}, mock.Anything).Return([]UsageHistoryRecord{
		{WindowStart: time.Now(), Count: 150},
	}, nil)

	userLimit := 1000000
	userUsed := 3000
	stats, err := s.GetUsageStats(ctx, UsageUser{
		ID:               99,
		APIRequestsLimit: &userLimit,
		APIRequestsUsed:  &userUsed,
	})
	require.NoError(t, err)

	assert.Equal(t, 3000, stats.TotalRequests)
	assert.Equal(t, 3000, stats.RequestsThisMonth)
	assert.Equal(t, 750, stats.RequestsThisWeek)
	assert.Equal(t, 150, stats.RequestsToday)
	assert.Len(t, stats.APIKeys, 2)
	assert.Len(t, stats.UsageHistory, 1)
}

func TestUsageService_GetUsageStats_UsesUTCWindows(t *testing.T) {
	originalLocal := time.Local
	time.Local = time.FixedZone("review-regression", -5*60*60)
	t.Cleanup(func() { time.Local = originalLocal })

	mockRepo := new(MockDeveloperRepository)
	service := NewDeveloperUsageService(mockRepo)
	ctx := context.Background()
	key := DeveloperApiKeyRecord{ID: 10, CreatedAt: time.Now()}
	isUTC := mock.MatchedBy(func(value time.Time) bool { return value.Location() == time.UTC })

	mockRepo.On("ListKeysForUser", ctx, 99).Return([]DeveloperApiKeyRecord{key}, nil).Once()
	mockRepo.On("GetUsageTotalsForKey", ctx, 10, isUTC, isUTC, isUTC, isUTC).Return(UsageTotals{}, nil).Once()
	mockRepo.On("ListUsageHistory", ctx, []int{10}, isUTC).Return([]UsageHistoryRecord{}, nil).Once()

	_, err := service.GetUsageStats(ctx, UsageUser{ID: 99})

	require.NoError(t, err)
	mockRepo.AssertExpectations(t)
}

func TestUsageService_GetUsageStats_HistoryError(t *testing.T) {
	mockRepo := new(MockDeveloperRepository)
	s := NewDeveloperUsageService(mockRepo)
	ctx := context.Background()

	k1 := DeveloperApiKeyRecord{ID: 10, DisplayKey: "k1", Tier: TierPro, RateLimit: 5000, MonthlyQuota: 100000, CreatedAt: time.Now()}

	mockRepo.On("ListKeysForUser", ctx, 99).Return([]DeveloperApiKeyRecord{k1}, nil)
	mockRepo.On("GetUsageTotalsForKey", ctx, 10, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(UsageTotals{}, nil)
	mockRepo.On("ListUsageHistory", ctx, []int{10}, mock.Anything).Return(nil, errors.New("db error"))

	_, err := s.GetUsageStats(ctx, UsageUser{ID: 99})
	assert.Error(t, err)
}

func TestUsageService_GetUsageStats_SortsAggregatedHistory(t *testing.T) {
	mockRepo := new(MockDeveloperRepository)
	s := NewDeveloperUsageService(mockRepo)
	ctx := context.Background()

	k1 := DeveloperApiKeyRecord{ID: 10, DisplayKey: "k1", Tier: TierPro, RateLimit: 5000, MonthlyQuota: 100000, CreatedAt: time.Now()}
	newer := time.Date(2026, 2, 2, 8, 0, 0, 0, time.UTC)
	older := time.Date(2026, 2, 1, 8, 0, 0, 0, time.UTC)

	mockRepo.On("ListKeysForUser", ctx, 99).Return([]DeveloperApiKeyRecord{k1}, nil).Once()
	mockRepo.On("GetUsageTotalsForKey", ctx, 10, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(UsageTotals{}, nil).Once()
	mockRepo.On("ListUsageHistory", ctx, []int{10}, mock.Anything).Return([]UsageHistoryRecord{
		{WindowStart: newer, Count: 5},
		{WindowStart: older, Count: 3},
		{WindowStart: older.Add(2 * time.Hour), Count: 4},
	}, nil).Once()

	stats, err := s.GetUsageStats(ctx, UsageUser{ID: 99})

	require.NoError(t, err)
	require.Len(t, stats.UsageHistory, 2)
	assert.Equal(t, "2026-02-01", stats.UsageHistory[0].Date)
	assert.Equal(t, 7, stats.UsageHistory[0].Count)
	assert.Equal(t, "2026-02-02", stats.UsageHistory[1].Date)
}

func TestUsageService_GetUsageStats_LastUsedAndRevoked(t *testing.T) {
	mockRepo := new(MockDeveloperRepository)
	s := NewDeveloperUsageService(mockRepo)
	ctx := context.Background()

	now := time.Now()
	k1 := DeveloperApiKeyRecord{
		ID:           10,
		DisplayKey:   "k1",
		Tier:         TierPro,
		RateLimit:    5000,
		MonthlyQuota: 100000,
		CreatedAt:    now,
		LastUsedAt:   &now,
		RevokedAt:    &now,
	}

	mockRepo.On("ListKeysForUser", ctx, 99).Return([]DeveloperApiKeyRecord{k1}, nil).Once()
	mockRepo.On("GetUsageTotalsForKey", ctx, 10, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(UsageTotals{
		Hourly: 10, Daily: 100, Weekly: 500, Monthly: 2000,
	}, nil).Once()
	mockRepo.On("ListUsageHistory", ctx, []int{10}, mock.Anything).Return([]UsageHistoryRecord{}, nil).Once()

	stats, err := s.GetUsageStats(ctx, UsageUser{ID: 99})
	require.NoError(t, err)
	assert.Len(t, stats.APIKeys, 1)
	assert.NotNil(t, stats.APIKeys[0].LastUsedAt)
	assert.NotNil(t, stats.APIKeys[0].RevokedAt)
}

func TestUsageService_GetUsageStats_ListKeysError(t *testing.T) {
	mockRepo := new(MockDeveloperRepository)
	s := NewDeveloperUsageService(mockRepo)
	ctx := context.Background()

	mockRepo.On("ListKeysForUser", ctx, 1).Return(nil, errors.New("db error")).Once()

	_, err := s.GetUsageStats(ctx, UsageUser{ID: 1})
	assert.Error(t, err)
}

func TestUsageService_GetUsageStats_NoKeys(t *testing.T) {
	mockRepo := new(MockDeveloperRepository)
	s := NewDeveloperUsageService(mockRepo)
	ctx := context.Background()

	mockRepo.On("ListKeysForUser", ctx, 1).Return([]DeveloperApiKeyRecord{}, nil).Once()

	stats, err := s.GetUsageStats(ctx, UsageUser{ID: 1})
	require.NoError(t, err)
	assert.Empty(t, stats.APIKeys)
	assert.Empty(t, stats.UsageHistory)
}

func TestUsageService_GetUsageStats_PanicInWorkerReturnsError(t *testing.T) {
	mockRepo := new(MockDeveloperRepository)
	s := NewDeveloperUsageService(mockRepo)
	ctx := context.Background()

	k1 := DeveloperApiKeyRecord{ID: 10, DisplayKey: "k1", Tier: TierStarter, CreatedAt: time.Now()}
	k2 := DeveloperApiKeyRecord{ID: 11, DisplayKey: "k2", Tier: TierStarter, CreatedAt: time.Now()}
	mockRepo.On("ListKeysForUser", ctx, 99).Return([]DeveloperApiKeyRecord{k1, k2}, nil).Once()
	mockRepo.On("GetUsageTotalsForKey", ctx, 10, mock.Anything, mock.Anything, mock.Anything, mock.Anything).
		Run(func(mock.Arguments) { panic("boom") }).
		Return(UsageTotals{}, nil).
		Once()
	mockRepo.On("GetUsageTotalsForKey", ctx, 11, mock.Anything, mock.Anything, mock.Anything, mock.Anything).
		Return(UsageTotals{Hourly: 1, Daily: 1, Weekly: 1, Monthly: 1}, nil).
		Once()

	stats, err := s.GetUsageStats(ctx, UsageUser{ID: 99})
	require.Error(t, err)
	assert.Nil(t, stats)
}

func TestUsageService_GetUsageStats_UsageTotalsError(t *testing.T) {
	mockRepo := new(MockDeveloperRepository)
	s := NewDeveloperUsageService(mockRepo)
	ctx := context.Background()

	k1 := DeveloperApiKeyRecord{ID: 10, DisplayKey: "k1", Tier: TierPro, RateLimit: 5000, MonthlyQuota: 100000, CreatedAt: time.Now()}

	mockRepo.On("ListKeysForUser", ctx, 99).Return([]DeveloperApiKeyRecord{k1}, nil)
	mockRepo.On("GetUsageTotalsForKey", ctx, 10, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(UsageTotals{}, errors.New("db error"))

	_, err := s.GetUsageStats(ctx, UsageUser{ID: 99})
	assert.Error(t, err)
}

func TestUsageService_GetUsageStats_WithBillingPeriod(t *testing.T) {
	mockRepo := new(MockDeveloperRepository)
	s := NewDeveloperUsageService(mockRepo)
	ctx := context.Background()

	periodStart := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	periodEnd := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	userLimit := 1000
	userUsed := 250

	mockRepo.On("ListKeysForUser", ctx, 1).Return([]DeveloperApiKeyRecord{}, nil).Once()

	stats, err := s.GetUsageStats(ctx, UsageUser{
		ID:                    1,
		APIRequestsLimit:      &userLimit,
		APIRequestsUsed:       &userUsed,
		APICurrentPeriodStart: &periodStart,
		APICurrentPeriodEnd:   &periodEnd,
	})
	require.NoError(t, err)
	assert.NotNil(t, stats.PeriodStart)
	assert.NotNil(t, stats.PeriodEnd)
	assert.Equal(t, periodStart.Format(time.RFC3339), *stats.PeriodStart)
	assert.Equal(t, periodEnd.Format(time.RFC3339), *stats.PeriodEnd)
	assert.Equal(t, 750, stats.MonthlyRemaining)
}

func TestUsageTotals_Struct(t *testing.T) {
	totals := UsageTotals{
		Hourly:  100,
		Daily:   1000,
		Weekly:  7000,
		Monthly: 30000,
	}

	assert.Equal(t, 100, totals.Hourly)
	assert.Equal(t, 1000, totals.Daily)
	assert.Equal(t, 7000, totals.Weekly)
	assert.Equal(t, 30000, totals.Monthly)
}
