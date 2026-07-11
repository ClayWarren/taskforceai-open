package config

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"maps"
	"strings"
	"sync"

	enginecoreconfig "github.com/TaskForceAI/core/pkg/enginecore/config"
)

//go:embed default_config.yaml
var defaultConfigYAML []byte

type configCacheEntry struct {
	config              Config
	mtime               int64
	promptOverridesHash uint64
	envHash             uint64
}

var (
	cacheMu sync.Mutex
	cache   = make(map[string]configCacheEntry)
)

// ErrConfigLoaderSourceUnavailable is returned when LoadConfig needs an outer config source.
var ErrConfigLoaderSourceUnavailable = fmt.Errorf("config loader source unavailable")

// ConfigLoadRequest describes the config document LoadConfig needs from an outer source.
type ConfigLoadRequest struct {
	Path            string
	EmbeddedDefault []byte
}

// ConfigDocument describes a loaded or loadable config document.
type ConfigDocument struct {
	Name     string
	CacheKey string
	Data     []byte
	HasData  bool
	ModTime  int64
}

// ConfigEnvironmentOverrides supplies process-specific config overrides from an outer source.
type ConfigEnvironmentOverrides interface {
	Fingerprint() uint64
	GatewayAPIKey() string
	ModelBaseURL(modelID string) string
}

// ConfigLoaderSource locates config bytes and environment overrides outside the core package.
type ConfigLoaderSource interface {
	LocateConfigDocument(request ConfigLoadRequest) (ConfigDocument, error)
	ReadConfigDocument(document ConfigDocument) ([]byte, error)
	EnvironmentOverrides() ConfigEnvironmentOverrides
}

type emptyConfigLoaderSource struct{}

type emptyConfigEnvironmentOverrides struct{}

func (emptyConfigLoaderSource) LocateConfigDocument(request ConfigLoadRequest) (ConfigDocument, error) {
	if strings.TrimSpace(request.Path) != "" {
		return ConfigDocument{}, ErrConfigLoaderSourceUnavailable
	}
	return ConfigDocument{
		Name:     "default://embedded",
		CacheKey: "default://embedded",
		Data:     append([]byte(nil), request.EmbeddedDefault...),
		HasData:  true,
		ModTime:  0,
	}, nil
}

func (emptyConfigLoaderSource) ReadConfigDocument(ConfigDocument) ([]byte, error) {
	return nil, ErrConfigLoaderSourceUnavailable
}

func (emptyConfigLoaderSource) EnvironmentOverrides() ConfigEnvironmentOverrides {
	return emptyConfigEnvironmentOverrides{}
}

func (emptyConfigEnvironmentOverrides) Fingerprint() uint64 {
	return 0
}

func (emptyConfigEnvironmentOverrides) GatewayAPIKey() string {
	return ""
}

func (emptyConfigEnvironmentOverrides) ModelBaseURL(string) string {
	return ""
}

type PromptOverrideProvider interface {
	SystemPromptOverride() string
	QuestionGenerationPromptOverride() string
	SynthesisPromptOverride() string
	ModelSystemPromptOverride(modelID string) string
	PromptOverridesFingerprint() uint64
}

type emptyPromptOverrideProvider struct{}

func (emptyPromptOverrideProvider) SystemPromptOverride() string {
	return ""
}

func (emptyPromptOverrideProvider) QuestionGenerationPromptOverride() string {
	return ""
}

func (emptyPromptOverrideProvider) SynthesisPromptOverride() string {
	return ""
}

func (emptyPromptOverrideProvider) ModelSystemPromptOverride(string) string {
	return ""
}

func (emptyPromptOverrideProvider) PromptOverridesFingerprint() uint64 {
	return 0
}

var (
	promptOverrideProviderMu sync.RWMutex
	promptOverrideProvider   PromptOverrideProvider = emptyPromptOverrideProvider{}
	configLoaderSourceMu     sync.RWMutex
	configLoaderSource       ConfigLoaderSource = emptyConfigLoaderSource{}
)

func SetPromptOverrideProvider(provider PromptOverrideProvider) func() {
	if provider == nil {
		provider = emptyPromptOverrideProvider{}
	}

	promptOverrideProviderMu.Lock()
	previous := promptOverrideProvider
	promptOverrideProvider = provider
	promptOverrideProviderMu.Unlock()

	return func() {
		promptOverrideProviderMu.Lock()
		promptOverrideProvider = previous
		promptOverrideProviderMu.Unlock()
	}
}

func currentPromptOverrideProvider() PromptOverrideProvider {
	promptOverrideProviderMu.RLock()
	provider := promptOverrideProvider
	promptOverrideProviderMu.RUnlock()
	if provider == nil {
		return emptyPromptOverrideProvider{}
	}
	return provider
}

// SetConfigLoaderSource installs the outer source used by LoadConfig and returns a restore function.
func SetConfigLoaderSource(source ConfigLoaderSource) func() {
	if source == nil {
		source = emptyConfigLoaderSource{}
	}

	configLoaderSourceMu.Lock()
	previous := configLoaderSource
	configLoaderSource = source
	configLoaderSourceMu.Unlock()
	resetLoadConfigCache()

	return func() {
		configLoaderSourceMu.Lock()
		configLoaderSource = previous
		configLoaderSourceMu.Unlock()
		resetLoadConfigCache()
	}
}

