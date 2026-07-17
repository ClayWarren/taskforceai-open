package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadPrecedenceFileEnvContent(t *testing.T) {
	dir := t.TempDir()
	writeJSONFile(t, filepath.Join(dir, "config.json"), map[string]any{
		"instructions": []string{"from-config"},
		"permission": map[string]any{
			"read":  "allow",
			"write": "deny",
		},
		"provider": map[string]any{
			"openai": map[string]any{
				"options": map[string]any{
					"region": "config",
					"nested": map[string]any{
						"configOnly": "from-config",
					},
				},
			},
		},
	})
	writeJSONFile(t, filepath.Join(dir, "taskforceai.json"), map[string]any{
		"instructions": []string{"from-taskforceai"},
		"permission": map[string]any{
			"write": "allow",
			"exec":  "deny",
		},
		"provider": map[string]any{
			"openai": map[string]any{
				"options": map[string]any{
					"region":   "taskforceai",
					"taskOnly": true,
				},
			},
		},
	})

	t.Setenv("TASKFORCEAI_CORE_CONFIG", "")
	t.Setenv("TASKFORCEAI_CORE_CONFIG_DIR", dir)
	t.Setenv("TASKFORCEAI_CORE_CONFIG_CONTENT", `{
  "instructions": ["from-content"],
  "permission": {"exec":"allow","net":"deny"},
  "provider": {
    "openai": {
      "options": {
        "region":"content",
        "nested":{"contentOnly":"from-content"}
      }
    }
  }
}`)
	t.Setenv("TASKFORCEAI_CORE_PERMISSION", `{"net":"allow","write":"deny","exec":{"*":"ask"}}`)

	cfg, err := load()
	require.NoError(t, err, "load should succeed with valid file and env config")
	require.NotNil(t, cfg, "load should return a non-nil config")

	assert.Equal(t, []string{"from-content"}, cfg.Instructions, "content env should override file instructions")
	assert.Equal(t, "allow", cfg.Permission["read"], "config.json-only permission should survive later merges")
	assert.Equal(t, "deny", cfg.Permission["write"], "TASKFORCEAI_CORE_PERMISSION should override file/content write permission")
	assert.Equal(t, "allow", cfg.Permission["net"], "TASKFORCEAI_CORE_PERMISSION should override content permission values")

	execPermission, ok := asAnyMap(cfg.Permission["exec"])
	require.True(t, ok, "exec permission should be a merged map from TASKFORCEAI_CORE_PERMISSION")
	assert.Equal(t, "ask", execPermission["*"], "TASKFORCEAI_CORE_PERMISSION should be applied after content permission")

	openAI, ok := cfg.Provider["openai"]
	require.True(t, ok, "provider.openai should exist")
	assert.Equal(t, "content", openAI.Options["region"], "content should have highest precedence for provider options")
	assert.Equal(t, true, openAI.Options["taskOnly"], "taskforceai.json-only option should be preserved")

	nested, ok := asAnyMap(openAI.Options["nested"])
	require.True(t, ok, "nested provider options should be a map")
	assert.Equal(t, "from-config", nested["configOnly"], "nested map values from config.json should be preserved")
	assert.Equal(t, "from-content", nested["contentOnly"], "nested map values from content should be merged in")
}

func TestMergeAnyMapDeepMergeCloneAliasSafety(t *testing.T) {
	base := AnyMap{
		"nested": AnyMap{
			"keep": "base",
			"arr":  []any{AnyMap{"origin": "base"}},
		},
		"baseOnly": AnyMap{"value": "base"},
	}
	overlay := AnyMap{
		"nested": map[string]any{
			"arr":         []any{AnyMap{"origin": "overlay"}},
			"overlayOnly": "overlay",
		},
		"overlayOnly": AnyMap{"value": "overlay"},
	}

	merged := mergeAnyMap(base, overlay)

	baseNested, ok := asAnyMap(base["nested"])
	require.True(t, ok, "base nested value should be a map")
	baseNested["keep"] = "mutated-base"
	baseArr, ok := baseNested["arr"].([]any)
	require.True(t, ok, "base nested arr should be a slice")
	baseArrEntry, ok := asAnyMap(baseArr[0])
	require.True(t, ok, "base nested arr entry should be a map")
	baseArrEntry["origin"] = "mutated-base-arr"

	overlayNested, ok := asAnyMap(overlay["nested"])
	require.True(t, ok, "overlay nested value should be a map")
	overlayNested["overlayOnly"] = "mutated-overlay"
	overlayArr, ok := overlayNested["arr"].([]any)
	require.True(t, ok, "overlay nested arr should be a slice")
	overlayArrEntry, ok := asAnyMap(overlayArr[0])
	require.True(t, ok, "overlay nested arr entry should be a map")
	overlayArrEntry["origin"] = "mutated-overlay-arr"

	overlayOnly, ok := asAnyMap(overlay["overlayOnly"])
	require.True(t, ok, "overlayOnly should be a map")
	overlayOnly["value"] = "mutated-overlay-only"

	mergedNested, ok := asAnyMap(merged["nested"])
	require.True(t, ok, "merged nested value should be a map")
	assert.Equal(t, "base", mergedNested["keep"], "merged map should not alias base nested map")
	assert.Equal(t, "overlay", mergedNested["overlayOnly"], "overlay value should be merged without later alias mutation")

	mergedArr, ok := mergedNested["arr"].([]any)
	require.True(t, ok, "merged nested arr should be a slice")
	mergedArrEntry, ok := asAnyMap(mergedArr[0])
	require.True(t, ok, "merged nested arr entry should be a map")
	assert.Equal(t, "overlay", mergedArrEntry["origin"], "merged array entry should not alias base/overlay entries")

	mergedOverlayOnly, ok := asAnyMap(merged["overlayOnly"])
	require.True(t, ok, "merged overlayOnly should be a map")
	assert.Equal(t, "overlay", mergedOverlayOnly["value"], "merged map should not alias overlay-only value map")

	mergedNested["keep"] = "mutated-merged"
	mergedArrEntry["origin"] = "mutated-merged-arr"
	mergedOverlayOnly["value"] = "mutated-merged-only"

	assert.Equal(t, "mutated-base", baseNested["keep"], "mutating merged map should not mutate base map")
	assert.Equal(t, "mutated-overlay-arr", overlayArrEntry["origin"], "mutating merged map should not mutate overlay map")
	assert.Equal(t, "mutated-overlay-only", overlayOnly["value"], "mutating merged map should not mutate overlay-only map")
}

