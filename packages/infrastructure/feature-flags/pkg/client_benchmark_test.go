package pkg

import (
	"testing"

	"github.com/statsig-io/go-sdk"
)

type benchmarkGateProvider struct {
	enabled bool
	found   bool
	sink    int
}

type benchmarkLegacyGateProvider struct {
	enabled bool
	sink    int
}

func (p *benchmarkGateProvider) CheckGate(user statsig.User, gateName string) bool {
	p.observe(user, gateName)
	return p.enabled
}

func (p *benchmarkGateProvider) CheckGateResult(user statsig.User, gateName string) (bool, bool) {
	p.observe(user, gateName)
	return p.enabled, p.found
}

func (p *benchmarkGateProvider) Shutdown() {}

func (p *benchmarkLegacyGateProvider) CheckGate(user statsig.User, gateName string) bool {
	p.sink += len(user.UserID) + len(user.Email) + len(gateName)
	if tier, _ := user.PrivateAttributes["tier"].(string); tier != "" {
		p.sink += len(tier)
	}
	return p.enabled
}

func (p *benchmarkLegacyGateProvider) Shutdown() {}

func (p *benchmarkGateProvider) observe(user statsig.User, gateName string) {
	p.sink += len(user.UserID) + len(user.Email) + len(gateName)
	if tier, _ := user.PrivateAttributes["tier"].(string); tier != "" {
		p.sink += len(tier)
	}
	if country, _ := user.PrivateAttributes["country"].(string); country != "" {
		p.sink += len(country)
	}
	if customTier, _ := user.Custom["segment"].(string); customTier != "" {
		p.sink += len(customTier)
	}
}

func BenchmarkStatsigClientIsEnabled(b *testing.B) {
	user := User{
		UserID:  "user-123456",
		Email:   "bench@example.com",
		Tier:    "pro",
		Country: "US",
		Custom: map[string]any{
			"segment": "research",
		},
	}

	b.Run("result provider hit", func(b *testing.B) {
		provider := &benchmarkGateProvider{enabled: true, found: true}
		client := &StatsigClient{provider: provider}

		b.ReportAllocs()
		for b.Loop() {
			if !client.IsEnabled(user, ModeAutonomy) {
				b.Fatal("expected enabled flag")
			}
		}
	})

	b.Run("result provider miss", func(b *testing.B) {
		provider := &benchmarkGateProvider{found: false}
		client := &StatsigClient{provider: provider}

		b.ReportAllocs()
		for b.Loop() {
			if !client.IsEnabled(user, ModeQuick) {
				b.Fatal("expected default-enabled flag")
			}
		}
	})

	b.Run("mock provider hit", func(b *testing.B) {
		client := &StatsigClient{
			provider: &MockGateProvider{Flags: map[string]bool{ModeComputerUse: true}},
		}

		b.ReportAllocs()
		for b.Loop() {
			if !client.IsEnabled(user, ModeComputerUse) {
				b.Fatal("expected enabled flag")
			}
		}
	})

	b.Run("legacy provider", func(b *testing.B) {
		provider := &benchmarkLegacyGateProvider{enabled: true}
		client := &StatsigClient{provider: provider}

		b.ReportAllocs()
		for b.Loop() {
			if !client.IsEnabled(user, ModeAutonomy) {
				b.Fatal("expected enabled flag")
			}
		}
	})

	b.Run("nil client default", func(b *testing.B) {
		var client *StatsigClient

		b.ReportAllocs()
		for b.Loop() {
			if !client.IsEnabled(User{}, ModeQuick) {
				b.Fatal("expected default-enabled flag")
			}
		}
	})

	b.Run("two result provider hits same user", func(b *testing.B) {
		provider := &benchmarkGateProvider{enabled: true, found: true}
		client := &StatsigClient{provider: provider}

		b.ReportAllocs()
		for b.Loop() {
			statsigUser := NewStatsigUser(user)
			if !client.IsEnabledStatsigUser(statsigUser, ModeComputerUse) {
				b.Fatal("expected computer-use flag")
			}
			if !client.IsEnabledStatsigUser(statsigUser, ModeAutonomy) {
				b.Fatal("expected autonomy flag")
			}
		}
	})
}
