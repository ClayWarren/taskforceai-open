package config

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	enginecoreconfig "github.com/TaskForceAI/core/pkg/enginecore/config"
)

type fakeFileInfo struct{ mod int64 }

func (f fakeFileInfo) Name() string { return "config.yaml" }

func (f fakeFileInfo) Size() int64 { return 0 }

func (f fakeFileInfo) Mode() os.FileMode { return 0o600 }

func (f fakeFileInfo) ModTime() time.Time { return time.Unix(0, f.mod) }

func (f fakeFileInfo) IsDir() bool { return false }

func (f fakeFileInfo) Sys() any { return nil }

func resetLoadConfigCacheForTest() {
	cacheMu.Lock()
	defer cacheMu.Unlock()
	cache = make(map[string]configCacheEntry)
}

func TestApplyEnginecoreOverridesCoversAllSections(t *testing.T) {
	apiKey := "key"
	baseURL := "https://gateway.example"
	gatewayModel := "gateway-model"
	defaultModel := "default-model"
	usageMultiple := 1.5
	maxIterations := 12
	temperature := 0.2
	parallelAgents := 4
	taskTimeout := 60
	strategy := "majority"
	questionPrompt := "ask better questions"
	synthesisPrompt := "synthesize"
	maxResults := 9
	userAgent := "TaskForceAI"
	provider := "brave"
	braveKey := "brave-key"
	braveEndpoint := "https://search.example"
	requestsMinute := 10
	requestsHour := 100
	maxConcurrent := 3

	cfg := Config{}
	tf := &enginecoreconfig.TaskForceAIConfig{
		Gateway: &enginecoreconfig.TaskForceAIGatewayConfig{
			APIKey:         &apiKey,
			BaseURL:        &baseURL,
			Model:          &gatewayModel,
			DefaultHeaders: map[string]string{"x-test": "true"},
		},
		Models: &enginecoreconfig.TaskForceAIModelsConfig{
			Default: &defaultModel,
			Options: []enginecoreconfig.TaskForceAIModelOption{{
				ID:                  "model-a",
				Label:               "Model A",
				Description:         "desc",
				UsageMultiple:       &usageMultiple,
				BaseURL:             "https://model.example",
				SystemPrompt:        "prompt",
				SystemPromptVersion: "v1",
			}},
		},
		Agent: &enginecoreconfig.TaskForceAIAgentConfig{
			MaxIterations: &maxIterations,
			Temperature:   &temperature,
		},
		Orchestrator: &enginecoreconfig.TaskForceAIOrchestratorConfig{
			ParallelAgents:           &parallelAgents,
			TaskTimeout:              &taskTimeout,
			AggregationStrategy:      &strategy,
			QuestionGenerationPrompt: &questionPrompt,
			SynthesisPrompt:          &synthesisPrompt,
		},
		Search: &enginecoreconfig.TaskForceAISearchConfig{
			MaxResults: &maxResults,
			UserAgent:  &userAgent,
			Provider:   &provider,
			Brave: &enginecoreconfig.TaskForceAIBraveConfig{
				APIKey:   &braveKey,
				Endpoint: &braveEndpoint,
			},
		},
		WebApp: &enginecoreconfig.TaskForceAIWebAppConfig{
			RateLimit: &enginecoreconfig.TaskForceAIRateLimitConfig{
				RequestsPerMinute:     &requestsMinute,
				RequestsPerHour:       &requestsHour,
				MaxConcurrentRequests: &maxConcurrent,
			},
		},
		CORS: &enginecoreconfig.TaskForceAICORSConfig{AllowedOrigins: []string{"https://app.example"}},
	}

	applyEnginecoreGateway(&cfg, tf)
	applyEnginecoreModels(&cfg, tf)
	applyEnginecoreAgent(&cfg, tf)
	applyEnginecoreOrchestrator(&cfg, tf)
	applyEnginecoreSearch(&cfg, tf)
	applyEnginecoreWebApp(&cfg, tf)
	applyEnginecoreCORS(&cfg, tf)

	if cfg.Gateway.APIKey != apiKey || cfg.Gateway.BaseURL != baseURL || cfg.Gateway.Model != gatewayModel {
		t.Fatalf("gateway overrides were not applied: %#v", cfg.Gateway)
	}
	tf.Gateway.DefaultHeaders["x-test"] = "changed"
	if cfg.Gateway.DefaultHeaders["x-test"] != "true" {
		t.Fatalf("default headers should be copied")
	}
	if cfg.Models.Default != defaultModel || len(cfg.Models.Options) != 1 || cfg.Models.Options[0].ID != "model-a" {
		t.Fatalf("model overrides were not applied: %#v", cfg.Models)
	}
	if cfg.Agent.MaxIterations != maxIterations || cfg.Agent.Temperature == nil || *cfg.Agent.Temperature != temperature {
		t.Fatalf("agent overrides were not applied: %#v", cfg.Agent)
	}
	if cfg.Orchestrator.ParallelAgents != parallelAgents ||
		cfg.Orchestrator.TaskTimeout != taskTimeout ||
		cfg.Orchestrator.AggregationStrategy != strategy ||
		cfg.Orchestrator.QuestionGenerationPrompt != questionPrompt ||
		cfg.Orchestrator.SynthesisPrompt != synthesisPrompt {
		t.Fatalf("orchestrator overrides were not applied: %#v", cfg.Orchestrator)
	}
	if cfg.Search.MaxResults != maxResults ||
		cfg.Search.UserAgent != userAgent ||
		cfg.Search.Provider != provider ||
		cfg.Search.Brave.APIKey != braveKey ||
		cfg.Search.Brave.Endpoint != braveEndpoint {
		t.Fatalf("search overrides were not applied: %#v", cfg.Search)
	}
	if cfg.WebApp.RateLimit.RequestsPerMinute != requestsMinute ||
		cfg.WebApp.RateLimit.RequestsPerHour != requestsHour ||
		cfg.WebApp.RateLimit.MaxConcurrentRequests != maxConcurrent {
		t.Fatalf("rate limit overrides were not applied: %#v", cfg.WebApp.RateLimit)
	}
	if len(cfg.CORS.AllowedOrigins) != 1 || cfg.CORS.AllowedOrigins[0] != "https://app.example" {
		t.Fatalf("cors overrides were not applied: %#v", cfg.CORS)
	}
}