func TestCloneInfoDeepCloneAliasSafety(t *testing.T) {
	openTelemetry := true
	batchTool := false
	continueOnDeny := true
	compactionAuto := true
	compactionPrune := false
	original := &Info{
		Tools: map[string]bool{
			"read": true,
		},
		Permission: Permission{
			"default": "ask",
			"paths": AnyMap{
				"tmp": "allow",
			},
		},
		Agent: map[string]Agent{
			"writer": {
				Options: AnyMap{
					"limits": AnyMap{
						"max": 10,
					},
				},
			},
		},
		Provider: map[string]Provider{
			"openai": {
				Options: AnyMap{
					"http": AnyMap{
						"timeout": 30,
					},
				},
			},
		},
		Instructions: []string{"instruction-1"},
		Experimental: &Experimental{
			OpenTelemetry:  &openTelemetry,
			BatchTool:      &batchTool,
			ContinueOnDeny: &continueOnDeny,
			PrimaryTools:   []string{"read", "grep"},
		},
		Compaction: &Compaction{
			Auto:  &compactionAuto,
			Prune: &compactionPrune,
		},
		TaskForceAI: &TaskForceAIConfig{
			Gateway: &TaskForceAIGatewayConfig{
				DefaultHeaders: map[string]string{
					"x-id": "1",
				},
			},
			CORS: &TaskForceAICORSConfig{
				AllowedOrigins: []string{"https://one.example"},
			},
		},
	}

	cloned := cloneInfo(original)

	original.Tools["read"] = false
	originalPaths, ok := asAnyMap(original.Permission["paths"])
	require.True(t, ok, "original permission paths should be a map")
	originalPaths["tmp"] = "mutated-original"

	originalAgent := original.Agent["writer"]
	originalLimits, ok := asAnyMap(originalAgent.Options["limits"])
	require.True(t, ok, "original agent limits should be a map")
	originalLimits["max"] = 99

	originalProvider := original.Provider["openai"]
	originalHTTP, ok := asAnyMap(originalProvider.Options["http"])
	require.True(t, ok, "original provider http options should be a map")
	originalHTTP["timeout"] = 99

	original.Instructions[0] = "instruction-original"
	*original.Experimental.OpenTelemetry = false
	original.Experimental.PrimaryTools[0] = "mutated-original-tool"
	*original.Compaction.Auto = false
	original.TaskForceAI.Gateway.DefaultHeaders["x-id"] = "mutated-original"
	original.TaskForceAI.CORS.AllowedOrigins[0] = "https://original.example"

	assert.True(t, cloned.Tools["read"], "clone should not alias original tools map")
	clonedPaths, ok := asAnyMap(cloned.Permission["paths"])
	require.True(t, ok, "cloned permission paths should be a map")
	assert.Equal(t, "allow", clonedPaths["tmp"], "clone should not alias original permission nested map")

	clonedAgent := cloned.Agent["writer"]
	clonedLimits, ok := asAnyMap(clonedAgent.Options["limits"])
	require.True(t, ok, "cloned agent limits should be a map")
	assert.Equal(t, 10, clonedLimits["max"], "clone should not alias original agent options")

	clonedProvider := cloned.Provider["openai"]
	clonedHTTP, ok := asAnyMap(clonedProvider.Options["http"])
	require.True(t, ok, "cloned provider http options should be a map")
	assert.Equal(t, 30, clonedHTTP["timeout"], "clone should not alias original provider options")
	assert.Equal(t, []string{"instruction-1"}, cloned.Instructions, "clone should not alias original instructions slice")
	require.NotNil(t, cloned.Experimental, "clone should include experimental settings")
	require.NotNil(t, cloned.Experimental.OpenTelemetry, "clone should include experimental pointer settings")
	assert.True(t, *cloned.Experimental.OpenTelemetry, "clone should not alias original experimental pointers")
	assert.Equal(t, []string{"read", "grep"}, cloned.Experimental.PrimaryTools, "clone should not alias experimental primary tools")
	require.NotNil(t, cloned.Compaction, "clone should include compaction settings")
	require.NotNil(t, cloned.Compaction.Auto, "clone should include compaction pointer settings")
	assert.True(t, *cloned.Compaction.Auto, "clone should not alias original compaction pointers")
	assert.Equal(t, "1", cloned.TaskForceAI.Gateway.DefaultHeaders["x-id"], "clone should not alias original gateway headers")
	assert.Equal(t, []string{"https://one.example"}, cloned.TaskForceAI.CORS.AllowedOrigins, "clone should not alias original CORS origins")

	cloned.Tools["exec"] = true
	clonedPaths["tmp"] = "mutated-clone"
	clonedLimits["max"] = 55
	clonedHTTP["timeout"] = 55
	cloned.Instructions[0] = "instruction-clone"
	*cloned.Experimental.BatchTool = true
	cloned.Experimental.PrimaryTools[1] = "mutated-clone-tool"
	*cloned.Compaction.Prune = true
	cloned.TaskForceAI.Gateway.DefaultHeaders["x-extra"] = "2"
	cloned.TaskForceAI.CORS.AllowedOrigins[0] = "https://clone.example"

	assert.NotContains(t, original.Tools, "exec", "mutating clone tools map should not mutate original tools map")
	assert.Equal(t, "mutated-original", originalPaths["tmp"], "mutating clone nested permission map should not mutate original")
	assert.Equal(t, 99, originalLimits["max"], "mutating clone agent options should not mutate original")
	assert.Equal(t, 99, originalHTTP["timeout"], "mutating clone provider options should not mutate original")
	assert.Equal(t, []string{"instruction-original"}, original.Instructions, "mutating clone instructions should not mutate original")
	assert.False(t, *original.Experimental.BatchTool, "mutating clone experimental pointer should not mutate original")
	assert.Equal(t, []string{"mutated-original-tool", "grep"}, original.Experimental.PrimaryTools, "mutating clone experimental slice should not mutate original")
	assert.False(t, *original.Compaction.Prune, "mutating clone compaction pointer should not mutate original")
	assert.NotContains(t, original.TaskForceAI.Gateway.DefaultHeaders, "x-extra", "mutating clone headers should not mutate original")
	assert.Equal(t, []string{"https://original.example"}, original.TaskForceAI.CORS.AllowedOrigins, "mutating clone CORS origins should not mutate original")
}

