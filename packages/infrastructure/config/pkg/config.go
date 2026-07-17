package pkg

import (
	"fmt"
	"net/url"
	"os"
	"reflect"
	"strconv"
	"strings"
	"sync"

	"github.com/joho/godotenv"
)

const (
	defaultAuthSecret = "development-fallback-auth-secret-32-chars!"
	// #nosec G101 -- this is a validation error message, not a credential.
	authSecretProductionError   = "AUTH_SECRET must be changed from the default value in production"
	invalidBooleanValueTemplate = "invalid boolean-like value %q (expected true/false/1/0/yes/no/y/n)"
	maxWebEnvSnapshotEntries    = 128
)

// WebEnv represents the configuration structure mirrored from packages/core/ts/client-core/src/config/server.ts.
type WebEnv struct {
	NodeEnv                          string `env:"NODE_ENV" envDefault:"development"`
	DatabaseURL                      string `env:"DATABASE_URL" envDefault:""`
	AIGatewayAPIKey                  string `env:"AI_GATEWAY_API_KEY"`
	VercelAIGatewayURL               string `env:"VERCEL_AI_GATEWAY_URL"`
	AuthSecret                       string `env:"AUTH_SECRET"`
	AuthURL                          string `env:"AUTH_URL"`
	GoogleClientID                   string `env:"GOOGLE_CLIENT_ID"`
	GoogleClientSecret               string `env:"GOOGLE_CLIENT_SECRET"`
	DaytonaAPIKey                    string `env:"DAYTONA_API_KEY"`
	DaytonaJWTToken                  string `env:"DAYTONA_JWT_TOKEN"`
	DaytonaOrganizationID            string `env:"DAYTONA_ORGANIZATION_ID"`
	BraveSearchAPIKey                string `env:"BRAVE_SEARCH_API_KEY"`
	RedisURL                         string `env:"REDIS_URL"`
	RedisKVURL                       string `env:"REDIS_KV_URL"`
	DaytonaSandboxPoolSize           int    `env:"DAYTONA_SANDBOX_POOL_SIZE"`
	InngestEventKey                  string `env:"INNGEST_EVENT_KEY"`
	InngestSigningKey                string `env:"INNGEST_SIGNING_KEY"`
	InternalAPISecret                string `env:"INTERNAL_API_SECRET"`
	StripeSecretKey                  string `env:"STRIPE_SECRET_KEY"`
	StripeWebhookSecret              string `env:"STRIPE_WEBHOOK_SECRET"`
	StripeProPriceID                 string `env:"STRIPE_PRO_PRICE_ID"`
	StripeSuperPriceID               string `env:"STRIPE_SUPER_PRICE_ID"`
	RevenueCatSecretKey              string `env:"REVENUECAT_SECRET_KEY"`
	RevenueCatWebhookSecret          string `env:"REVENUECAT_WEBHOOK_SECRET"`
	RevenueCatEntitlementPro         string `env:"REVENUECAT_ENTITLEMENT_PRO" envDefault:"pro"`
	RevenueCatEntitlementSuper       string `env:"REVENUECAT_ENTITLEMENT_SUPER" envDefault:"super"`
	AppStoreProProductID             string `env:"APP_STORE_PRO_PRODUCT_ID"`
	PlayStoreProProductID            string `env:"PLAY_STORE_PRO_PRODUCT_ID"`
	AppStoreSuperProductID           string `env:"APP_STORE_SUPER_PRODUCT_ID"`
	PlayStoreSuperProductID          string `env:"PLAY_STORE_SUPER_PRODUCT_ID"`
	EnablePayments                   bool   `env:"ENABLE_PAYMENTS" envDefault:"true"`
	TaskForceAIAPIInMemory           bool   `env:"TASKFORCEAI_API_IN_MEMORY" envDefault:"false"`
	DisableRateLimiterMemoryFallback bool   `env:"DISABLE_RATE_LIMITER_MEMORY_FALLBACK" envDefault:"false"`
	TaskForceAIMockOrchestration     bool   `env:"TASKFORCEAI_MOCK_ORCHESTRATION" envDefault:"false"`
	CacheHashAlgorithm               string `env:"CACHE_HASH_ALGORITHM" envDefault:"sha1"`
	TaskForceAIEnablePerfBuffer      bool   `env:"TASKFORCEAI_ENABLE_PERF_BUFFER" envDefault:"false"`
	Vercel                           string `env:"VERCEL"`
	BunTest                          string `env:"BUN_TEST"`
	Vitest                           string `env:"VITEST"`
	ResendAPIKey                     string `env:"RESEND_API_KEY"`
	ResendFromEmail                  string `env:"RESEND_FROM_EMAIL"`
	ResendSupportEmail               string `env:"RESEND_SUPPORT_EMAIL"`
	TaskForceAIDashboardURL          string `env:"TASKFORCEAI_DASHBOARD_URL"`
	TaskForceAIBillingURL            string `env:"TASKFORCEAI_BILLING_URL"`
	EncryptionKey                    string `env:"ENCRYPTION_KEY"`
	EncryptionKeyActiveVersion       string `env:"ENCRYPTION_KEY_ACTIVE_VERSION"`
	AllowedOrigins                   string `env:"ALLOWED_ORIGINS"`
	JWTSecret                        string `env:"JWT_SECRET"`
	LogLevel                         string `env:"LOG_LEVEL"`
	OllamaEnabled                    bool   `env:"OLLAMA_ENABLED" envDefault:"false"`
	OllamaModel                      string `env:"OLLAMA_MODEL"`

	// Microservice URLs
	AuthServiceURL      string `env:"AUTH_SERVICE_URL" envDefault:"http://localhost:3002"`
	BillingServiceURL   string `env:"BILLING_SERVICE_URL" envDefault:"http://localhost:3003"`
	DeveloperServiceURL string `env:"DEVELOPER_SERVICE_URL" envDefault:"http://localhost:3004"`
	CoreServiceURL      string `env:"CORE_SERVICE_URL" envDefault:"http://localhost:3001"`
	EngineServiceURL    string `env:"ENGINE_SERVICE_URL" envDefault:"http://localhost:3005"`
	SyncServiceURL      string `env:"SYNC_SERVICE_URL" envDefault:"http://localhost:3006"`
}