func currentConfigLoaderSource() ConfigLoaderSource {
	configLoaderSourceMu.RLock()
	source := configLoaderSource
	configLoaderSourceMu.RUnlock()
	if source == nil {
		return emptyConfigLoaderSource{}
	}
	return source
}

func resetLoadConfigCache() {
	cacheMu.Lock()
	cache = make(map[string]configCacheEntry)
	cacheMu.Unlock()
}

func LoadConfig(configPath string) (Config, error) {
	source := currentConfigLoaderSource()
	promptOverrides := currentPromptOverrideProvider()
	promptOverridesHash := promptOverrides.PromptOverridesFingerprint()
	envOverrides := source.EnvironmentOverrides()
	if envOverrides == nil {
		envOverrides = emptyConfigEnvironmentOverrides{}
	}
	envHash := envOverrides.Fingerprint()
	document, err := source.LocateConfigDocument(ConfigLoadRequest{
		Path:            configPath,
		EmbeddedDefault: defaultConfigYAML,
	})
	if err != nil {
		return Config{}, err
	}
	cacheKey := document.CacheKey
	if cacheKey == "" {
		cacheKey = document.Name
	}

	cacheMu.Lock()
	if entry, ok := cache[cacheKey]; ok &&
		entry.mtime == document.ModTime &&
		entry.promptOverridesHash == promptOverridesHash &&
		entry.envHash == envHash {
		cacheMu.Unlock()
		return entry.config, nil
	}
	cacheMu.Unlock()

	data := document.Data
	if !document.HasData {
		data, err = source.ReadConfigDocument(document)
		if err != nil {
			return Config{}, err
		}
	}

	raw, err := basicYAMLParse(string(data))
	if err != nil {
		return Config{}, fmt.Errorf("failed to parse yaml from %s: %w", document.Name, err)
	}

	// Manual mapping to struct (mimicking what our hand-rolled parser returns)
	jsonBytes, err := jsonMarshal(raw)
	if err != nil {
		return Config{}, err
	}

	var cfg Config
	if err := json.Unmarshal(jsonBytes, &cfg); err != nil {
		return Config{}, fmt.Errorf("failed to map config to struct: %w", err)
	}

	applyPromptOverrides(&cfg, promptOverrides)
	if err := applyEnginecoreOverrides(&cfg); err != nil {
		return Config{}, err
	}

	if apiKey := envOverrides.GatewayAPIKey(); apiKey != "" && cfg.Gateway.APIKey == "" {
		cfg.Gateway.APIKey = apiKey
	}

	for i, opt := range cfg.Models.Options {
		if val := envOverrides.ModelBaseURL(opt.ID); val != "" {
			cfg.Models.Options[i].BaseURL = val
		}
	}

	cacheMu.Lock()
	cache[cacheKey] = configCacheEntry{
		config:              cfg,
		mtime:               document.ModTime,
		promptOverridesHash: promptOverridesHash,
		envHash:             envHash,
	}
	cacheMu.Unlock()

	return cfg, nil
}

var (
	jsonMarshal         = json.Marshal
	getEnginecoreConfig = enginecoreconfig.Get
)

func loadPromptOverrides(cfg *Config) {
	applyPromptOverrides(cfg, currentPromptOverrideProvider())
}

func applyPromptOverrides(cfg *Config, provider PromptOverrideProvider) {
	if provider == nil {
		return
	}
	if text := strings.TrimSpace(provider.SystemPromptOverride()); text != "" {
		cfg.SystemPrompt = text
	}
	if text := strings.TrimSpace(provider.QuestionGenerationPromptOverride()); text != "" {
		cfg.Orchestrator.QuestionGenerationPrompt = text
	}
	if text := strings.TrimSpace(provider.SynthesisPromptOverride()); text != "" {
		cfg.Orchestrator.SynthesisPrompt = text
	}
	for i := range cfg.Models.Options {
		id := strings.TrimSpace(cfg.Models.Options[i].ID)
		if id == "" {
			continue
		}
		if text := strings.TrimSpace(provider.ModelSystemPromptOverride(id)); text != "" {
			cfg.Models.Options[i].SystemPrompt = text
		}
	}
}

func applyEnginecoreOverrides(cfg *Config) error {
	info, err := getEnginecoreConfig()
	if err != nil {
		return fmt.Errorf("load enginecore config: %w", err)
	}
	if info == nil || info.TaskForceAI == nil {
		return nil
	}
	tf := info.TaskForceAI
	applyEnginecoreGateway(cfg, tf)
	applyEnginecoreModels(cfg, tf)
	applyEnginecoreAgent(cfg, tf)
	applyEnginecoreOrchestrator(cfg, tf)
	applyEnginecoreSearch(cfg, tf)
	applyEnginecoreWebApp(cfg, tf)
	applyEnginecoreCORS(cfg, tf)
	return nil
}