func TestApplyEnginecoreOverridesNilSections(t *testing.T) {
	cfg := Config{
		Gateway: GatewayConfig{APIKey: "keep"},
		Search:  SearchConfig{Provider: "keep"},
	}
	tf := &enginecoreconfig.TaskForceAIConfig{
		Gateway:      &enginecoreconfig.TaskForceAIGatewayConfig{},
		Models:       &enginecoreconfig.TaskForceAIModelsConfig{},
		Agent:        &enginecoreconfig.TaskForceAIAgentConfig{},
		Orchestrator: &enginecoreconfig.TaskForceAIOrchestratorConfig{},
		Search:       &enginecoreconfig.TaskForceAISearchConfig{},
		WebApp:       &enginecoreconfig.TaskForceAIWebAppConfig{},
		CORS:         &enginecoreconfig.TaskForceAICORSConfig{},
	}
	applyEnginecoreGateway(&cfg, tf)
	applyEnginecoreModels(&cfg, tf)
	applyEnginecoreAgent(&cfg, tf)
	applyEnginecoreOrchestrator(&cfg, tf)
	applyEnginecoreSearch(&cfg, tf)
	applyEnginecoreWebApp(&cfg, tf)
	applyEnginecoreCORS(&cfg, tf)
	if cfg.Gateway.APIKey != "keep" || cfg.Search.Provider != "keep" {
		t.Fatalf("nil fields should preserve existing values: %#v", cfg)
	}
}