func TestUpdateGetResetRoundTrip(t *testing.T) {
	Reset()
	t.Cleanup(Reset)

	dir := t.TempDir()
	configFile := filepath.Join(dir, "config.json")

	t.Setenv("TASKFORCEAI_CORE_CONFIG", configFile)
	t.Setenv("TASKFORCEAI_CORE_CONFIG_DIR", "")
	t.Setenv("TASKFORCEAI_CORE_CONFIG_CONTENT", "")
	t.Setenv("TASKFORCEAI_CORE_PERMISSION", "")

	writeJSONFile(t, configFile, map[string]any{
		"instructions": []string{"initial"},
		"permission": map[string]any{
			"read": "allow",
		},
		"provider": map[string]any{
			"openai": map[string]any{
				"options": map[string]any{
					"region": "initial",
				},
			},
		},
	})

	first, err := Get()
	require.NoError(t, err, "initial Get should load config from disk")
	require.NotNil(t, first, "initial Get should return config")
	assert.Equal(t, []string{"initial"}, first.Instructions, "initial Get should load instructions from disk")
	assert.Equal(t, "allow", first.Permission["read"], "initial Get should load file permission")

	writeJSONFile(t, configFile, map[string]any{
		"instructions": []string{"external"},
		"permission": map[string]any{
			"read": "deny",
		},
		"provider": map[string]any{
			"openai": map[string]any{
				"options": map[string]any{
					"region": "external",
				},
			},
		},
	})

	cachedConfig, err := Get()
	require.NoError(t, err, "cached Get should not fail")
	assert.NotSame(t, first, cachedConfig, "Get should return a defensive copy, not cached pointer")
	assert.Equal(t, []string{"initial"}, cachedConfig.Instructions, "cached config should ignore external file mutations")

	err = Update(&Info{
		Instructions: []string{"updated"},
		Permission: Permission{
			"write": "deny",
		},
		Provider: map[string]Provider{
			"openai": {
				Options: AnyMap{
					"timeout": 30,
					"nested": AnyMap{
						"fromUpdate": true,
					},
				},
			},
		},
	})
	require.NoError(t, err, "Update should persist merged config and reset cache")

	updatedConfig, err := Get()
	require.NoError(t, err, "Get after Update should load updated config")
	require.NotNil(t, updatedConfig, "Get after Update should return config")
	assert.NotSame(t, cachedConfig, updatedConfig, "Update should reset cache and force a reload")
	assert.Equal(t, []string{"updated"}, updatedConfig.Instructions, "Update should override instructions")
	assert.Equal(t, "deny", updatedConfig.Permission["read"], "Update should merge against latest file content, not stale cache")
	assert.Equal(t, "deny", updatedConfig.Permission["write"], "Update should add overlay permission values")

	openAI := updatedConfig.Provider["openai"]
	assert.Equal(t, "external", openAI.Options["region"], "Update should preserve existing provider values when not overridden")
	assert.EqualValues(t, 30, openAI.Options["timeout"], "Update should merge overlay provider values")
	nested, ok := asAnyMap(openAI.Options["nested"])
	require.True(t, ok, "nested provider options should be a map")
	assert.Equal(t, true, nested["fromUpdate"], "Update should persist nested overlay options")

	writeJSONFile(t, configFile, map[string]any{
		"instructions": []string{"after-reset"},
		"permission": map[string]any{
			"read": "allow",
		},
	})

	beforeReset, err := Get()
	require.NoError(t, err, "Get before Reset should succeed")
	assert.Equal(t, []string{"updated"}, beforeReset.Instructions, "without Reset, Get should keep returning cached config")

	Reset()
	afterReset, err := Get()
	require.NoError(t, err, "Get after Reset should reload from disk")
	assert.Equal(t, []string{"after-reset"}, afterReset.Instructions, "Reset should clear cache and reload latest config")
	assert.Equal(t, "allow", afterReset.Permission["read"], "Reset + Get should reflect latest on-disk permission values")
}

