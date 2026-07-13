package config

import "testing"

func TestResolveSystemPrompt_ModelSpecificWins(t *testing.T) {
	cfg := Config{
		Gateway:      GatewayConfig{Model: "model-a"},
		SystemPrompt: "global",
		Models: ModelsConfig{
			Options: []ModelOption{
				{ID: "model-a", SystemPrompt: "model-specific"},
			},
		},
	}

	got := cfg.ResolveSystemPrompt("model-a")
	if got != "model-specific" {
		t.Fatalf("expected model-specific prompt, got %q", got)
	}
}

func TestResolveSystemPrompt_FallbackGlobal(t *testing.T) {
	cfg := Config{
		Gateway:      GatewayConfig{Model: "model-a"},
		SystemPrompt: "global",
	}
	got := cfg.ResolveSystemPrompt("model-a")
	if got != "global" {
		t.Fatalf("expected global prompt, got %q", got)
	}
}

func TestResolveSystemPrompt_DefaultModel(t *testing.T) {
	cfg := Config{
		Models: ModelsConfig{
			Default: "model-a",
			Options: []ModelOption{
				{ID: "model-a", SystemPrompt: "model-default"},
			},
		},
		SystemPrompt: "global",
	}

	got := cfg.ResolveSystemPrompt("")
	if got != "model-default" {
		t.Fatalf("expected default model prompt, got %q", got)
	}
}