// LoadWebEnvOptions configuration options for loading the environment.
type LoadWebEnvOptions struct {
	EnvFile        string
	SkipValidation bool
	IsTestEnv      bool
}

var (
	globalWebEnv            WebEnv
	globalWebEnvCached      bool
	globalWebEnvSnapshot    [maxWebEnvSnapshotEntries]webEnvSnapshotEntry
	globalWebEnvSnapshotLen int
	globalWebEnvMu          sync.RWMutex
	webEnvKeys              []string
	webEnvKeysOnce          sync.Once
)

type webEnvSnapshotEntry struct {
	value string
	set   bool
}

func parseWebEnv(cfg *WebEnv) error {
	var err error

	cfg.NodeEnv = lookupEnvDefault("NODE_ENV", "development")
	cfg.DatabaseURL = os.Getenv("DATABASE_URL")
	cfg.AIGatewayAPIKey = os.Getenv("AI_GATEWAY_API_KEY")
	cfg.VercelAIGatewayURL = os.Getenv("VERCEL_AI_GATEWAY_URL")
	cfg.AuthSecret = os.Getenv("AUTH_SECRET")
	cfg.AuthURL = os.Getenv("AUTH_URL")
	cfg.GoogleClientID = os.Getenv("GOOGLE_CLIENT_ID")
	cfg.GoogleClientSecret = os.Getenv("GOOGLE_CLIENT_SECRET")
	cfg.DaytonaAPIKey = os.Getenv("DAYTONA_API_KEY")
	cfg.DaytonaJWTToken = os.Getenv("DAYTONA_JWT_TOKEN")
	cfg.DaytonaOrganizationID = os.Getenv("DAYTONA_ORGANIZATION_ID")
	cfg.BraveSearchAPIKey = os.Getenv("BRAVE_SEARCH_API_KEY")
	cfg.RedisURL = os.Getenv("REDIS_URL")
	cfg.RedisKVURL = os.Getenv("REDIS_KV_URL")
	cfg.DaytonaSandboxPoolSize, err = parseEnvNonNegativeInt("DAYTONA_SANDBOX_POOL_SIZE", "DaytonaSandboxPoolSize")
	if err != nil {
		return err
	}
	cfg.InngestEventKey = os.Getenv("INNGEST_EVENT_KEY")
	cfg.InngestSigningKey = os.Getenv("INNGEST_SIGNING_KEY")
	cfg.InternalAPISecret = os.Getenv("INTERNAL_API_SECRET")
	cfg.StripeSecretKey = os.Getenv("STRIPE_SECRET_KEY")
	cfg.StripeWebhookSecret = os.Getenv("STRIPE_WEBHOOK_SECRET")
	cfg.StripeProPriceID = os.Getenv("STRIPE_PRO_PRICE_ID")
	cfg.StripeSuperPriceID = os.Getenv("STRIPE_SUPER_PRICE_ID")
	cfg.RevenueCatSecretKey = os.Getenv("REVENUECAT_SECRET_KEY")
	cfg.RevenueCatWebhookSecret = os.Getenv("REVENUECAT_WEBHOOK_SECRET")
	cfg.RevenueCatEntitlementPro = lookupEnvDefault("REVENUECAT_ENTITLEMENT_PRO", "pro")
	cfg.RevenueCatEntitlementSuper = lookupEnvDefault("REVENUECAT_ENTITLEMENT_SUPER", "super")
	cfg.AppStoreProProductID = os.Getenv("APP_STORE_PRO_PRODUCT_ID")
	cfg.PlayStoreProProductID = os.Getenv("PLAY_STORE_PRO_PRODUCT_ID")
	cfg.AppStoreSuperProductID = os.Getenv("APP_STORE_SUPER_PRODUCT_ID")
	cfg.PlayStoreSuperProductID = os.Getenv("PLAY_STORE_SUPER_PRODUCT_ID")
	cfg.EnablePayments, err = parseEnvBool("ENABLE_PAYMENTS", "EnablePayments", true)
	if err != nil {
		return err
	}
	cfg.TaskForceAIAPIInMemory, err = parseEnvBool("TASKFORCEAI_API_IN_MEMORY", "TaskForceAIAPIInMemory", false)
	if err != nil {
		return err
	}
	cfg.DisableRateLimiterMemoryFallback, err = parseEnvBool("DISABLE_RATE_LIMITER_MEMORY_FALLBACK", "DisableRateLimiterMemoryFallback", false)
	if err != nil {
		return err
	}
	cfg.TaskForceAIMockOrchestration, err = parseEnvBool("TASKFORCEAI_MOCK_ORCHESTRATION", "TaskForceAIMockOrchestration", false)
	if err != nil {
		return err
	}
	cfg.CacheHashAlgorithm = lookupEnvDefault("CACHE_HASH_ALGORITHM", "sha1")
	cfg.TaskForceAIEnablePerfBuffer, err = parseEnvBool("TASKFORCEAI_ENABLE_PERF_BUFFER", "TaskForceAIEnablePerfBuffer", false)
	if err != nil {
		return err
	}
	cfg.Vercel = os.Getenv("VERCEL")
	cfg.BunTest = os.Getenv("BUN_TEST")
	cfg.Vitest = os.Getenv("VITEST")
	cfg.ResendAPIKey = os.Getenv("RESEND_API_KEY")
	cfg.ResendFromEmail = os.Getenv("RESEND_FROM_EMAIL")
	cfg.ResendSupportEmail = os.Getenv("RESEND_SUPPORT_EMAIL")
	cfg.TaskForceAIDashboardURL = os.Getenv("TASKFORCEAI_DASHBOARD_URL")
	cfg.TaskForceAIBillingURL = os.Getenv("TASKFORCEAI_BILLING_URL")
	cfg.EncryptionKey = os.Getenv("ENCRYPTION_KEY")
	cfg.EncryptionKeyActiveVersion = os.Getenv("ENCRYPTION_KEY_ACTIVE_VERSION")
	cfg.AllowedOrigins = os.Getenv("ALLOWED_ORIGINS")
	cfg.JWTSecret = os.Getenv("JWT_SECRET")
	cfg.LogLevel = os.Getenv("LOG_LEVEL")
	cfg.OllamaEnabled, err = parseEnvBool("OLLAMA_ENABLED", "OllamaEnabled", false)
	if err != nil {
		return err
	}
	cfg.OllamaModel = os.Getenv("OLLAMA_MODEL")
	cfg.AuthServiceURL = lookupEnvDefault("AUTH_SERVICE_URL", "http://localhost:3002")
	cfg.BillingServiceURL = lookupEnvDefault("BILLING_SERVICE_URL", "http://localhost:3003")
	cfg.DeveloperServiceURL = lookupEnvDefault("DEVELOPER_SERVICE_URL", "http://localhost:3004")
	cfg.CoreServiceURL = lookupEnvDefault("CORE_SERVICE_URL", "http://localhost:3001")
	cfg.EngineServiceURL = lookupEnvDefault("ENGINE_SERVICE_URL", "http://localhost:3005")
	cfg.SyncServiceURL = lookupEnvDefault("SYNC_SERVICE_URL", "http://localhost:3006")
	return nil
}