func TestGetReturnsDefensiveCopy(t *testing.T) {
	Reset()
	t.Cleanup(Reset)

	dir := t.TempDir()
	configFile := filepath.Join(dir, "config.json")

	t.Setenv("TASKFORCEAI_CORE_CONFIG", configFile)
	t.Setenv("TASKFORCEAI_CORE_CONFIG_DIR", "")
	t.Setenv("TASKFORCEAI_CORE_CONFIG_CONTENT", "")
	t.Setenv("TASKFORCEAI_CORE_PERMISSION", "")

	writeJSONFile(t, configFile, map[string]any{
		"model": "original-model",
		"permission": map[string]any{
			"read": "allow",
		},
		"provider": map[string]any{
			"openai": map[string]any{
				"options": map[string]any{
					"region": "us",
				},
			},
		},
	})

	first, err := Get()
	require.NoError(t, err, "first Get should load config from disk")
	require.NotNil(t, first, "first Get should return config")
	require.NotNil(t, first.Model, "first Get should populate model")
	*first.Model = "mutated-model"
	first.Permission["read"] = "deny"
	openAI := first.Provider["openai"]
	openAI.Options["region"] = "eu"
	first.Provider["openai"] = openAI

	second, err := Get()
	require.NoError(t, err, "second Get should succeed")
	require.NotNil(t, second.Model, "second Get should populate model")
	assert.Equal(t, "original-model", *second.Model, "mutating first Get result must not mutate cached config")
	assert.Equal(t, "allow", second.Permission["read"], "mutating first Get permission map must not mutate cache")
	assert.Equal(t, "us", second.Provider["openai"].Options["region"], "mutating first Get nested provider options must not mutate cache")
}

func TestMergeAnyMapIdempotenceAndAssociativity(t *testing.T) {
	source := AnyMap{
		"alpha": "one",
		"nested": AnyMap{
			"x": 1,
			"shared": AnyMap{
				"a": 1,
			},
		},
		"items": []any{
			AnyMap{"key": "value"},
		},
	}

	idempotent := mergeAnyMap(source, source)
	cloned := mergeAnyMap(nil, source)
	assert.Equal(t, cloned, idempotent, "mergeAnyMap should be idempotent for identical inputs")

	sourceNested, ok := asAnyMap(source["nested"])
	require.True(t, ok, "source nested value should be a map")
	sourceNested["x"] = 999
	sourceItems, ok := source["items"].([]any)
	require.True(t, ok, "source items should be a slice")
	sourceItem0, ok := asAnyMap(sourceItems[0])
	require.True(t, ok, "source item should be a map")
	sourceItem0["key"] = "mutated-source"

	idempotentNested, ok := asAnyMap(idempotent["nested"])
	require.True(t, ok, "idempotent nested value should be a map")
	assert.Equal(t, 1, idempotentNested["x"], "idempotent result should be a deep clone, not an alias")

	idempotentItems, ok := idempotent["items"].([]any)
	require.True(t, ok, "idempotent items should be a slice")
	idempotentItem0, ok := asAnyMap(idempotentItems[0])
	require.True(t, ok, "idempotent item should be a map")
	assert.Equal(t, "value", idempotentItem0["key"], "idempotent result should deep-clone nested slices/maps")

	a := AnyMap{
		"root": AnyMap{
			"fromA": true,
			"shared": AnyMap{
				"a": "A",
			},
		},
	}
	b := AnyMap{
		"root": AnyMap{
			"fromB": true,
			"shared": AnyMap{
				"b": "B",
			},
		},
	}
	c := AnyMap{
		"root": AnyMap{
			"fromC": true,
			"shared": AnyMap{
				"c": "C",
			},
		},
	}

	left := mergeAnyMap(mergeAnyMap(a, b), c)
	right := mergeAnyMap(a, mergeAnyMap(b, c))
	assert.Equal(t, left, right, "mergeAnyMap should be associative for nested map-only merges")
}

