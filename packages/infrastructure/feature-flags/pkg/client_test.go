package pkg

import (
	"bytes"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"

	"github.com/statsig-io/go-sdk"
)

type staticGateProvider struct {
	enabled bool
}

func (p *staticGateProvider) CheckGate(user statsig.User, gateName string) bool {
	return p.enabled
}

func (p *staticGateProvider) Shutdown() {}

func resetClientForTest(t *testing.T) {
	t.Helper()

	clientMu.Lock()
	client = nil
	clientSDKKey = ""
	clientIsTest = false
	clientMu.Unlock()

	statsig.ShutdownAndDangerouslyClearInstance()
}

func captureLogs(fn func()) string {
	var buf bytes.Buffer
	previousLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	defer slog.SetDefault(previousLogger)

	fn()
	return buf.String()
}

func TestIsEnabled(t *testing.T) {
	mockFlags := map[string]bool{
		ModeComputerUse: true,
		ModeAutonomy:    false,
		ModeQuick:       false,
	}

	mockProvider := &MockGateProvider{Flags: mockFlags}
	client := &StatsigClient{provider: mockProvider}

	tests := []struct {
		name     string
		flag     string
		expected bool
	}{
		{
			name:     "returns true for enabled flag",
			flag:     ModeComputerUse,
			expected: true,
		},
		{
			name:     "returns false for disabled flag",
			flag:     ModeAutonomy,
			expected: false,
		},
		{
			name:     "honors false provider result for default-true flag",
			flag:     ModeQuick,
			expected: false,
		},
		{
			name:     "falls back to default when provider has no result for default-true flag",
			flag:     EnablePayments,
			expected: true,
		},
		{
			name:     "falls back to default when provider has no result for default-false flag",
			flag:     ModeImageGen,
			expected: false,
		},
	}

	user := User{
		UserID: "test-user-123",
		Email:  "test@taskforceai.chat",
		Tier:   "pro",
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := client.IsEnabled(user, tt.flag)
			if got != tt.expected {
				t.Errorf("IsEnabled() for %s = %v, want %v", tt.flag, got, tt.expected)
			}
		})
	}
}

func TestIsEnabledHandlesNilAndLegacyProviders(t *testing.T) {
	var nilClient *StatsigClient
	if got := nilClient.IsEnabled(User{}, ModeQuick); got != true {
		t.Fatalf("nil client IsEnabled() = %v, want true", got)
	}

	clientWithoutProvider := &StatsigClient{}
	if got := clientWithoutProvider.IsEnabled(User{}, EnablePayments); got != true {
		t.Fatalf("client without provider IsEnabled() = %v, want true", got)
	}

	legacyClient := &StatsigClient{provider: &staticGateProvider{enabled: false}}
	if got := legacyClient.IsEnabled(User{}, ModeQuick); got != false {
		t.Fatalf("legacy provider IsEnabled() = %v, want false", got)
	}
}

func TestIsEnabledStatsigUser(t *testing.T) {
	var nilClient *StatsigClient
	if got := nilClient.IsEnabledStatsigUser(statsig.User{}, ModeQuick); got != true {
		t.Fatalf("nil client IsEnabledStatsigUser() = %v, want true", got)
	}

	clientWithoutProvider := &StatsigClient{}
	if got := clientWithoutProvider.IsEnabledStatsigUser(statsig.User{}, EnablePayments); got != true {
		t.Fatalf("client without provider IsEnabledStatsigUser() = %v, want true", got)
	}

	mockProvider := &MockGateProvider{Flags: map[string]bool{ModeAutonomy: true}}
	client := &StatsigClient{provider: mockProvider}
	user := NewStatsigUser(User{
		UserID:  "test-user-123",
		Email:   "test@taskforceai.chat",
		Tier:    "pro",
		Country: "US",
		Custom: map[string]any{
			"segment": "research",
		},
	})

	if got := client.IsEnabledStatsigUser(user, ModeAutonomy); got != true {
		t.Fatalf("IsEnabledStatsigUser() = %v, want true", got)
	}
	if got := client.IsEnabledStatsigUser(user, ModeQuick); got != true {
		t.Fatalf("IsEnabledStatsigUser() missing flag = %v, want default true", got)
	}
}

