package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	enginecoreconfig "github.com/TaskForceAI/core/pkg/enginecore/config"
)

func TestConfigLoaderJSONUnmarshalDirect(t *testing.T) {
	var cfg Config
	if err := json.Unmarshal([]byte(`{"models":{"options":"bad"}}`), &cfg); err == nil {
		t.Fatal("expected direct json unmarshal failure")
	}
}

func TestConfigLoaderPushTo95CoverageGapPaths(t *testing.T) {
	resetLoadConfigCacheForTest()
	t.Cleanup(resetLoadConfigCacheForTest)

	t.Run("load prompt overrides applies provider values", func(t *testing.T) {
		resetPromptOverrideProviderForTest(t)
		SetPromptOverrideProvider(&testPromptOverrideProvider{
			system:    " system ",
			question:  " question ",
			synthesis: " synthesis ",
			models:    map[string]string{"model-a": " model prompt "},
		})

		cfg := Config{Models: ModelsConfig{Options: []ModelOption{{ID: ""}, {ID: "model-a"}}}}
		loadPromptOverrides(&cfg)
		if cfg.SystemPrompt != "system" || cfg.Orchestrator.QuestionGenerationPrompt != "question" || cfg.Orchestrator.SynthesisPrompt != "synthesis" {
			t.Fatalf("unexpected prompt overrides: %#v", cfg)
		}
		if got := cfg.Models.Options[1].SystemPrompt; got != "model prompt" {
			t.Fatalf("expected model prompt override, got %q", got)
		}
	})
}

