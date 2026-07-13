package payments

import "testing"

func TestDeveloperAPITierPolicy(t *testing.T) {
	tests := []struct {
		name       string
		tier       DeveloperAPITier
		wantValid  bool
		wantRank   int
		wantHourly int
		wantQuota  int
	}{
		{name: "starter", tier: DeveloperAPITierStarter, wantValid: true, wantRank: 0, wantHourly: 1000, wantQuota: 1_000_000},
		{name: "pro", tier: DeveloperAPITierPro, wantValid: true, wantRank: 1, wantHourly: 5000, wantQuota: 10_000_000},
		{name: "enterprise", tier: DeveloperAPITierEnterprise, wantValid: true, wantRank: 2, wantHourly: 10_000, wantQuota: 100_000_000},
		{name: "unknown", tier: DeveloperAPITier("UNKNOWN"), wantValid: false, wantRank: -1, wantHourly: 1000, wantQuota: 1_000_000},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsValidDeveloperAPITier(tt.tier); got != tt.wantValid {
				t.Fatalf("valid = %v; want %v", got, tt.wantValid)
			}
			if got := DeveloperAPITierRank(tt.tier); got != tt.wantRank {
				t.Fatalf("rank = %d; want %d", got, tt.wantRank)
			}
			limits := DeveloperAPILimitsForTier(tt.tier)
			if limits.HourlyRateLimit != tt.wantHourly {
				t.Fatalf("hourly limit = %d; want %d", limits.HourlyRateLimit, tt.wantHourly)
			}
			if limits.MonthlyQuota != tt.wantQuota {
				t.Fatalf("monthly quota = %d; want %d", limits.MonthlyQuota, tt.wantQuota)
			}
		})
	}
}

func TestDeveloperAPITierPolicyNormalizesInput(t *testing.T) {
	if got := NormalizeDeveloperAPITier(" pro "); got != DeveloperAPITierPro {
		t.Fatalf("expected normalized pro tier, got %q", got)
	}
	if got := NormalizeDeveloperAPITier("enterprise"); got != DeveloperAPITierEnterprise {
		t.Fatalf("expected normalized enterprise tier, got %q", got)
	}
	if !IsValidDeveloperAPITier(" starter ") {
		t.Fatal("expected valid tier check to trim and normalize case")
	}
	if got := DeveloperAPITierRank(" enterprise "); got != 2 {
		t.Fatalf("expected enterprise rank 2, got %d", got)
	}
}

func TestDeveloperAPIStoredLimitOverrides(t *testing.T) {
	if got := DeveloperAPIHourlyLimit(string(DeveloperAPITierPro), 123); got != 123 {
		t.Fatalf("expected stored hourly limit override, got %d", got)
	}
	if got := DeveloperAPIHourlyLimit(string(DeveloperAPITierPro), 0); got != 5000 {
		t.Fatalf("expected pro hourly limit, got %d", got)
	}
	if got := DeveloperAPIMonthlyQuota(string(DeveloperAPITierEnterprise), 456, 0); got != 456 {
		t.Fatalf("expected stored monthly quota override, got %d", got)
	}
	if got := DeveloperAPIMonthlyQuota(string(DeveloperAPITierEnterprise), 0, 789); got != 789 {
		t.Fatalf("expected user quota cap, got %d", got)
	}
	if got := DeveloperAPIMonthlyQuota(string(DeveloperAPITierEnterprise), 1000, 2000); got != 1000 {
		t.Fatalf("expected stored quota below user cap, got %d", got)
	}
}

func TestDeveloperAPILimitsForTierRepairsInvalidConfiguredLimits(t *testing.T) {
	original := developerAPITierLimits[DeveloperAPITierPro]
	developerAPITierLimits[DeveloperAPITierPro] = DeveloperAPITierLimits{}
	t.Cleanup(func() { developerAPITierLimits[DeveloperAPITierPro] = original })

	limits := DeveloperAPILimitsForTier(DeveloperAPITierPro)
	if limits.HourlyRateLimit != developerAPITierLimits[DeveloperAPITierStarter].HourlyRateLimit {
		t.Fatalf("expected starter hourly fallback, got %d", limits.HourlyRateLimit)
	}
	if limits.MonthlyQuota != developerAPITierLimits[DeveloperAPITierStarter].MonthlyQuota {
		t.Fatalf("expected starter monthly fallback, got %d", limits.MonthlyQuota)
	}
}

func TestDeveloperAPITierLimitsAreMonotonic(t *testing.T) {
	tiers := []DeveloperAPITier{
		DeveloperAPITierStarter,
		DeveloperAPITierPro,
		DeveloperAPITierEnterprise,
	}

	previous := DeveloperAPITierLimits{}
	for rank, tier := range tiers {
		if got := DeveloperAPITierRank(tier); got != rank {
			t.Fatalf("rank for %q = %d; want %d", tier, got, rank)
		}
		limits := DeveloperAPILimitsForTier(tier)
		if limits.HourlyRateLimit <= previous.HourlyRateLimit {
			t.Fatalf("hourly limit for %q = %d; want greater than %d", tier, limits.HourlyRateLimit, previous.HourlyRateLimit)
		}
		if limits.MonthlyQuota <= previous.MonthlyQuota {
			t.Fatalf("monthly quota for %q = %d; want greater than %d", tier, limits.MonthlyQuota, previous.MonthlyQuota)
		}
		previous = limits
	}
}

func FuzzDeveloperAPITierNormalization(f *testing.F) {
	for _, seed := range []string{"", "starter", " PRO ", "enterprise", "unknown", "\x00PRO"} {
		f.Add(seed)
	}

	f.Fuzz(func(t *testing.T, raw string) {
		tier := NormalizeDeveloperAPITier(raw)
		if !IsValidDeveloperAPITier(tier) {
			t.Fatalf("normalized tier %q from %q is invalid", tier, raw)
		}
		if got := NormalizeDeveloperAPITier(string(tier)); got != tier {
			t.Fatalf("normalization is not idempotent: first %q, second %q", tier, got)
		}
		limits := DeveloperAPILimitsForTier(tier)
		if limits.HourlyRateLimit <= 0 || limits.MonthlyQuota <= 0 {
			t.Fatalf("normalized tier %q has invalid limits: %+v", tier, limits)
		}
	})
}
