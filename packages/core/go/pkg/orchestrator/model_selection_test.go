package orchestrator

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	coreconfig "github.com/TaskForceAI/core/pkg/config"
)

func TestComputeModelLabel(t *testing.T) {
	label := computeModelLabel("openai/gpt-5.6-sol")
	assert.Equal(t, "Gpt 5.6 Sol", label)
}

func TestModelNameWithoutProvider(t *testing.T) {
	assert.Equal(t, "gpt-5.6-sol", modelName("gpt-5.6-sol"))
}

func TestComputeModelLabel_PreservesSeparatorSpacing(t *testing.T) {
	label := computeModelLabel("provider/-very--long-")
	assert.Equal(t, " Very  Long ", label)
}

func TestComputeModelBadge(t *testing.T) {
	badge := computeModelBadge("openai/gpt-5.6-sol")
	assert.Equal(t, "GPT-5.6-SOL HEAVY", badge)
}

func TestComputeModelBadge_TruncatesLongNames(t *testing.T) {
	badge := computeModelBadge("provider/very-long-model-name-extra")
	assert.Equal(t, "VERY-LONG-MODEL HEAVY", badge)
}

func TestEnrichModel_Defaults(t *testing.T) {
	opt := enrichModel(coreconfig.ModelOption{
		ID:          "openai/gpt-5.6-sol",
		Description: "fast model",
	})
	assert.Equal(t, "Gpt 5.6 Sol", opt.Label)
	assert.Equal(t, "GPT-5.6-SOL HEAVY", opt.Badge)
	assert.Equal(t, "fast model", opt.Description)
}

func TestEnrichModel_UsageMultiple(t *testing.T) {
	usageMultiple := 2.5
	opt := enrichModel(coreconfig.ModelOption{
		ID:            "openai/gpt-5.6-sol",
		UsageMultiple: &usageMultiple,
	})
	assert.Equal(t, 2.5, opt.UsageMultiple)
}

func TestResolveModelSelection_DefaultModel(t *testing.T) {
	cfg := coreconfig.Config{
		Gateway: coreconfig.GatewayConfig{},
		Models: coreconfig.ModelsConfig{
			Default: "openai/gpt-5.6-sol",
			Options: []coreconfig.ModelOption{
				{ID: "openai/gpt-5.6-sol", Description: "fast"},
				{ID: "openai/gpt-5.1", Label: "GPT-5.1"},
			},
		},
	}

	result, err := ResolveModelSelection(cfg, "")
	require.NoError(t, err)
	assert.Equal(t, "openai/gpt-5.6-sol", result.SelectedModel.ID)
	assert.Equal(t, "openai/gpt-5.6-sol", result.Config.Gateway.Model)
	assert.True(t, result.SelectorEnabled)
	assert.Len(t, result.Options, 2)
}

func TestResolveModelSelection_RequestedModel(t *testing.T) {
	cfg := coreconfig.Config{
		Models: coreconfig.ModelsConfig{
			Default: "openai/gpt-5.6-sol",
			Options: []coreconfig.ModelOption{
				{ID: "openai/gpt-5.6-sol"},
				{ID: "openai/gpt-5.1"},
			},
		},
	}

	result, err := ResolveModelSelection(cfg, "openai/gpt-5.1")
	require.NoError(t, err)
	assert.Equal(t, "openai/gpt-5.1", result.SelectedModel.ID)
	assert.Equal(t, "openai/gpt-5.1", result.Config.Gateway.Model)
}

func TestResolveModelSelection_AppliesSystemPromptOverride(t *testing.T) {
	cfg := coreconfig.Config{
		Models: coreconfig.ModelsConfig{
			Default: "openai/gpt-5.6-sol",
			Options: []coreconfig.ModelOption{
				{ID: "openai/gpt-5.6-sol", SystemPrompt: "model-specific prompt"},
			},
		},
	}

	result, err := ResolveModelSelection(cfg, "")
	require.NoError(t, err)
	assert.Equal(t, "model-specific prompt", result.Config.SystemPrompt)
}

func TestResolveModelSelection_NoModelsConfigured(t *testing.T) {
	_, err := ResolveModelSelection(coreconfig.Config{}, "")
	assert.ErrorIs(t, err, ErrNoModelsConfigured)
}

func TestResolveModelSelection_NoConfiguredModelsRejectsRequestedModel(t *testing.T) {
	_, err := ResolveModelSelection(coreconfig.Config{}, "zai/glm-5.2")
	assert.ErrorIs(t, err, ErrNoModelsConfigured)
}

func TestResolveModelSelection_UsesFirstOptionWhenDefaultMissing(t *testing.T) {
	cfg := coreconfig.Config{
		Models: coreconfig.ModelsConfig{
			Options: []coreconfig.ModelOption{
				{ID: "openai/gpt-5.6-sol"},
				{ID: "openai/gpt-5.1"},
			},
		},
	}

	result, err := ResolveModelSelection(cfg, "")
	require.NoError(t, err)
	assert.Equal(t, "openai/gpt-5.6-sol", result.SelectedModel.ID)
	assert.Equal(t, "openai/gpt-5.6-sol", result.Config.Gateway.Model)
}

func TestResolveModelSelection_UnknownModel(t *testing.T) {
	cfg := coreconfig.Config{
		Models: coreconfig.ModelsConfig{
			Default: "openai/gpt-5.6-sol",
			Options: []coreconfig.ModelOption{
				{ID: "openai/gpt-5.6-sol"},
			},
		},
	}

	_, err := ResolveModelSelection(cfg, "openai/gpt-5.1")
	var unknown ErrUnknownModel
	require.ErrorAs(t, err, &unknown)
	assert.Equal(t, "openai/gpt-5.1", unknown.ModelID)
	assert.Contains(t, err.Error(), "unknown model requested")
}

func BenchmarkResolveModelSelection(b *testing.B) {
	cfg := coreconfig.Config{
		Models: coreconfig.ModelsConfig{
			Default: "openai/gpt-5.6-sol",
			Options: []coreconfig.ModelOption{
				{ID: "openai/gpt-5.6-sol", Description: "frontier reasoning"},
				{ID: "openai/gpt-5.1", Description: "balanced reasoning"},
				{ID: "anthropic/claude-sonnet-5", Description: "coding"},
				{ID: "google/gemini-3.0-pro", Description: "multimodal"},
				{ID: "zai/glm-5.2", Description: "long context"},
				{ID: "xai/grok-5-heavy", Description: "search"},
			},
		},
	}

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		result, err := ResolveModelSelection(cfg, "openai/gpt-5.1")
		if err != nil {
			b.Fatal(err)
		}
		if result.SelectedModel.ID != "openai/gpt-5.1" {
			b.Fatalf("unexpected model: %s", result.SelectedModel.ID)
		}
	}
}