func TestNormalizeInfoToolAliasPrecedence(t *testing.T) {
	tests := []struct {
		name  string
		tools map[string]bool
		want  string
	}{
		{
			name: "deny wins when aliases conflict",
			tools: map[string]bool{
				"write":     true,
				"edit":      false,
				"multiedit": true,
			},
			want: "deny",
		},
		{
			name: "allow when all aliases allow",
			tools: map[string]bool{
				"write":     true,
				"edit":      true,
				"multiedit": true,
			},
			want: "allow",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			info := &Info{Tools: tc.tools}
			normalizeInfo(info)
			assert.Equal(t, tc.want, info.Permission["edit"])
		})
	}
}

func TestNormalizeAgentsToolAliasPrecedence(t *testing.T) {
	agents := normalizeAgents(map[string]Agent{
		"writer": {
			Tools: map[string]bool{
				"write":     true,
				"edit":      false,
				"multiedit": true,
			},
		},
		"editor": {
			Tools: map[string]bool{
				"write": true,
				"edit":  true,
			},
		},
	})

	assert.Equal(t, "deny", agents["writer"].Permission["edit"])
	assert.Equal(t, "allow", agents["editor"].Permission["edit"])
}

func TestAgentUnmarshalPreservesUnknownKeysInOptions(t *testing.T) {
	var agent Agent
	err := json.Unmarshal([]byte(`{
		"model": "zai/glm-5.2",
		"options": {
			"existing": "value",
			"nested": {"fromOptions": true}
		},
		"custom_flag": true,
		"nested": {"fromUnknown": true}
	}`), &agent)
	require.NoError(t, err)
	require.NotNil(t, agent.Model)
	assert.Equal(t, "zai/glm-5.2", *agent.Model)
	assert.Equal(t, "value", agent.Options["existing"])
	assert.Equal(t, true, agent.Options["custom_flag"])

	nested, ok := asAnyMap(agent.Options["nested"])
	require.True(t, ok)
	assert.Equal(t, true, nested["fromUnknown"])
}