func TestLoadConfig(t *testing.T) {
	resetLoadConfigCacheForTest()
	t.Cleanup(resetLoadConfigCacheForTest)

	yamlContent := `
gateway:
  model: test-model
  api_key: yaml-key
`
	tmpFile, err := os.CreateTemp("", "config-*.yaml")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = os.Remove(tmpFile.Name()) }()

	if _, err := tmpFile.WriteString(yamlContent); err != nil {
		t.Fatal(err)
	}
	_ = tmpFile.Close()

	t.Run("Load valid config", func(t *testing.T) {
		cfg, err := LoadConfig(tmpFile.Name())
		if err != nil {
			t.Fatalf("failed to load config: %v", err)
		}
		if cfg.Gateway.Model != "test-model" {
			t.Errorf("expected test-model, got %s", cfg.Gateway.Model)
		}
		if cfg.Gateway.APIKey != "yaml-key" {
			t.Errorf("expected yaml-key, got %s", cfg.Gateway.APIKey)
		}
	})

	t.Run("Cache hit", func(t *testing.T) {
		// First load populates cache
		cfg1, err := LoadConfig(tmpFile.Name())
		if err != nil {
			t.Fatalf("first load failed: %v", err)
		}

		// Second load should hit cache
		cfg2, err := LoadConfig(tmpFile.Name())
		if err != nil {
			t.Fatalf("second load failed: %v", err)
		}

		if cfg1.Gateway.Model != cfg2.Gateway.Model {
			t.Errorf("cache returned different config")
		}
	})

	t.Run("Environment override", func(t *testing.T) {
		// Create another config with empty apiKey
		yaml2 := "gateway:\n  model: model2\n"
		f2, _ := os.CreateTemp("", "config2-*.yaml")
		defer func() { _ = os.Remove(f2.Name()) }()
		_, _ = f2.WriteString(yaml2)
		_ = f2.Close()

		_ = os.Setenv("AI_GATEWAY_API_KEY", "env-key")
		defer func() { _ = os.Unsetenv("AI_GATEWAY_API_KEY") }()

		cfg, _ := LoadConfig(f2.Name())
		if cfg.Gateway.APIKey != "env-key" {
			t.Errorf("expected env-key override, got %s", cfg.Gateway.APIKey)
		}
	})

	t.Run("Environment override cache invalidates when env changes", func(t *testing.T) {
		resetLoadConfigCacheForTest()

		yaml := "gateway:\n  model: model3\n"
		f, err := os.CreateTemp("", "config3-*.yaml")
		if err != nil {
			t.Fatalf("create temp config: %v", err)
		}
		defer func() { _ = os.Remove(f.Name()) }()
		if _, err := f.WriteString(yaml); err != nil {
			t.Fatalf("write temp config: %v", err)
		}
		_ = f.Close()

		t.Setenv("AI_GATEWAY_API_KEY", "first-key")
		first, err := LoadConfig(f.Name())
		if err != nil {
			t.Fatalf("first load failed: %v", err)
		}
		if first.Gateway.APIKey != "first-key" {
			t.Fatalf("expected first-key, got %q", first.Gateway.APIKey)
		}

		t.Setenv("AI_GATEWAY_API_KEY", "second-key")
		second, err := LoadConfig(f.Name())
		if err != nil {
			t.Fatalf("second load failed: %v", err)
		}
		if second.Gateway.APIKey != "second-key" {
			t.Fatalf("expected second-key after env change, got %q", second.Gateway.APIKey)
		}
	})

	t.Run("Prompt overrides", func(t *testing.T) {
		resetPromptOverrideProviderForTest(t)
		dir := t.TempDir()
		cfgPath := dir + "/config.yaml"
		if err := os.WriteFile(cfgPath, []byte("gateway:\n  model: model-a\nmodels:\n  options:\n    - id: model-a\n"), 0o600); err != nil {
			t.Fatalf("write config: %v", err)
		}
		SetPromptOverrideProvider(&testPromptOverrideProvider{
			system:    "base",
			question:  "qgen",
			synthesis: "synth",
			models:    map[string]string{"model-a": "model-specific"},
		})

		cfg, err := LoadConfig(cfgPath)
		if err != nil {
			t.Fatalf("load config: %v", err)
		}
		if cfg.SystemPrompt != "base" {
			t.Fatalf("expected base prompt, got %q", cfg.SystemPrompt)
		}
		if len(cfg.Models.Options) == 0 || cfg.Models.Options[0].SystemPrompt != "model-specific" {
			t.Fatalf("expected model-specific prompt, got %q", cfg.Models.Options[0].SystemPrompt)
		}
		if cfg.Orchestrator.QuestionGenerationPrompt != "qgen" {
			t.Fatalf("expected question generation prompt, got %q", cfg.Orchestrator.QuestionGenerationPrompt)
		}
		if cfg.Orchestrator.SynthesisPrompt != "synth" {
			t.Fatalf("expected synthesis prompt, got %q", cfg.Orchestrator.SynthesisPrompt)
		}
	})

	t.Run("Prompt override cache invalidates when prompt file content changes", func(t *testing.T) {
		resetLoadConfigCacheForTest()
		resetPromptOverrideProviderForTest(t)

		dir := t.TempDir()
		cfgPath := dir + "/config.yaml"
		if err := os.WriteFile(cfgPath, []byte("gateway:\n  model: model-a\n"), 0o600); err != nil {
			t.Fatalf("write config: %v", err)
		}
		provider := &testPromptOverrideProvider{system: "first prompt", fingerprint: 1}
		SetPromptOverrideProvider(provider)

		first, err := LoadConfig(cfgPath)
		if err != nil {
			t.Fatalf("first load config: %v", err)
		}
		if first.SystemPrompt != "first prompt" {
			t.Fatalf("expected first prompt, got %q", first.SystemPrompt)
		}

		provider.system = "second prompt"
		provider.fingerprint = 2

		second, err := LoadConfig(cfgPath)
		if err != nil {
			t.Fatalf("second load config: %v", err)
		}
		if second.SystemPrompt != "second prompt" {
			t.Fatalf("expected second prompt after prompt update, got %q", second.SystemPrompt)
		}
	})

	t.Run("Missing file", func(t *testing.T) {
		_, err := LoadConfig("non-existent.yaml")
		if err == nil {
			t.Errorf("expected error for non-existent file")
		}
	})

	t.Run("Invalid YAML", func(t *testing.T) {
		invalidYaml := "invalid: yaml: content: [["
		f, _ := os.CreateTemp("", "invalid-*.yaml")
		defer func() { _ = os.Remove(f.Name()) }()
		_, _ = f.WriteString(invalidYaml)
		_ = f.Close()

		_, err := LoadConfig(f.Name())
		if err == nil {
			t.Errorf("expected error for invalid YAML")
		}
	})

	t.Run("Empty path uses default", func(t *testing.T) {
		// This will fail because config/config.yaml doesn't exist
		// but it exercises the default path logic
		_, err := LoadConfig("")
		if err == nil {
			// If it succeeds, the default config exists
			t.Log("default config exists")
		} else {
			// Expected - default config doesn't exist
			t.Log("default config doesn't exist (expected)")
		}
	})
}

