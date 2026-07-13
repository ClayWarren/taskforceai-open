package config

import (
	"errors"
	"testing"
)

func TestEmptyConfigLoaderSourceAndOverrides(t *testing.T) {
	source := emptyConfigLoaderSource{}
	if _, err := source.LocateConfigDocument(ConfigLoadRequest{Path: "config.yaml"}); !errors.Is(err, ErrConfigLoaderSourceUnavailable) {
		t.Fatalf("expected unavailable error for explicit path, got %v", err)
	}

	embedded := []byte("gateway:\n  model: test\n")
	doc, err := source.LocateConfigDocument(ConfigLoadRequest{EmbeddedDefault: embedded})
	if err != nil {
		t.Fatalf("expected embedded default document, got %v", err)
	}
	embedded[0] = 'x'
	if string(doc.Data) != "gateway:\n  model: test\n" || !doc.HasData || doc.CacheKey == "" {
		t.Fatalf("unexpected embedded document: %#v", doc)
	}

	if _, err := source.ReadConfigDocument(doc); !errors.Is(err, ErrConfigLoaderSourceUnavailable) {
		t.Fatalf("expected read unavailable error, got %v", err)
	}
	overrides := source.EnvironmentOverrides()
	if overrides.Fingerprint() != 0 || overrides.GatewayAPIKey() != "" || overrides.ModelBaseURL("model") != "" {
		t.Fatalf("expected empty overrides, got %#v", overrides)
	}
}

func TestConfigLoaderNilGlobalFallbacks(t *testing.T) {
	resetPromptOverrideProviderForTest(t)
	restoreSource := SetConfigLoaderSource(testConfigLoaderSource{})
	t.Cleanup(restoreSource)

	restorePrompt := SetPromptOverrideProvider(nil)
	if currentPromptOverrideProvider().PromptOverridesFingerprint() != 0 {
		t.Fatal("nil prompt provider should install empty provider")
	}
	restorePrompt()

	restoreConfig := SetConfigLoaderSource(nil)
	if _, err := currentConfigLoaderSource().LocateConfigDocument(ConfigLoadRequest{Path: "missing.yaml"}); !errors.Is(err, ErrConfigLoaderSourceUnavailable) {
		t.Fatalf("nil config source should install empty source, got %v", err)
	}
	restoreConfig()
}

type nilEnvConfigLoaderSource struct {
	document ConfigDocument
}

func (s nilEnvConfigLoaderSource) LocateConfigDocument(ConfigLoadRequest) (ConfigDocument, error) {
	return s.document, nil
}

func (s nilEnvConfigLoaderSource) ReadConfigDocument(ConfigDocument) ([]byte, error) {
	return []byte("models:\n  options:\n    - id: model-a\n"), nil
}

func (s nilEnvConfigLoaderSource) EnvironmentOverrides() ConfigEnvironmentOverrides {
	return nil
}

func TestLoadConfigNilEnvironmentOverridesAndReadDocument(t *testing.T) {
	resetLoadConfigCacheForTest()
	t.Cleanup(resetLoadConfigCacheForTest)
	restoreSource := SetConfigLoaderSource(nilEnvConfigLoaderSource{document: ConfigDocument{
		Name:     "memory://config",
		CacheKey: "memory://config",
		HasData:  false,
		ModTime:  1,
	}})
	t.Cleanup(restoreSource)

	cfg, err := LoadConfig("")
	if err != nil {
		t.Fatalf("expected config to load via source read, got %v", err)
	}
	if len(cfg.Models.Options) != 1 || cfg.Models.Options[0].ID != "model-a" {
		t.Fatalf("unexpected loaded config: %#v", cfg.Models.Options)
	}
}

func TestLoadConfigUsesDocumentNameWhenCacheKeyMissing(t *testing.T) {
	resetLoadConfigCacheForTest()
	t.Cleanup(resetLoadConfigCacheForTest)
	restoreSource := SetConfigLoaderSource(nilEnvConfigLoaderSource{document: ConfigDocument{
		Name:    "memory://name-only",
		HasData: true,
		Data:    []byte("gateway:\n  model: named-cache\n"),
		ModTime: 2,
	}})
	t.Cleanup(restoreSource)

	cfg, err := LoadConfig("")
	if err != nil {
		t.Fatalf("expected config to load with name cache key, got %v", err)
	}
	if cfg.Gateway.Model != "named-cache" {
		t.Fatalf("unexpected gateway model: %q", cfg.Gateway.Model)
	}
}