func TestMergeTaskForceAIConfigOverlaysNestedFields(t *testing.T) {
	baseModel := "base-model"
	overlayAPIKey := "overlay-key"
	baseURL := "https://gateway.example"
	baseDefault := "base-default"
	overlayDefault := "overlay-default"
	baseMaxIterations := 10
	overlayTemperature := 0.4
	baseParallelAgents := 3
	overlayTaskTimeout := 120
	baseSearchResults := 5
	overlayProvider := "brave"
	baseEndpoint := "https://search.example"
	overlayBraveKey := "brave-key"
	baseRPM := 60
	overlayHourly := 1000

	base := &TaskForceAIConfig{
		Gateway: &TaskForceAIGatewayConfig{
			BaseURL: &baseURL,
			Model:   &baseModel,
			DefaultHeaders: map[string]string{
				"x-base":   "base",
				"x-shared": "base",
			},
		},
		Models: &TaskForceAIModelsConfig{
			Default: &baseDefault,
			Options: []TaskForceAIModelOption{
				{ID: "base", Label: "Base"},
			},
		},
		Agent: &TaskForceAIAgentConfig{
			MaxIterations: &baseMaxIterations,
		},
		Orchestrator: &TaskForceAIOrchestratorConfig{
			ParallelAgents: &baseParallelAgents,
		},
		Search: &TaskForceAISearchConfig{
			MaxResults: &baseSearchResults,
			Brave:      &TaskForceAIBraveConfig{Endpoint: &baseEndpoint},
		},
		WebApp: &TaskForceAIWebAppConfig{
			RateLimit: &TaskForceAIRateLimitConfig{RequestsPerMinute: &baseRPM},
		},
		CORS: &TaskForceAICORSConfig{AllowedOrigins: []string{"https://base.example"}},
	}
	overlay := &TaskForceAIConfig{
		Gateway: &TaskForceAIGatewayConfig{
			APIKey: &overlayAPIKey,
			DefaultHeaders: map[string]string{
				"x-overlay": "overlay",
				"x-shared":  "overlay",
			},
		},
		Models: &TaskForceAIModelsConfig{
			Default: &overlayDefault,
			Options: []TaskForceAIModelOption{
				{ID: "overlay", Label: "Overlay"},
			},
		},
		Agent: &TaskForceAIAgentConfig{
			Temperature: &overlayTemperature,
		},
		Orchestrator: &TaskForceAIOrchestratorConfig{
			TaskTimeout: &overlayTaskTimeout,
		},
		Search: &TaskForceAISearchConfig{
			Provider: &overlayProvider,
			Brave:    &TaskForceAIBraveConfig{APIKey: &overlayBraveKey},
		},
		WebApp: &TaskForceAIWebAppConfig{
			RateLimit: &TaskForceAIRateLimitConfig{RequestsPerHour: &overlayHourly},
		},
		CORS: &TaskForceAICORSConfig{AllowedOrigins: []string{"https://overlay.example"}},
	}

	merged := mergeTaskForceAI(base, overlay)

	require.NotNil(t, merged.Gateway)
	assert.Equal(t, overlayAPIKey, *merged.Gateway.APIKey)
	assert.Equal(t, baseURL, *merged.Gateway.BaseURL)
	assert.Equal(t, baseModel, *merged.Gateway.Model)
	assert.Equal(t, map[string]string{
		"x-base":    "base",
		"x-shared":  "overlay",
		"x-overlay": "overlay",
	}, merged.Gateway.DefaultHeaders)

	require.NotNil(t, merged.Models)
	assert.Equal(t, overlayDefault, *merged.Models.Default)
	require.Len(t, merged.Models.Options, 1)
	assert.Equal(t, "overlay", merged.Models.Options[0].ID)

	require.NotNil(t, merged.Agent)
	assert.Equal(t, baseMaxIterations, *merged.Agent.MaxIterations)
	assert.Equal(t, overlayTemperature, *merged.Agent.Temperature)

	require.NotNil(t, merged.Orchestrator)
	assert.Equal(t, baseParallelAgents, *merged.Orchestrator.ParallelAgents)
	assert.Equal(t, overlayTaskTimeout, *merged.Orchestrator.TaskTimeout)

	require.NotNil(t, merged.Search)
	assert.Equal(t, baseSearchResults, *merged.Search.MaxResults)
	assert.Equal(t, overlayProvider, *merged.Search.Provider)
	require.NotNil(t, merged.Search.Brave)
	assert.Equal(t, overlayBraveKey, *merged.Search.Brave.APIKey)
	assert.Equal(t, baseEndpoint, *merged.Search.Brave.Endpoint)

	require.NotNil(t, merged.WebApp)
	require.NotNil(t, merged.WebApp.RateLimit)
	assert.Equal(t, baseRPM, *merged.WebApp.RateLimit.RequestsPerMinute)
	assert.Equal(t, overlayHourly, *merged.WebApp.RateLimit.RequestsPerHour)
	assert.Equal(t, []string{"https://overlay.example"}, merged.CORS.AllowedOrigins)

	overlay.Gateway.DefaultHeaders["x-overlay"] = "mutated"
	overlay.Models.Options[0].ID = "mutated"
	overlay.CORS.AllowedOrigins[0] = "https://mutated.example"
	assert.Equal(t, "overlay", merged.Gateway.DefaultHeaders["x-overlay"])
	assert.Equal(t, "overlay", merged.Models.Options[0].ID)
	assert.Equal(t, []string{"https://overlay.example"}, merged.CORS.AllowedOrigins)
}

func TestMergeAgentOverlaysAndDeepClones(t *testing.T) {
	baseModel := "base-model"
	overlayPrompt := "overlay prompt"
	baseSteps := 3
	overlayMaxSteps := 5
	base := Agent{
		Model: &baseModel,
		Tools: map[string]bool{
			"read": true,
		},
		Permission: Permission{
			"read": "allow",
		},
		Options: AnyMap{
			"nested": AnyMap{"fromBase": true},
		},
		Steps: &baseSteps,
	}
	overlay := Agent{
		Prompt: &overlayPrompt,
		Tools: map[string]bool{
			"write": true,
		},
		Permission: Permission{
			"write": "allow",
		},
		Options: AnyMap{
			"nested": AnyMap{"fromOverlay": true},
		},
		MaxSteps: &overlayMaxSteps,
	}

	merged := mergeAgent(base, overlay)

	require.NotNil(t, merged.Model)
	assert.Equal(t, baseModel, *merged.Model)
	require.NotNil(t, merged.Prompt)
	assert.Equal(t, overlayPrompt, *merged.Prompt)
	assert.Equal(t, map[string]bool{"read": true, "write": true}, merged.Tools)
	assert.Equal(t, "allow", merged.Permission["read"])
	assert.Equal(t, "allow", merged.Permission["write"])
	assert.Equal(t, baseSteps, *merged.Steps)
	assert.Equal(t, overlayMaxSteps, *merged.MaxSteps)
	nested, ok := asAnyMap(merged.Options["nested"])
	require.True(t, ok)
	assert.Equal(t, true, nested["fromBase"])
	assert.Equal(t, true, nested["fromOverlay"])

	overlay.Tools["write"] = false
	overlayNested, ok := asAnyMap(overlay.Options["nested"])
	require.True(t, ok)
	overlayNested["fromOverlay"] = false
	assert.True(t, merged.Tools["write"])
	assert.Equal(t, true, nested["fromOverlay"])
}