func applyEnginecoreGateway(cfg *Config, tf *enginecoreconfig.TaskForceAIConfig) {
	if tf.Gateway == nil {
		return
	}
	if tf.Gateway.APIKey != nil {
		cfg.Gateway.APIKey = *tf.Gateway.APIKey
	}
	if tf.Gateway.BaseURL != nil {
		cfg.Gateway.BaseURL = *tf.Gateway.BaseURL
	}
	if tf.Gateway.Model != nil {
		cfg.Gateway.Model = *tf.Gateway.Model
	}
	if tf.Gateway.DefaultHeaders != nil {
		cfg.Gateway.DefaultHeaders = map[string]string{}
		maps.Copy(cfg.Gateway.DefaultHeaders, tf.Gateway.DefaultHeaders)
	}
}

func applyEnginecoreModels(cfg *Config, tf *enginecoreconfig.TaskForceAIConfig) {
	if tf.Models == nil {
		return
	}
	if tf.Models.Default != nil {
		cfg.Models.Default = *tf.Models.Default
	}
	if tf.Models.Options != nil {
		cfg.Models.Options = make([]ModelOption, 0, len(tf.Models.Options))
		for _, opt := range tf.Models.Options {
			cfg.Models.Options = append(cfg.Models.Options, ModelOption{
				ID:                  opt.ID,
				Label:               opt.Label,
				Description:         opt.Description,
				UsageMultiple:       opt.UsageMultiple,
				BaseURL:             opt.BaseURL,
				SystemPrompt:        opt.SystemPrompt,
				SystemPromptVersion: opt.SystemPromptVersion,
			})
		}
	}
}

func applyEnginecoreAgent(cfg *Config, tf *enginecoreconfig.TaskForceAIConfig) {
	if tf.Agent == nil {
		return
	}
	if tf.Agent.MaxIterations != nil {
		cfg.Agent.MaxIterations = *tf.Agent.MaxIterations
	}
	if tf.Agent.Temperature != nil {
		cfg.Agent.Temperature = tf.Agent.Temperature
	}
}

func applyEnginecoreOrchestrator(cfg *Config, tf *enginecoreconfig.TaskForceAIConfig) {
	if tf.Orchestrator == nil {
		return
	}
	if tf.Orchestrator.ParallelAgents != nil {
		cfg.Orchestrator.ParallelAgents = *tf.Orchestrator.ParallelAgents
	}
	if tf.Orchestrator.TaskTimeout != nil {
		cfg.Orchestrator.TaskTimeout = *tf.Orchestrator.TaskTimeout
	}
	if tf.Orchestrator.AggregationStrategy != nil {
		cfg.Orchestrator.AggregationStrategy = *tf.Orchestrator.AggregationStrategy
	}
	if tf.Orchestrator.QuestionGenerationPrompt != nil {
		cfg.Orchestrator.QuestionGenerationPrompt = *tf.Orchestrator.QuestionGenerationPrompt
	}
	if tf.Orchestrator.SynthesisPrompt != nil {
		cfg.Orchestrator.SynthesisPrompt = *tf.Orchestrator.SynthesisPrompt
	}
}

func applyEnginecoreSearch(cfg *Config, tf *enginecoreconfig.TaskForceAIConfig) {
	if tf.Search == nil {
		return
	}
	if tf.Search.MaxResults != nil {
		cfg.Search.MaxResults = *tf.Search.MaxResults
	}
	if tf.Search.UserAgent != nil {
		cfg.Search.UserAgent = *tf.Search.UserAgent
	}
	if tf.Search.Provider != nil {
		cfg.Search.Provider = *tf.Search.Provider
	}
	if tf.Search.Brave == nil {
		return
	}
	if tf.Search.Brave.APIKey != nil {
		cfg.Search.Brave.APIKey = *tf.Search.Brave.APIKey
	}
	if tf.Search.Brave.Endpoint != nil {
		cfg.Search.Brave.Endpoint = *tf.Search.Brave.Endpoint
	}
}

func applyEnginecoreWebApp(cfg *Config, tf *enginecoreconfig.TaskForceAIConfig) {
	if tf.WebApp == nil || tf.WebApp.RateLimit == nil {
		return
	}
	if tf.WebApp.RateLimit.RequestsPerMinute != nil {
		cfg.WebApp.RateLimit.RequestsPerMinute = *tf.WebApp.RateLimit.RequestsPerMinute
	}
	if tf.WebApp.RateLimit.RequestsPerHour != nil {
		cfg.WebApp.RateLimit.RequestsPerHour = *tf.WebApp.RateLimit.RequestsPerHour
	}
	if tf.WebApp.RateLimit.MaxConcurrentRequests != nil {
		cfg.WebApp.RateLimit.MaxConcurrentRequests = *tf.WebApp.RateLimit.MaxConcurrentRequests
	}
}

func applyEnginecoreCORS(cfg *Config, tf *enginecoreconfig.TaskForceAIConfig) {
	if tf.CORS == nil || tf.CORS.AllowedOrigins == nil {
		return
	}
	cfg.CORS.AllowedOrigins = append([]string{}, tf.CORS.AllowedOrigins...)
}
