package pkg

import (
	"sync"

	"github.com/statsig-io/go-sdk"
)

// GateProvider defines the interface for checking feature gates.
type GateProvider interface {
	CheckGate(user statsig.User, gateName string) bool
	Shutdown()
}

type gateProviderResultProvider interface {
	CheckGateResult(user statsig.User, gateName string) (bool, bool)
}

type userGateProvider interface {
	CheckGateUser(user User, gateName string) (bool, bool)
}

// defaultStatsigProvider implements GateProvider using the real Statsig SDK.
type defaultStatsigProvider struct{}

func (p *defaultStatsigProvider) CheckGate(user statsig.User, gateName string) bool {
	return statsig.CheckGate(user, gateName)
}

func (p *defaultStatsigProvider) CheckGateResult(user statsig.User, gateName string) (bool, bool) {
	return p.CheckGate(user, gateName), true
}

func (p *defaultStatsigProvider) Shutdown() {
	statsig.Shutdown()
}

var (
	once   sync.Once
	client *StatsigClient
)

// StatsigClient is a wrapper around the Statsig Go SDK.
type StatsigClient struct {
	provider GateProvider
}

// User represents a user for feature flag targeting.
type User struct {
	UserID  string
	Email   string
	Tier    string
	Country string
	Custom  map[string]any
}

// NewStatsigUser converts a feature-flags user into the Statsig SDK shape.
func NewStatsigUser(user User) statsig.User {
	return statsig.User{
		UserID:            user.UserID,
		Email:             user.Email,
		PrivateAttributes: statsigPrivateAttributes(user),
		Custom:            user.Custom,
	}
}

func statsigPrivateAttributes(user User) map[string]any {
	if user.Tier == "" && user.Country == "" {
		return nil
	}

	attributes := make(map[string]any, 2)
	if user.Tier != "" {
		attributes["tier"] = user.Tier
	}
	if user.Country != "" {
		attributes["country"] = user.Country
	}
	return attributes
}

// GetClient returns a singleton instance of the Statsig client.
func GetClient(sdkKey string) *StatsigClient {
	once.Do(func() {
		if sdkKey != "" {
			statsig.Initialize(sdkKey)
			client = &StatsigClient{
				provider: &defaultStatsigProvider{},
			}
		} else {
			// Provide a no-op/default provider if no key is given (e.g. in tests)
			client = &StatsigClient{
				provider: &MockGateProvider{Flags: make(map[string]bool)},
			}
		}
	})
	return client
}

// SetTestClient allows setting a mock client for unit testing.
func SetTestClient(testClient *StatsigClient) {
	client = testClient
}

// IsEnabled checks if a feature flag is enabled for a given user.
func (c *StatsigClient) IsEnabled(user User, flag string) bool {
	if c == nil || c.provider == nil {
		return FeatureFlagDefaults[flag]
	}

	if userProvider, ok := c.provider.(userGateProvider); ok {
		enabled, found := userProvider.CheckGateUser(user, flag)
		if found {
			return enabled
		}
		return FeatureFlagDefaults[flag]
	}

	return c.isEnabledStatsigUser(NewStatsigUser(user), flag)
}

// IsEnabledStatsigUser checks a feature flag using a prebuilt Statsig SDK user.
func (c *StatsigClient) IsEnabledStatsigUser(user statsig.User, flag string) bool {
	if c == nil || c.provider == nil {
		return FeatureFlagDefaults[flag]
	}

	return c.isEnabledStatsigUser(user, flag)
}

func (c *StatsigClient) isEnabledStatsigUser(statsigUser statsig.User, flag string) bool {
	if resultProvider, ok := c.provider.(gateProviderResultProvider); ok {
		enabled, found := resultProvider.CheckGateResult(statsigUser, flag)
		if found {
			return enabled
		}
		return FeatureFlagDefaults[flag]
	}

	return c.provider.CheckGate(statsigUser, flag)
}

// Shutdown gracefully shuts down the Statsig SDK.
func (c *StatsigClient) Shutdown() {
	if c == nil || c.provider == nil {
		return
	}
	c.provider.Shutdown()
}

// MockGateProvider implements GateProvider for unit testing.
type MockGateProvider struct {
	Flags map[string]bool
}

func (p *MockGateProvider) CheckGate(user statsig.User, gateName string) bool {
	return p.Flags[gateName]
}

func (p *MockGateProvider) CheckGateResult(user statsig.User, gateName string) (bool, bool) {
	enabled, found := p.Flags[gateName]
	return enabled, found
}

func (p *MockGateProvider) CheckGateUser(user User, gateName string) (bool, bool) {
	enabled, found := p.Flags[gateName]
	return enabled, found
}

func (p *MockGateProvider) Shutdown() {}
