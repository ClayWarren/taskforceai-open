package payments

import "strings"

// DeveloperAPITier represents the product tier for developer API keys.
type DeveloperAPITier string

const (
	DeveloperAPITierStarter    DeveloperAPITier = "STARTER"
	DeveloperAPITierPro        DeveloperAPITier = "PRO"
	DeveloperAPITierEnterprise DeveloperAPITier = "ENTERPRISE"

	MaxActiveDeveloperAPIKeysPerUser = 10
)

type DeveloperAPITierLimits struct {
	HourlyRateLimit int
	MonthlyQuota    int
}

var developerAPITierLimits = map[DeveloperAPITier]DeveloperAPITierLimits{
	DeveloperAPITierStarter:    {HourlyRateLimit: 1000, MonthlyQuota: 1_000_000},
	DeveloperAPITierPro:        {HourlyRateLimit: 5000, MonthlyQuota: 10_000_000},
	DeveloperAPITierEnterprise: {HourlyRateLimit: 10_000, MonthlyQuota: 100_000_000},
}

// NormalizeDeveloperAPITier maps external tier strings into the active
// developer API tier set.
func NormalizeDeveloperAPITier(tier string) DeveloperAPITier {
	normalized := DeveloperAPITier(strings.ToUpper(strings.TrimSpace(tier)))
	if DeveloperAPITierRank(normalized) >= 0 {
		return normalized
	}
	return DeveloperAPITierStarter
}

func IsValidDeveloperAPITier(tier DeveloperAPITier) bool {
	return DeveloperAPITierRank(tier) >= 0
}

func DeveloperAPITierRank(tier DeveloperAPITier) int {
	tier = DeveloperAPITier(strings.ToUpper(strings.TrimSpace(string(tier))))
	for rank, candidate := range [...]DeveloperAPITier{
		DeveloperAPITierStarter,
		DeveloperAPITierPro,
		DeveloperAPITierEnterprise,
	} {
		if tier == candidate {
			return rank
		}
	}
	return -1
}

func DeveloperAPILimitsForTier(tier DeveloperAPITier) DeveloperAPITierLimits {
	limits := developerAPITierLimits[NormalizeDeveloperAPITier(string(tier))]
	if limits.HourlyRateLimit <= 0 {
		limits.HourlyRateLimit = developerAPITierLimits[DeveloperAPITierStarter].HourlyRateLimit
	}
	if limits.MonthlyQuota <= 0 {
		limits.MonthlyQuota = developerAPITierLimits[DeveloperAPITierStarter].MonthlyQuota
	}
	return limits
}

func DeveloperAPIHourlyLimit(tier string, storedLimit int) int {
	if storedLimit > 0 {
		return storedLimit
	}
	return DeveloperAPILimitsForTier(DeveloperAPITier(tier)).HourlyRateLimit
}

func DeveloperAPIMonthlyQuota(tier string, storedQuota int, userQuotaLimit int) int {
	quota := storedQuota
	if quota <= 0 {
		quota = DeveloperAPILimitsForTier(DeveloperAPITier(tier)).MonthlyQuota
	}
	if userQuotaLimit > 0 && userQuotaLimit < quota {
		return userQuotaLimit
	}
	return quota
}