func lookupEnvDefault(key string, fallback string) string {
	if val, ok := os.LookupEnv(key); ok && val != "" {
		return val
	}
	return fallback
}

func parseEnvInt(key string, fieldName string) (int, error) {
	raw, ok := os.LookupEnv(key)
	if !ok || raw == "" {
		return 0, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("parse error on field %q of type %q: %w", fieldName, "int", err)
	}
	return value, nil
}

func parseEnvNonNegativeInt(key string, fieldName string) (int, error) {
	value, err := parseEnvInt(key, fieldName)
	if err != nil {
		return 0, err
	}
	if value < 0 {
		return 0, fmt.Errorf("parse error on field %q of type %q: value must be greater than or equal to 0", fieldName, "int")
	}
	return value, nil
}

func parseEnvBool(key string, fieldName string, fallback bool) (bool, error) {
	raw, ok := os.LookupEnv(key)
	if !ok || raw == "" {
		return fallback, nil
	}
	value, err := parseFlexibleBool(raw)
	if err != nil {
		return false, fmt.Errorf("parse error on field %q of type %q: %w", fieldName, "bool", err)
	}
	return value, nil
}

func parseFlexibleBool(v string) (bool, error) {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "true", "1", "yes", "y":
		return true, nil
	case "false", "0", "no", "n":
		return false, nil
	default:
		return false, fmt.Errorf(invalidBooleanValueTemplate, v)
	}
}

