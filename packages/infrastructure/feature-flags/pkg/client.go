package pkg

import (
	"log/slog"
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
	clientMu     sync.Mutex
	client       *StatsigClient
	clientSDKKey string
	clientIsTest bool
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
	clientMu.Lock()
	defer clientMu.Unlock()

	if client == nil {
		return initializeClientLocked(sdkKey)
	}

	if clientIsTest {
		return client
	}

	if clientSDKKey == "" && sdkKey != "" {
		slog.Info("feature-flags: replacing no-op Statsig provider with configured provider")
		return initializeClientLocked(sdkKey)
	}

	if clientSDKKey != "" && sdkKey != "" && sdkKey != clientSDKKey {
		slog.Info("feature-flags: ignoring different non-empty Statsig SDK key; singleton already initialized")
	}

	return client
}

func initializeClientLocked(sdkKey string) *StatsigClient {
	clientSDKKey = sdkKey
	clientIsTest = false

	if sdkKey != "" {
		initDetails := statsig.Initialize(sdkKey)
		if !initDetails.Success && initDetails.Error != nil {
			slog.Warn(
				"feature-flags: Statsig initialization reported an error",
				"error",
				initDetails.Error,
			)
		}
		client = &StatsigClient{
			provider: &defaultStatsigProvider{},
		}
		return client
	}

	slog.Info("feature-flags: initializing no-op Statsig provider because sdkKey is empty")
	client = &StatsigClient{
		provider: &MockGateProvider{Flags: make(map[string]bool)},
	}
	return client
}

// SetTestClient allows setting a mock client for unit testing.
func SetTestClient(testClient *StatsigClient) {
	clientMu.Lock()
	defer clientMu.Unlock()

	client = testClient
	clientSDKKey = ""
	clientIsTest = testClient != nil
}

// SetTestFlags installs an in-memory gate provider for tests outside this package.
func SetTestFlags(flags map[string]bool) {
	testFlags := make(map[string]bool, len(flags))
	for key, value := range flags {
		testFlags[key] = value
	}
	SetTestClient(&StatsigClient{provider: &MockGateProvider{Flags: testFlags}})
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