func TestNewStatsigUser(t *testing.T) {
	custom := map[string]any{"segment": "research"}
	got := NewStatsigUser(User{
		UserID:  "test-user-123",
		Email:   "test@taskforceai.chat",
		Tier:    "pro",
		Country: "US",
		Custom:  custom,
	})

	if got.UserID != "test-user-123" || got.Email != "test@taskforceai.chat" {
		t.Fatalf("NewStatsigUser identity = (%q, %q), want test user", got.UserID, got.Email)
	}
	if got.PrivateAttributes["tier"] != "pro" {
		t.Fatalf("NewStatsigUser tier = %v, want pro", got.PrivateAttributes["tier"])
	}
	if got.PrivateAttributes["country"] != "US" {
		t.Fatalf("NewStatsigUser country = %v, want US", got.PrivateAttributes["country"])
	}
	if got.Custom["segment"] != "research" {
		t.Fatalf("NewStatsigUser custom segment = %v, want research", got.Custom["segment"])
	}

	got = NewStatsigUser(User{})
	if got.PrivateAttributes != nil {
		t.Fatalf("NewStatsigUser empty private attributes = %#v, want nil", got.PrivateAttributes)
	}
}

func TestFeatureFlagDefaultsCoverAllGoConstants(t *testing.T) {
	expectedDefaults := map[string]bool{
		ModeComputerUse:            false,
		ModeAutonomy:               false,
		ModeQuick:                  true,
		ModeImageGen:               false,
		EnableLatexRenderingWeb:    true,
		EnableLatexRenderingMobile: false,
		EnablePayments:             true,
		EnableProFeatures:          false,
		OtelTracingHigh:            false,
		FlagRedisCacheSkip:         false,
	}

	if len(FeatureFlagDefaults) != len(expectedDefaults) {
		t.Fatalf("FeatureFlagDefaults has %d entries, want %d", len(FeatureFlagDefaults), len(expectedDefaults))
	}

	for flag, expected := range expectedDefaults {
		got, ok := FeatureFlagDefaults[flag]
		if !ok {
			t.Fatalf("FeatureFlagDefaults missing %q", flag)
		}
		if got != expected {
			t.Fatalf("FeatureFlagDefaults[%q] = %v, want %v", flag, got, expected)
		}
	}
}

func TestFeatureFlagDefaultsMatchTypeScriptDefinitions(t *testing.T) {
	tsDefaults := loadTypeScriptFlagDefaults(t)

	if len(FeatureFlagDefaults) != len(tsDefaults) {
		t.Fatalf("FeatureFlagDefaults has %d entries, TypeScript has %d", len(FeatureFlagDefaults), len(tsDefaults))
	}

	for flag, expected := range tsDefaults {
		got, ok := FeatureFlagDefaults[flag]
		if !ok {
			t.Fatalf("FeatureFlagDefaults missing TypeScript flag %q", flag)
		}
		if got != expected {
			t.Fatalf("FeatureFlagDefaults[%q] = %v, TypeScript has %v", flag, got, expected)
		}
	}
}

func loadTypeScriptFlagDefaults(t *testing.T) map[string]bool {
	t.Helper()

	contents, err := os.ReadFile(
		filepath.Join("..", "..", "ts", "feature-flags", "definitions", "flags.ts"),
	)
	if err != nil {
		t.Fatalf("read TypeScript flag definitions: %v", err)
	}

	flagPattern := regexp.MustCompile(`(?m)^\s*([A-Z0-9_]+): '([^']+)',\s*$`)
	defaultPattern := regexp.MustCompile(`(?m)^\s*\[FEATURE_FLAGS\.([A-Z0-9_]+)\]: (true|false),\s*$`)

	flagNames := make(map[string]string)
	for _, match := range flagPattern.FindAllStringSubmatch(string(contents), -1) {
		flagNames[match[1]] = match[2]
	}

	defaults := make(map[string]bool)
	for _, match := range defaultPattern.FindAllStringSubmatch(string(contents), -1) {
		flag, ok := flagNames[match[1]]
		if !ok {
			t.Fatalf("TypeScript default references unknown flag constant %q", match[1])
		}
		defaults[flag] = match[2] == "true"
	}

	if len(defaults) == 0 {
		t.Fatal("found no TypeScript feature flag defaults")
	}

	return defaults
}

func TestGetClientSingleton(t *testing.T) {
	resetClientForTest(t)

	c1 := GetClient("secret-key")
	c2 := GetClient("another-key")

	if c1 != c2 {
		t.Errorf("GetClient() returned different instances, want singleton")
	}

	if c1.provider == nil {
		t.Errorf("GetClient() provider is nil")
	}
}

func TestGetClientWithoutSDKKeyUsesMockProvider(t *testing.T) {
	resetClientForTest(t)

	c := GetClient("")

	if c == nil {
		t.Fatal("GetClient() returned nil")
	}
	if _, ok := c.provider.(*MockGateProvider); !ok {
		t.Fatalf("GetClient() provider = %T, want *MockGateProvider", c.provider)
	}
}