func webEnvVariableKeys() []string {
	webEnvKeysOnce.Do(func() {
		webEnvKeys = envVariableKeysForType(reflect.TypeFor[WebEnv]())
	})
	return webEnvKeys
}

func envVariableKeysForType(cfgType reflect.Type) []string {
	keys := make([]string, 0, cfgType.NumField())
	for field := range cfgType.Fields() {
		key := field.Tag.Get("env")
		if key == "" {
			continue
		}
		keys = append(keys, key)
	}
	return keys
}

func captureWebEnvSnapshot() ([maxWebEnvSnapshotEntries]webEnvSnapshotEntry, int) {
	return captureWebEnvSnapshotForKeys(webEnvVariableKeys())
}

func captureWebEnvSnapshotForKeys(keys []string) ([maxWebEnvSnapshotEntries]webEnvSnapshotEntry, int) {
	if len(keys) > maxWebEnvSnapshotEntries {
		panic("WebEnv has more fields than the env snapshot cache supports")
	}

	var snapshot [maxWebEnvSnapshotEntries]webEnvSnapshotEntry
	for i, key := range keys {
		snapshot[i].value, snapshot[i].set = os.LookupEnv(key)
	}
	return snapshot, len(keys)
}

func webEnvSnapshotMatchesCurrentEnv(snapshot *[maxWebEnvSnapshotEntries]webEnvSnapshotEntry, snapshotLen int) bool {
	keys := webEnvVariableKeys()
	if snapshotLen != len(keys) {
		return false
	}
	for i, key := range keys {
		val, ok := os.LookupEnv(key)
		if ok != snapshot[i].set || val != snapshot[i].value {
			return false
		}
	}
	return true
}