func TestMergeExperimentalAndCompaction(t *testing.T) {
	openTelemetry := false
	overlayBatchTool := true
	continueOnDeny := true
	baseAuto := false
	overlayPrune := true

	experimental := mergeExperimental(
		&Experimental{OpenTelemetry: &openTelemetry, PrimaryTools: []string{"read"}},
		&Experimental{BatchTool: &overlayBatchTool, ContinueOnDeny: &continueOnDeny, PrimaryTools: []string{"grep"}},
	)
	require.NotNil(t, experimental)
	assert.Equal(t, openTelemetry, *experimental.OpenTelemetry)
	assert.Equal(t, overlayBatchTool, *experimental.BatchTool)
	assert.Equal(t, continueOnDeny, *experimental.ContinueOnDeny)
	assert.Equal(t, []string{"grep"}, experimental.PrimaryTools)

	compaction := mergeCompaction(&Compaction{Auto: &baseAuto}, &Compaction{Prune: &overlayPrune})
	require.NotNil(t, compaction)
	assert.Equal(t, baseAuto, *compaction.Auto)
	assert.Equal(t, overlayPrune, *compaction.Prune)
}

func TestConfigPathAndCandidatesRespectOverrides(t *testing.T) {
	explicitFile := filepath.Join(t.TempDir(), "explicit.json")
	t.Setenv("TASKFORCEAI_CORE_CONFIG", explicitFile)
	t.Setenv("TASKFORCEAI_CORE_CONFIG_DIR", filepath.Join(t.TempDir(), "ignored"))
	t.Setenv("TASKFORCEAI_CORE_ROOT", filepath.Join(t.TempDir(), "ignored-root"))

	assert.Equal(t, explicitFile, configPath())
	assert.Equal(t, []string{explicitFile}, configCandidates())

	t.Setenv("TASKFORCEAI_CORE_CONFIG", "")
	configDir := t.TempDir()
	t.Setenv("TASKFORCEAI_CORE_CONFIG_DIR", configDir)

	assert.Equal(t, filepath.Join(configDir, "config.json"), configPath())
	assert.Equal(t, []string{
		filepath.Join(configDir, "config.json"),
		filepath.Join(configDir, "taskforceai.json"),
	}, configCandidates())

	t.Setenv("TASKFORCEAI_CORE_CONFIG_DIR", "")
	root := t.TempDir()
	t.Setenv("TASKFORCEAI_CORE_ROOT", root)

	assert.Equal(t, root, runtimeDir())
	assert.Equal(t, filepath.Join(root, "config.json"), configPath())
	assert.Equal(t, []string{
		filepath.Join(root, "config.json"),
		filepath.Join(root, "taskforceai.json"),
	}, configCandidates())
}

func TestLoadFileAndLoadErrorBranches(t *testing.T) {
	t.Run("missing and empty files return empty config", func(t *testing.T) {
		missing, err := loadFile(filepath.Join(t.TempDir(), "missing.json"))
		require.NoError(t, err)
		assert.Equal(t, &Info{}, missing)

		emptyPath := filepath.Join(t.TempDir(), "empty.json")
		require.NoError(t, os.WriteFile(emptyPath, nil, 0o600))
		empty, err := loadFile(emptyPath)
		require.NoError(t, err)
		assert.Equal(t, &Info{}, empty)
	})

	t.Run("invalid config content is returned with source context", func(t *testing.T) {
		invalidPath := filepath.Join(t.TempDir(), "config.json")
		require.NoError(t, os.WriteFile(invalidPath, []byte(`{"agent":{"writer":{"steps":"many"}}}`), 0o600))

		_, err := loadFile(invalidPath)
		require.Error(t, err)
		assert.ErrorContains(t, err, "decode config")
	})

	t.Run("load returns read error when candidates exist but none load", func(t *testing.T) {
		dir := t.TempDir()
		require.NoError(t, os.Mkdir(filepath.Join(dir, "config.json"), 0o700))

		t.Setenv("TASKFORCEAI_CORE_CONFIG", "")
		t.Setenv("TASKFORCEAI_CORE_CONFIG_DIR", dir)
		t.Setenv("TASKFORCEAI_CORE_CONFIG_CONTENT", "")
		t.Setenv("TASKFORCEAI_CORE_PERMISSION", "")

		_, err := load()
		require.Error(t, err)
		assert.ErrorContains(t, err, "read config")
	})

	t.Run("env content and permission decode errors are surfaced", func(t *testing.T) {
		t.Setenv("TASKFORCEAI_CORE_CONFIG", filepath.Join(t.TempDir(), "missing.json"))
		t.Setenv("TASKFORCEAI_CORE_CONFIG_DIR", "")
		t.Setenv("TASKFORCEAI_CORE_CONFIG_CONTENT", `{"agent":{"writer":{"steps":"many"}}}`)
		t.Setenv("TASKFORCEAI_CORE_PERMISSION", "")

		_, err := load()
		require.Error(t, err)
		require.ErrorContains(t, err, "decode inline config content")

		t.Setenv("TASKFORCEAI_CORE_CONFIG_CONTENT", "")
		t.Setenv("TASKFORCEAI_CORE_PERMISSION", `null`)
		_, err = load()
		require.Error(t, err)
		require.ErrorContains(t, err, "validate permission config content")

		t.Setenv("TASKFORCEAI_CORE_PERMISSION", `{`)
		_, err = load()
		require.Error(t, err)
		assert.ErrorContains(t, err, "decode permission config content")
	})
}