func TestConfigLoaderCoverageGapPaths(t *testing.T) {
	resetLoadConfigCacheForTest()
	t.Cleanup(resetLoadConfigCacheForTest)

	t.Run("json marshal failure during load", func(t *testing.T) {
		origMarshal := jsonMarshal
		jsonMarshal = func(any) ([]byte, error) { return nil, errors.New("marshal failed") }
		t.Cleanup(func() { jsonMarshal = origMarshal })

		dir := t.TempDir()
		cfgPath := filepath.Join(dir, "config.yaml")
		if err := os.WriteFile(cfgPath, []byte("gateway:\n  model: test\n"), 0o600); err != nil {
			t.Fatalf("write config: %v", err)
		}
		_, err := LoadConfig(cfgPath)
		if err == nil || !strings.Contains(err.Error(), "marshal failed") {
			t.Fatalf("expected marshal failure, got %v", err)
		}
	})

	t.Run("gateway api key env override applies during load", func(t *testing.T) {
		dir := t.TempDir()
		cfgPath := filepath.Join(dir, "config.yaml")
		if err := os.WriteFile(cfgPath, []byte("gateway:\n  model: test\n"), 0o600); err != nil {
			t.Fatalf("write config: %v", err)
		}
		t.Setenv("AI_GATEWAY_API_KEY", "secret-key")
		cfg, err := LoadConfig(cfgPath)
		if err != nil {
			t.Fatalf("load config: %v", err)
		}
		if cfg.Gateway.APIKey != "secret-key" {
			t.Fatalf("expected gateway api key override, got %q", cfg.Gateway.APIKey)
		}
	})

	t.Run("load prompt overrides reads provider values", func(t *testing.T) {
		resetPromptOverrideProviderForTest(t)
		SetPromptOverrideProvider(&testPromptOverrideProvider{
			system: "system override",
			models: map[string]string{"model-a": "model prompt"},
		})
		cfg := Config{
			Models: ModelsConfig{
				Options: []ModelOption{{ID: "model-a"}},
			},
		}
		loadPromptOverrides(&cfg)
		if cfg.SystemPrompt != "system override" {
			t.Fatalf("expected system prompt override, got %q", cfg.SystemPrompt)
		}
		if len(cfg.Models.Options) != 1 || cfg.Models.Options[0].SystemPrompt != "model prompt" {
			t.Fatalf("expected model prompt override, got %#v", cfg.Models.Options)
		}
	})

	t.Run("apply enginecore helper branches", func(t *testing.T) {
		temp := 0.2
		parallel := 3
		timeout := 45
		strategy := "consensus"
		questionPrompt := "question"
		synthesisPrompt := "synthesis"
		maxResults := 7
		userAgent := "ua"
		provider := "brave"
		braveKey := "key"
		braveEndpoint := "endpoint"
		rpm := 10
		rph := 100
		maxConcurrent := 5
		allowedOrigins := []string{"https://example.com"}

		cfg := Config{}
		tf := &enginecoreconfig.TaskForceAIConfig{
			Gateway: &enginecoreconfig.TaskForceAIGatewayConfig{
				APIKey:         new("api"),
				BaseURL:        new("base"),
				Model:          new("model"),
				DefaultHeaders: map[string]string{"x-test": "1"},
			},
			Models: &enginecoreconfig.TaskForceAIModelsConfig{
				Default: new("default-model"),
				Options: []enginecoreconfig.TaskForceAIModelOption{{
					ID:                  "model-a",
					Label:               "label",
					Description:         "desc",
					UsageMultiple:       new(1.5),
					BaseURL:             "https://model.example",
					SystemPrompt:        "prompt",
					SystemPromptVersion: "v1",
				}},
			},
			Agent: &enginecoreconfig.TaskForceAIAgentConfig{
				MaxIterations: new(9),
				Temperature:   &temp,
			},
			Orchestrator: &enginecoreconfig.TaskForceAIOrchestratorConfig{
				ParallelAgents:           &parallel,
				TaskTimeout:              &timeout,
				AggregationStrategy:      &strategy,
				QuestionGenerationPrompt: &questionPrompt,
				SynthesisPrompt:          &synthesisPrompt,
			},
			Search: &enginecoreconfig.TaskForceAISearchConfig{
				MaxResults: &maxResults,
				UserAgent:  &userAgent,
				Provider:   &provider,
				Brave: &enginecoreconfig.TaskForceAIBraveConfig{
					APIKey:   &braveKey,
					Endpoint: &braveEndpoint,
				},
			},
			WebApp: &enginecoreconfig.TaskForceAIWebAppConfig{
				RateLimit: &enginecoreconfig.TaskForceAIRateLimitConfig{
					RequestsPerMinute:     &rpm,
					RequestsPerHour:       &rph,
					MaxConcurrentRequests: &maxConcurrent,
				},
			},
			CORS: &enginecoreconfig.TaskForceAICORSConfig{
				AllowedOrigins: allowedOrigins,
			},
		}

		applyEnginecoreGateway(&cfg, tf)
		applyEnginecoreModels(&cfg, tf)
		applyEnginecoreAgent(&cfg, tf)
		applyEnginecoreOrchestrator(&cfg, tf)
		applyEnginecoreSearch(&cfg, tf)
		applyEnginecoreWebApp(&cfg, tf)
		applyEnginecoreCORS(&cfg, tf)

		if cfg.Gateway.APIKey != "api" || cfg.Gateway.Model != "model" {
			t.Fatalf("unexpected gateway override: %#v", cfg.Gateway)
		}
		if cfg.Models.Default != "default-model" || len(cfg.Models.Options) != 1 {
			t.Fatalf("unexpected models override: %#v", cfg.Models)
		}
		if cfg.Agent.MaxIterations != 9 || cfg.Agent.Temperature == nil || *cfg.Agent.Temperature != temp {
			t.Fatalf("unexpected agent override: %#v", cfg.Agent)
		}
		if cfg.Orchestrator.ParallelAgents != parallel || cfg.Orchestrator.SynthesisPrompt != synthesisPrompt {
			t.Fatalf("unexpected orchestrator override: %#v", cfg.Orchestrator)
		}
		if cfg.Search.MaxResults != maxResults || cfg.Search.Brave.APIKey != braveKey {
			t.Fatalf("unexpected search override: %#v", cfg.Search)
		}
		if cfg.WebApp.RateLimit.RequestsPerMinute != rpm || cfg.WebApp.RateLimit.MaxConcurrentRequests != maxConcurrent {
			t.Fatalf("unexpected webapp override: %#v", cfg.WebApp.RateLimit)
		}
		if len(cfg.CORS.AllowedOrigins) != 1 || cfg.CORS.AllowedOrigins[0] != allowedOrigins[0] {
			t.Fatalf("unexpected cors override: %#v", cfg.CORS)
		}
	})

	t.Run("prompt override fingerprint is part of cache key", func(t *testing.T) {
		resetLoadConfigCacheForTest()
		resetPromptOverrideProviderForTest(t)
		dir := t.TempDir()
		cfgPath := filepath.Join(dir, "config.yaml")
		if err := os.WriteFile(cfgPath, []byte("gateway:\n  model: test\n"), 0o600); err != nil {
			t.Fatalf("write config: %v", err)
		}
		provider := &testPromptOverrideProvider{system: "first", fingerprint: 1}
		SetPromptOverrideProvider(provider)
		first, err := LoadConfig(cfgPath)
		if err != nil {
			t.Fatalf("load config first: %v", err)
		}
		provider.system = "second"
		secondCached, err := LoadConfig(cfgPath)
		if err != nil {
			t.Fatalf("load config cached: %v", err)
		}
		provider.fingerprint = 2
		secondFresh, err := LoadConfig(cfgPath)
		if err != nil {
			t.Fatalf("load config fresh: %v", err)
		}
		if first.SystemPrompt != "first" || secondCached.SystemPrompt != "first" || secondFresh.SystemPrompt != "second" {
			t.Fatalf("unexpected cached prompt sequence: first=%q cached=%q fresh=%q", first.SystemPrompt, secondCached.SystemPrompt, secondFresh.SystemPrompt)
		}
	})
}