func TestGetClientUpgradesNoopProviderWhenSDKKeyArrives(t *testing.T) {
	resetClientForTest(t)

	noopClient := GetClient("")
	configuredClient := GetClient("secret-key")

	if configuredClient == noopClient {
		t.Fatal("GetClient() kept no-op client after non-empty SDK key arrived")
	}
	if _, ok := configuredClient.provider.(*defaultStatsigProvider); !ok {
		t.Fatalf("GetClient() provider = %T, want *defaultStatsigProvider", configuredClient.provider)
	}
}

func TestGetClientLogsNoopAndDifferentSDKKey(t *testing.T) {
	resetClientForTest(t)

	logs := captureLogs(func() {
		GetClient("")
	})
	if !strings.Contains(logs, "initializing no-op Statsig provider") {
		t.Fatalf("GetClient(\"\") logs = %q, want no-op initialization message", logs)
	}

	resetClientForTest(t)
	GetClient("secret-key")
	logs = captureLogs(func() {
		GetClient("another-key")
	})
	if !strings.Contains(logs, "different non-empty Statsig SDK key") {
		t.Fatalf("GetClient() key mismatch logs = %q, want mismatch warning", logs)
	}
	if strings.Contains(logs, "secret-key") || strings.Contains(logs, "another-key") {
		t.Fatalf("GetClient() key mismatch logs leaked SDK key material: %q", logs)
	}
}

func TestShutdown(t *testing.T) {
	mockProvider := &MockGateProvider{Flags: make(map[string]bool)}
	c := &StatsigClient{provider: mockProvider}
	c.Shutdown()

	var nilClient *StatsigClient
	nilClient.Shutdown()

	(&StatsigClient{}).Shutdown()
}

func TestSetTestClient(t *testing.T) {
	resetClientForTest(t)

	mockProvider := &MockGateProvider{Flags: make(map[string]bool)}
	c := &StatsigClient{provider: mockProvider}
	SetTestClient(c)
	if client != c {
		t.Errorf("SetTestClient did not set the global client")
	}
	if got := GetClient("secret-key"); got != c {
		t.Fatal("GetClient overwrote test client after SetTestClient")
	}
}

func TestSetTestFlags(t *testing.T) {
	resetClientForTest(t)

	flags := map[string]bool{
		ModeComputerUse: true,
		ModeQuick:       false,
	}
	SetTestFlags(flags)
	flags[ModeComputerUse] = false

	c := GetClient("secret-key")
	if c == nil {
		t.Fatal("GetClient() returned nil after SetTestFlags")
	}
	if !clientIsTest {
		t.Fatal("SetTestFlags did not mark the singleton as a test client")
	}
	if got := c.IsEnabled(User{}, ModeComputerUse); got != true {
		t.Fatalf("IsEnabled() = %v, want copied true value", got)
	}
	if got := c.IsEnabled(User{}, ModeQuick); got != false {
		t.Fatalf("IsEnabled() = %v, want copied false value", got)
	}
}

func TestSetTestClientConcurrentWithGetClient(t *testing.T) {
	resetClientForTest(t)

	mockProvider := &MockGateProvider{Flags: make(map[string]bool)}
	c := &StatsigClient{provider: mockProvider}

	var wg sync.WaitGroup
	for range 50 {
		wg.Add(2)
		go func() {
			defer wg.Done()
			SetTestClient(c)
		}()
		go func() {
			defer wg.Done()
			_ = GetClient("")
		}()
	}
	wg.Wait()

	if got := GetClient("secret-key"); got != c {
		t.Fatal("GetClient overwrote test client after concurrent SetTestClient")
	}
}

func TestDefaultProvider(t *testing.T) {
	// Initialize with a fake key to avoid panic but hit the code paths
	statsig.Initialize("secret-123")
	defer statsig.Shutdown()

	p := &defaultStatsigProvider{}
	_ = p.CheckGate(statsig.User{UserID: "test"}, "any")
	_, found := p.CheckGateResult(statsig.User{UserID: "test"}, "any")
	if !found {
		t.Fatal("CheckGateResult() found = false, want true")
	}
	p.Shutdown()
}

func TestMockGateProvider(t *testing.T) {
	p := &MockGateProvider{Flags: map[string]bool{ModeComputerUse: true}}

	if got := p.CheckGate(statsig.User{UserID: "test"}, ModeComputerUse); got != true {
		t.Fatalf("CheckGate() = %v, want true", got)
	}

	got, found := p.CheckGateResult(statsig.User{UserID: "test"}, ModeComputerUse)
	if !found || !got {
		t.Fatalf("CheckGateResult() = (%v, %v), want (true, true)", got, found)
	}

	got, found = p.CheckGateResult(statsig.User{UserID: "test"}, ModeImageGen)
	if found || got {
		t.Fatalf("missing CheckGateResult() = (%v, %v), want (false, false)", got, found)
	}

	p.Shutdown()
}