func TestUpdateErrorBranches(t *testing.T) {
	err := Update(nil)
	require.Error(t, err)
	require.ErrorContains(t, err, "config is nil")

	dir := t.TempDir()
	t.Setenv("TASKFORCEAI_CORE_CONFIG", filepath.Join(dir, "missing", "config.json"))
	t.Setenv("TASKFORCEAI_CORE_CONFIG_DIR", "")
	t.Setenv("TASKFORCEAI_CORE_CONFIG_CONTENT", "")
	t.Setenv("TASKFORCEAI_CORE_PERMISSION", "")

	err = Update(&Info{Instructions: []string{"will-not-write"}})
	require.Error(t, err)
	assert.ErrorContains(t, err, "write config")
}

func TestNormalizeInfoAndAgentsBranches(t *testing.T) {
	normalizeInfo(nil)

	info := &Info{
		Tools: map[string]bool{
			"read": false,
		},
		Permission: Permission{
			"read": "allow",
		},
		Agent: map[string]Agent{
			"runner": {
				Tools: map[string]bool{
					"exec": true,
				},
				Permission: Permission{
					"exec": "ask",
				},
				Options: AnyMap{
					"mode": "fast",
				},
				MaxSteps: intPtr(7),
			},
		},
	}

	normalizeInfo(info)

	assert.Equal(t, "allow", info.Permission["read"], "explicit permission should override tool-derived permission")
	runner := info.Agent["runner"]
	require.NotNil(t, runner.Steps)
	assert.Equal(t, 7, *runner.Steps, "MaxSteps should backfill Steps for normalized agents")
	assert.Equal(t, "ask", runner.Permission["exec"], "agent permission should override tool-derived permission")
	assert.Equal(t, "fast", runner.Options["mode"])
}

func TestMergeCloneBaseNilBranches(t *testing.T) {
	assert.Nil(t, clonePtr[TaskForceAIConfig](nil))
	assert.Nil(t, mergeTaskForceAI(nil, nil))
	assert.Nil(t, mergeExperimental(nil, nil))
	assert.Nil(t, mergeCompaction(nil, nil))

	baseTelemetry := true
	clonedExperimental := mergeExperimental(&Experimental{OpenTelemetry: &baseTelemetry}, nil)
	require.NotNil(t, clonedExperimental)
	require.NotSame(t, &baseTelemetry, clonedExperimental.OpenTelemetry)
	assert.True(t, *clonedExperimental.OpenTelemetry)

	overlayPrune := true
	clonedCompaction := mergeCompaction(nil, &Compaction{Prune: &overlayPrune})
	require.NotNil(t, clonedCompaction)
	require.NotSame(t, &overlayPrune, clonedCompaction.Prune)
	assert.True(t, *clonedCompaction.Prune)

	defaultModel := "overlay"
	clonedTaskForceAI := mergeTaskForceAI(nil, &TaskForceAIConfig{
		Models: &TaskForceAIModelsConfig{Default: &defaultModel},
	})
	require.NotNil(t, clonedTaskForceAI)
	require.NotNil(t, clonedTaskForceAI.Models)
	require.NotNil(t, clonedTaskForceAI.Models.Default)
	require.NotSame(t, &defaultModel, clonedTaskForceAI.Models.Default)
	assert.Equal(t, defaultModel, *clonedTaskForceAI.Models.Default)
}

func intPtr(value int) *int {
	return &value
}

func writeJSONFile(t *testing.T, path string, value any) {
	t.Helper()

	data, err := json.Marshal(value)
	require.NoError(t, err, "failed to marshal test JSON for %s", path)

	err = os.WriteFile(path, data, 0o600)
	require.NoError(t, err, "failed to write test JSON file %s", path)
}