func TestConfigLoaderExtraPushTo95CoverageGapPaths(t *testing.T) {
	resetLoadConfigCacheForTest()
	t.Cleanup(resetLoadConfigCacheForTest)

	t.Run("load prompt overrides applies question generation provider value", func(t *testing.T) {
		resetPromptOverrideProviderForTest(t)
		SetPromptOverrideProvider(&testPromptOverrideProvider{question: "question prompt"})

		cfg := Config{}
		loadPromptOverrides(&cfg)
		if cfg.Orchestrator.QuestionGenerationPrompt != "question prompt" {
			t.Fatalf("expected question prompt override, got %q", cfg.Orchestrator.QuestionGenerationPrompt)
		}
	})
}

func TestConfigLoaderFinalCoverageGapPaths(t *testing.T) {
	resetLoadConfigCacheForTest()
	t.Cleanup(resetLoadConfigCacheForTest)

	t.Run("load config json unmarshal failure", func(t *testing.T) {
		dir := t.TempDir()
		cfgPath := filepath.Join(dir, "config.yaml")
		if err := os.WriteFile(cfgPath, []byte("models:\n  options: not-a-list\n"), 0o600); err != nil {
			t.Fatalf("write config: %v", err)
		}
		_, err := LoadConfig(cfgPath)
		if err == nil || !strings.Contains(err.Error(), "failed to map config to struct") {
			t.Fatalf("expected json unmarshal failure, got %v", err)
		}
	})

	t.Run("load config applies synthesis prompt provider value", func(t *testing.T) {
		resetPromptOverrideProviderForTest(t)
		dir := t.TempDir()
		cfgPath := filepath.Join(dir, "config.yaml")
		if err := os.WriteFile(cfgPath, []byte("gateway:\n  model: test\n"), 0o600); err != nil {
			t.Fatalf("write config: %v", err)
		}
		SetPromptOverrideProvider(&testPromptOverrideProvider{synthesis: "synth", fingerprint: 1})

		cfg, err := LoadConfig(cfgPath)
		if err != nil {
			t.Fatalf("load config: %v", err)
		}
		if cfg.Orchestrator.SynthesisPrompt != "synth" {
			t.Fatalf("expected synthesis prompt override, got %q", cfg.Orchestrator.SynthesisPrompt)
		}
	})

	t.Run("load prompt overrides skips empty model ids", func(t *testing.T) {
		resetPromptOverrideProviderForTest(t)
		SetPromptOverrideProvider(&testPromptOverrideProvider{models: map[string]string{"model-a": "prompt"}})
		cfg := Config{
			Models: ModelsConfig{
				Options: []ModelOption{{ID: ""}, {ID: "model-a"}},
			},
		}
		loadPromptOverrides(&cfg)
		if cfg.Models.Options[0].SystemPrompt != "" || cfg.Models.Options[1].SystemPrompt != "prompt" {
			t.Fatalf("unexpected model prompt overrides: %#v", cfg.Models.Options)
		}
	})

	t.Run("apply enginecore helper nil branches", func(t *testing.T) {
		cfg := Config{}
		empty := &enginecoreconfig.TaskForceAIConfig{}
		applyEnginecoreGateway(&cfg, empty)
		applyEnginecoreModels(&cfg, empty)
		applyEnginecoreAgent(&cfg, empty)
		applyEnginecoreOrchestrator(&cfg, empty)
		applyEnginecoreSearch(&cfg, empty)
		applyEnginecoreWebApp(&cfg, empty)
		applyEnginecoreCORS(&cfg, empty)

		searchOnly := &enginecoreconfig.TaskForceAIConfig{
			Search: &enginecoreconfig.TaskForceAISearchConfig{},
		}
		applyEnginecoreSearch(&cfg, searchOnly)
	})

	t.Run("load prompt overrides returns early when provider is empty", func(t *testing.T) {
		resetPromptOverrideProviderForTest(t)

		cfg := Config{}
		loadPromptOverrides(&cfg)
		if cfg.SystemPrompt != "" {
			t.Fatalf("expected empty system prompt, got %q", cfg.SystemPrompt)
		}
	})
}

