package developer

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/developer-service/pkg/developer"
	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"
)

type apiKeyUsageResponse struct {
	KeyID              int     `json:"keyId"`
	DisplayKey         string  `json:"displayKey"`
	Tier               string  `json:"tier" enum:"STARTER,PRO,ENTERPRISE"`
	CreatedAt          string  `json:"createdAt"`
	LastUsedAt         *string `json:"lastUsedAt"`
	RevokedAt          *string `json:"revokedAt"`
	HourlyLimit        int     `json:"hourlyLimit"`
	MonthlyQuota       int     `json:"monthlyQuota"`
	CurrentHourlyUsage int     `json:"currentHourlyUsage"`
	DailyUsage         int     `json:"dailyUsage"`
	WeeklyUsage        int     `json:"weeklyUsage"`
	MonthlyUsage       int     `json:"monthlyUsage"`
}

type usageStatsResponse struct {
	TotalRequests     int                      `json:"totalRequests"`
	RequestsThisMonth int                      `json:"requestsThisMonth"`
	RequestsThisWeek  int                      `json:"requestsThisWeek"`
	RequestsToday     int                      `json:"requestsToday"`
	MonthlyQuota      int                      `json:"monthlyQuota"`
	MonthlyRemaining  int                      `json:"monthlyRemaining"`
	PeriodStart       *string                  `json:"periodStart"`
	PeriodEnd         *string                  `json:"periodEnd"`
	APIKeys           []apiKeyUsageResponse    `json:"apiKeys"`
	UsageHistory      []developer.HistoryEntry `json:"usageHistory"`
}

func mapUsageStatsResponse(stats *developer.UsageStats) usageStatsResponse {
	var apiKeys []apiKeyUsageResponse
	if stats.APIKeys != nil {
		apiKeys = make([]apiKeyUsageResponse, 0, len(stats.APIKeys))
		for _, key := range stats.APIKeys {
			apiKeys = append(apiKeys, apiKeyUsageResponse{
				KeyID:              key.KeyID,
				DisplayKey:         key.DisplayKey,
				Tier:               string(key.Tier),
				CreatedAt:          key.CreatedAt,
				LastUsedAt:         key.LastUsedAt,
				RevokedAt:          key.RevokedAt,
				HourlyLimit:        key.HourlyLimit,
				MonthlyQuota:       key.MonthlyQuota,
				CurrentHourlyUsage: key.CurrentHourlyUsage,
				DailyUsage:         key.DailyUsage,
				WeeklyUsage:        key.WeeklyUsage,
				MonthlyUsage:       key.MonthlyUsage,
			})
		}
	}
	return usageStatsResponse{
		TotalRequests:     stats.TotalRequests,
		RequestsThisMonth: stats.RequestsThisMonth,
		RequestsThisWeek:  stats.RequestsThisWeek,
		RequestsToday:     stats.RequestsToday,
		MonthlyQuota:      stats.MonthlyQuota,
		MonthlyRemaining:  stats.MonthlyRemaining,
		PeriodStart:       stats.PeriodStart,
		PeriodEnd:         stats.PeriodEnd,
		APIKeys:           apiKeys,
		UsageHistory:      stats.UsageHistory,
	}
}

func RegisterUsageHandler(api huma.API, q querySource) {
	huma.Register(api, huma.Operation{
		OperationID: "get-developer-usage",
		Method:      http.MethodGet,
		Path:        "/api/v1/developer/usage",
		Summary:     "Get developer API usage statistics",
		Tags:        []string{"Developer"},
	}, func(ctx context.Context, input *struct {
		adapterhandler.AuthContext
	}) (*struct {
		Body usageStatsResponse
	}, error) {
		dbQueries, err := getDBQueries(ctx, q)
		if err != nil {
			return nil, huma.Error503ServiceUnavailable("Database unavailable")
		}
		accountStore := developerAccountStoreFromQueries(dbQueries)

		user := input.User
		account, err := loadDeveloperAccount(ctx, accountStore, user.ID)
		if isUserIDRangeError(err) {
			return nil, huma.Error500InternalServerError("Internal error")
		}
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				slog.Warn("Authenticated user missing during usage lookup", "userId", user.ID)
				return nil, huma.Error401Unauthorized("Unauthorized")
			}
			slog.Error("Get user failed", "error", err)
			return nil, huma.Error500InternalServerError("Internal error")
		}

		repo := developer.NewDeveloperRepositoryFromSource(dbQueries)
		service := developer.NewDeveloperUsageService(repo)

		usageUser := developer.UsageUser{
			ID: user.ID,
		}

		usageUser.APIRequestsUsed = account.APIRequestsUsed
		usageUser.APIRequestsLimit = account.APIRequestsLimit
		usageUser.APICurrentPeriodStart = account.APICurrentPeriodStart
		usageUser.APICurrentPeriodEnd = account.APICurrentPeriodEnd

		stats, err := service.GetUsageStats(ctx, usageUser)
		if err != nil {
			slog.Error("Developer usage fetch failed", "error", err)
			return nil, huma.Error500InternalServerError("Internal server error")
		}

		return &struct {
			Body usageStatsResponse
		}{Body: mapUsageStatsResponse(stats)}, nil
	})
}