func TestLoadConfigAppliesEnginecoreOverridesFromEnvironment(t *testing.T) {
	resetLoadConfigCacheForTest()
	enginecoreconfig.Reset()
	t.Cleanup(func() {
		resetLoadConfigCacheForTest()
		enginecoreconfig.Reset()
	})

	dir := t.TempDir()
	cfgPath := dir + "/config.yaml"
	if err := os.WriteFile(cfgPath, []byte(`
gateway:
  model: yaml-model
models:
  default: yaml-default
search:
  provider: yaml-search
`), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	restoreConfigSource := enginecoreconfig.SetConfigSource(testEnginecoreConfigSource{
		snapshot: enginecoreconfig.ConfigSnapshot{
			InlineContent: []byte(`{
  "taskforceai": {
    "gateway": {
      "api_key": "core-key",
      "base_url": "https://gateway.example",
      "model": "core-model",
      "default_headers": {"x-core": "true"}
    },
    "models": {
      "default": "core-default",
      "options": [{"id": "model-a", "label": "Model A", "base_url": "https://model.example"}]
    },
    "agent": {"max_iterations": 9, "temperature": 0.4},
    "orchestrator": {
      "parallel_agents": 3,
      "task_timeout": 90,
      "aggregation_strategy": "consensus",
      "question_generation_prompt": "questions",
      "synthesis_prompt": "synthesis"
    },
    "search": {
      "max_results": 12,
      "user_agent": "TaskForceAI",
      "provider": "brave",
      "brave": {"api_key": "brave", "endpoint": "https://search.example"}
    },
    "web_app": {"rate_limit": {"requests_per_minute": 11, "requests_per_hour": 22, "max_concurrent_requests": 2}},
    "cors": {"allowed_origins": ["https://app.example"]}
  }
}`),
		},
	})
	t.Cleanup(restoreConfigSource)

	cfg, err := LoadConfig(cfgPath)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.Gateway.Model != "core-model" || cfg.Gateway.APIKey != "core-key" {
		t.Fatalf("expected enginecore gateway overrides, got %#v", cfg.Gateway)
	}
	if cfg.Models.Default != "core-default" || len(cfg.Models.Options) != 1 {
		t.Fatalf("expected enginecore model overrides, got %#v", cfg.Models)
	}
	if cfg.Agent.MaxIterations != 9 || cfg.Agent.Temperature == nil || *cfg.Agent.Temperature != 0.4 {
		t.Fatalf("expected enginecore agent overrides, got %#v", cfg.Agent)
	}
	if cfg.Search.Brave.APIKey != "brave" || cfg.CORS.AllowedOrigins[0] != "https://app.example" {
		t.Fatalf("expected enginecore search/cors overrides, got %#v %#v", cfg.Search, cfg.CORS)
	}
}

func TestLoadConfigGapCoverage(t *testing.T) {
	resetLoadConfigCacheForTest()
	t.Cleanup(resetLoadConfigCacheForTest)

	t.Run("filepath abs failure", func(t *testing.T) {
		orig := filepathAbs
		filepathAbs = func(string) (string, error) { return "", errors.New("abs failed") }
		t.Cleanup(func() { filepathAbs = orig })

		_, err := LoadConfig("config.yaml")
		if err == nil || !strings.Contains(err.Error(), "abs failed") {
			t.Fatalf("expected abs failure, got %v", err)
		}
	})

	t.Run("read file failure for explicit config path", func(t *testing.T) {
		origAbs := filepathAbs
		origRead := osReadFile
		origStat := osStat
		filepathAbs = func(path string) (string, error) { return path, nil }
		osStat = func(string) (os.FileInfo, error) {
			return fakeFileInfo{mod: 123}, nil
		}
		osReadFile = func(string) ([]byte, error) { return nil, errors.New("read failed") }
		t.Cleanup(func() {
			filepathAbs = origAbs
			osReadFile = origRead
			osStat = origStat
		})

		_, err := LoadConfig("/tmp/explicit-config.yaml")
		if err == nil || !strings.Contains(err.Error(), "read failed") {
			t.Fatalf("expected read failure, got %v", err)
		}
	})

	t.Run("model base url env override", func(t *testing.T) {
		dir := t.TempDir()
		cfgPath := filepath.Join(dir, "config.yaml")
		if err := os.WriteFile(cfgPath, []byte(`
models:
  options:
    - id: test/model
      label: Test Model
`), 0o600); err != nil {
			t.Fatalf("write config: %v", err)
		}

		t.Setenv("MODEL_BASE_URL_TEST_MODEL", "https://override.example")
		cfg, err := LoadConfig(cfgPath)
		if err != nil {
			t.Fatalf("load config: %v", err)
		}
		if len(cfg.Models.Options) != 1 || cfg.Models.Options[0].BaseURL != "https://override.example" {
			t.Fatalf("expected model base url override, got %#v", cfg.Models.Options)
		}
	})

	t.Run("nil prompt override provider is ignored", func(t *testing.T) {
		cfg := Config{SystemPrompt: "fallback"}
		applyPromptOverrides(&cfg, nil)
		if cfg.SystemPrompt != "fallback" {
			t.Fatalf("expected fallback prompt to remain, got %q", cfg.SystemPrompt)
		}
	})
}