func TestConfigLoaderHelperGapCoverage(t *testing.T) {
	t.Run("env overrides fingerprint includes model base url env vars", func(t *testing.T) {
		t.Setenv("MODEL_BASE_URL_TEST_MODEL", "https://one.example")
		first := envOverridesFingerprint()
		t.Setenv("MODEL_BASE_URL_TEST_MODEL", "https://two.example")
		second := envOverridesFingerprint()
		if first == second {
			t.Fatal("expected fingerprint to change when model base url env changes")
		}
	})

	t.Run("prompt override provider reset restores empty provider", func(t *testing.T) {
		restore := SetPromptOverrideProvider(&testPromptOverrideProvider{system: "system", fingerprint: 1})
		if got := currentPromptOverrideProvider().SystemPromptOverride(); got != "system" {
			t.Fatalf("expected provider system prompt, got %q", got)
		}
		restore()
		if got := currentPromptOverrideProvider().SystemPromptOverride(); got != "" {
			t.Fatalf("expected restored empty provider, got %q", got)
		}
	})

	t.Run("load config propagates enginecore override errors", func(t *testing.T) {
		resetLoadConfigCacheForTest()
		origGet := getEnginecoreConfig
		getEnginecoreConfig = func() (*enginecoreconfig.Info, error) {
			return nil, errors.New("enginecore failed")
		}
		t.Cleanup(func() {
			getEnginecoreConfig = origGet
			resetLoadConfigCacheForTest()
		})

		dir := t.TempDir()
		cfgPath := filepath.Join(dir, "config.yaml")
		if err := os.WriteFile(cfgPath, []byte("gateway:\n  model: test\n"), 0o600); err != nil {
			t.Fatalf("write config: %v", err)
		}
		_, err := LoadConfig(cfgPath)
		if err == nil || !strings.Contains(err.Error(), "load enginecore config") {
			t.Fatalf("expected enginecore override error, got %v", err)
		}
	})

	t.Run("nil prompt override provider normalizes to empty provider", func(t *testing.T) {
		restore := SetPromptOverrideProvider(nil)
		defer restore()
		if currentPromptOverrideProvider().PromptOverridesFingerprint() != 0 {
			t.Fatal("expected empty provider fingerprint")
		}
	})
}