func loadCachedWebEnvForCurrentEnv() *WebEnv {
	globalWebEnvMu.RLock()
	defer globalWebEnvMu.RUnlock()

	if !globalWebEnvCached {
		return nil
	}
	if !webEnvSnapshotMatchesCurrentEnv(&globalWebEnvSnapshot, globalWebEnvSnapshotLen) {
		return nil
	}

	cached := globalWebEnv
	return &cached
}

func storeCachedWebEnv(cfg *WebEnv, snapshot [maxWebEnvSnapshotEntries]webEnvSnapshotEntry, snapshotLen int) {
	if cfg == nil {
		return
	}

	globalWebEnvMu.Lock()
	globalWebEnv = *cfg
	globalWebEnvCached = true
	globalWebEnvSnapshot = snapshot
	globalWebEnvSnapshotLen = snapshotLen
	globalWebEnvMu.Unlock()
}

func hasMinSecretLength(secret string, minLen int) bool {
	return len(strings.TrimSpace(secret)) >= minLen
}

// ServiceURLs provides a mapped structure of internal service locations.
type ServiceURLs struct {
	Auth      string
	Billing   string
	Developer string
	Core      string
	Engine    string
	Sync      string
}

// GetServiceURLs returns the resolved internal URLs for microservice communication.
func (cfg *WebEnv) GetServiceURLs() ServiceURLs {
	return ServiceURLs{
		Auth:      cfg.AuthServiceURL,
		Billing:   cfg.BillingServiceURL,
		Developer: cfg.DeveloperServiceURL,
		Core:      cfg.CoreServiceURL,
		Engine:    cfg.EngineServiceURL,
		Sync:      cfg.SyncServiceURL,
	}
}

// LoadWebEnv loads environment variables into the WebEnv struct.
func LoadWebEnv(opts LoadWebEnvOptions) (*WebEnv, error) {
	if !opts.IsTestEnv && opts.EnvFile == "" && opts.SkipValidation {
		if cached := loadCachedWebEnvForCurrentEnv(); cached != nil {
			return cached, nil
		}
	}

	// Load from .env file if present
	if opts.EnvFile != "" {
		if err := godotenv.Load(opts.EnvFile); err != nil {
			return nil, fmt.Errorf("failed to load env file %q: %w", opts.EnvFile, err)
		}
	} else if os.Getenv("VERCEL") == "" && !opts.IsTestEnv {
		// Try default .env only if not on Vercel and not in tests
		_ = godotenv.Load()
	}

	cacheable := !opts.IsTestEnv && opts.EnvFile == ""
	var cacheSnapshot [maxWebEnvSnapshotEntries]webEnvSnapshotEntry
	var cacheSnapshotLen int
	if cacheable {
		cacheSnapshot, cacheSnapshotLen = captureWebEnvSnapshot()
	}

	cfg := WebEnv{}
	if err := parseWebEnv(&cfg); err != nil {
		if opts.IsTestEnv {
			return nil, err
		}
		return nil, fmt.Errorf("failed to parse environment variables: %w", err)
	}
	if _, authSecretSet := os.LookupEnv("AUTH_SECRET"); !authSecretSet {
		cfg.AuthSecret = defaultAuthSecret
	}

	if !opts.SkipValidation || cfg.NodeEnv == "production" {
		if err := validateWebEnv(&cfg); err != nil {
			return &cfg, err
		}
	}

	if cacheable && webEnvSnapshotMatchesCurrentEnv(&cacheSnapshot, cacheSnapshotLen) {
		storeCachedWebEnv(&cfg, cacheSnapshot, cacheSnapshotLen)
	}

	return &cfg, nil
}

func validateWebEnv(cfg *WebEnv) error {
	var validationErrors []string

	if cfg.NodeEnv != "development" && cfg.NodeEnv != "test" && cfg.NodeEnv != "production" {
		validationErrors = append(validationErrors, "NODE_ENV must be one of 'development', 'test', 'production'")
	}

	// URL Validation Helpers
	validateURL := func(val, name string, required bool) {
		cleanVal := strings.TrimSpace(val)
		if cleanVal == "" {
			if required {
				validationErrors = append(validationErrors, fmt.Sprintf("%s must be a valid URL (got empty)", name))
			}
			return
		}
		if !hasURLSchemeAndHost(cleanVal) {
			validationErrors = append(validationErrors, fmt.Sprintf("%s must be a valid URL (missing scheme or host)", name))
		}
	}

	validateURL(cfg.DatabaseURL, "DATABASE_URL", false)
	validateURL(cfg.VercelAIGatewayURL, "VERCEL_AI_GATEWAY_URL", false)
	validateURL(cfg.AuthURL, "AUTH_URL", false)
	validateURL(cfg.RedisURL, "REDIS_URL", false)
	validateURL(cfg.RedisKVURL, "REDIS_KV_URL", false)
	validateURL(cfg.TaskForceAIDashboardURL, "TASKFORCEAI_DASHBOARD_URL", false)
	validateURL(cfg.TaskForceAIBillingURL, "TASKFORCEAI_BILLING_URL", false)

	// Microservice URLs
	validateURL(cfg.AuthServiceURL, "AUTH_SERVICE_URL", true)
	validateURL(cfg.BillingServiceURL, "BILLING_SERVICE_URL", true)
	validateURL(cfg.DeveloperServiceURL, "DEVELOPER_SERVICE_URL", true)
	validateURL(cfg.CoreServiceURL, "CORE_SERVICE_URL", true)
	validateURL(cfg.EngineServiceURL, "ENGINE_SERVICE_URL", true)
	validateURL(cfg.SyncServiceURL, "SYNC_SERVICE_URL", true)

	if cfg.AuthSecret != "" && !hasMinSecretLength(cfg.AuthSecret, 32) {
		validationErrors = append(validationErrors, "AUTH_SECRET must be at least 32 characters")
	}
	if cfg.InternalAPISecret != "" && !hasMinSecretLength(cfg.InternalAPISecret, 32) {
		validationErrors = append(validationErrors, "INTERNAL_API_SECRET must be at least 32 characters")
	}
	if cfg.NodeEnv == "production" && (cfg.AuthSecret == "" || cfg.AuthSecret == defaultAuthSecret) {
		validationErrors = append(validationErrors, authSecretProductionError)
	}

	if cfg.CacheHashAlgorithm != "sha1" && cfg.CacheHashAlgorithm != "sha256" {
		validationErrors = append(validationErrors, "CACHE_HASH_ALGORITHM must be 'sha1' or 'sha256'")
	}

	if cfg.DaytonaSandboxPoolSize < 0 {
		validationErrors = append(validationErrors, "DAYTONA_SANDBOX_POOL_SIZE must be greater than or equal to 0")
	}

	if len(validationErrors) > 0 {
		return fmt.Errorf("environment validation failed:\n%s", strings.Join(validationErrors, "\n"))
	}
	return nil
}

func hasURLSchemeAndHost(value string) bool {
	parsed, err := url.Parse(value)
	if err != nil || parsed == nil {
		return false
	}
	return parsedURLHasSchemeAndHost(parsed)
}

func parsedURLHasSchemeAndHost(parsed *url.URL) bool {
	if parsed.Scheme == "" || !isURLScheme(parsed.Scheme) || parsed.Host == "" {
		return false
	}
	if hostHasWhitespace(parsed.Host) {
		return false
	}
	return parsed.Hostname() != ""
}

func hostHasWhitespace(host string) bool {
	return strings.ContainsAny(host, " \t\r\n")
}

func isURLScheme(scheme string) bool {
	for i, char := range scheme {
		switch {
		case char >= 'a' && char <= 'z':
		case char >= 'A' && char <= 'Z':
		case i > 0 && char >= '0' && char <= '9':
		case i > 0 && (char == '+' || char == '-' || char == '.'):
		default:
			return false
		}
	}
	return true
}
