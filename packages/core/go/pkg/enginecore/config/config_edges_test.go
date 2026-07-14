package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type unexportedConfigStruct struct {
	value string
}

func TestAgentUnmarshalJSONEdges(t *testing.T) {
	var agent Agent
	require.Error(t, agent.UnmarshalJSON([]byte(`{`)))

	require.NoError(t, json.Unmarshal([]byte(`{"model":"m","extra":{"nested":true}}`), &agent))
	require.NotNil(t, agent.Options)
	assert.Equal(t, map[string]any{"nested": true}, agent.Options["extra"])

	previousUnmarshal := unmarshalConfigJSON
	calls := 0
	unmarshalConfigJSON = func(data []byte, v any) error {
		calls++
		if calls == 2 {
			return errors.New("raw failed")
		}
		return json.Unmarshal(data, v)
	}
	var rawError Agent
	require.ErrorContains(t, rawError.UnmarshalJSON([]byte(`{"model":"m"}`)), "raw failed")
	assert.Equal(t, 2, calls)
	unmarshalConfigJSON = previousUnmarshal

	previousValidate := validateConfigStruct
	validateConfigStruct = func(any) error {
		return errors.New("invalid config")
	}
	var invalid Agent
	require.ErrorContains(t, invalid.UnmarshalJSON([]byte(`{}`)), "invalid config")
	_, err := decodeInfoJSON([]byte(`{}`))
	require.ErrorContains(t, err, "invalid config")
	_, err = decodePermissionEnv(`{"read":"allow"}`)
	require.ErrorContains(t, err, "invalid config")
	validateConfigStruct = previousValidate
}

func TestGetAndUpdateErrorEdges(t *testing.T) {
	Reset()
	t.Cleanup(Reset)
	t.Setenv("TASKFORCEAI_CORE_CONFIG", "")
	t.Setenv("TASKFORCEAI_CORE_CONFIG_DIR", t.TempDir())
	t.Setenv("TASKFORCEAI_CORE_CONFIG_CONTENT", "{")

	_, err := Get()
	require.ErrorContains(t, err, "decode inline config content")

	require.ErrorContains(t, Update(nil), "config is nil")

	cfgPath := filepath.Join(t.TempDir(), "config.json")
	t.Setenv("TASKFORCEAI_CORE_CONFIG", cfgPath)
	require.NoError(t, os.WriteFile(cfgPath, []byte(`{}`), 0o600))
	err = Update(&Info{Agent: map[string]Agent{
		"bad": {Options: AnyMap{"fn": func() {}}},
	}})
	require.ErrorContains(t, err, "encode config")

	t.Setenv("TASKFORCEAI_CORE_CONFIG", t.TempDir())
	err = Update(&Info{})
	require.ErrorContains(t, err, "read config")

	t.Setenv("TASKFORCEAI_CORE_CONFIG", filepath.Join(t.TempDir(), "missing", "config.json"))
	err = Update(&Info{})
	require.ErrorContains(t, err, "write config")
}

func TestConfigMergeNilAndCloneEdges(t *testing.T) {
	str := func(v string) *string { return &v }

	assert.Equal(t, &Info{}, mergeInfo(nil, nil))
	assert.Equal(t, &Info{}, cloneInfo(nil))
	assert.Nil(t, mergeMap[string](nil, nil))
	assert.Nil(t, mergeAnyMap(nil, nil))
	assert.Nil(t, cloneAny(nil))

	baseInfo := &Info{Model: str("base")}
	overlayInfo := &Info{Tools: map[string]bool{"read": true}}
	assert.Equal(t, "base", *mergeInfo(baseInfo, nil).Model)
	assert.Equal(t, "base", *mergeInfo(nil, baseInfo).Model)
	mergedInfo := mergeInfo(baseInfo, overlayInfo)
	assert.True(t, mergedInfo.Tools["read"])

	permissionMap, ok := asAnyMap(Permission{"read": "allow"})
	require.True(t, ok)
	assert.Equal(t, "allow", permissionMap["read"])
	_, ok = asAnyMap(123)
	assert.False(t, ok)

	assert.Empty(t, permissionFromTools(nil))
	assert.Equal(t, Permission{"edit": "allow"}, permissionFromTools(map[string]bool{"write": true, "edit": true}))
	assert.Equal(t, Permission{"edit": "deny"}, permissionFromTools(map[string]bool{"write": true, "multiedit": false}))
}

func TestTaskForceAIMergeEdges(t *testing.T) {
	str := func(v string) *string { return &v }
	integer := func(v int) *int { return &v }
	float := func(v float64) *float64 { return &v }

	assert.Nil(t, mergeTaskForceAI(nil, nil))
	require.NotNil(t, mergeTaskForceAI(nil, &TaskForceAIConfig{}))
	require.NotNil(t, mergeTaskForceAI(&TaskForceAIConfig{}, nil))

	gateway := mergeTaskForceAIGateway(
		&TaskForceAIGatewayConfig{DefaultHeaders: map[string]string{"x-base": "1"}},
		&TaskForceAIGatewayConfig{APIKey: str("key"), DefaultHeaders: map[string]string{"x-overlay": "2"}},
	)
	assert.Equal(t, "key", *gateway.APIKey)
	assert.Equal(t, "1", gateway.DefaultHeaders["x-base"])
	assert.Equal(t, "2", gateway.DefaultHeaders["x-overlay"])
	require.NotNil(t, mergeTaskForceAIGateway(nil, &TaskForceAIGatewayConfig{}))

	models := mergeTaskForceAIModels(&TaskForceAIModelsConfig{Default: str("base")}, &TaskForceAIModelsConfig{
		Default: str("overlay"),
		Options: []TaskForceAIModelOption{{
			ID: "model",
		}},
	})
	assert.Equal(t, "overlay", *models.Default)
	assert.Equal(t, "model", models.Options[0].ID)
	require.NotNil(t, mergeTaskForceAIModels(nil, &TaskForceAIModelsConfig{}))

	agent := mergeTaskForceAIAgent(&TaskForceAIAgentConfig{MaxIterations: integer(1)}, &TaskForceAIAgentConfig{Temperature: float(0.2)})
	assert.Equal(t, 1, *agent.MaxIterations)
	assert.Equal(t, 0.2, *agent.Temperature)
	require.NotNil(t, mergeTaskForceAIAgent(nil, &TaskForceAIAgentConfig{}))

	orchestrator := mergeTaskForceAIOrchestrator(&TaskForceAIOrchestratorConfig{ParallelAgents: integer(1)}, &TaskForceAIOrchestratorConfig{TaskTimeout: integer(2)})
	assert.Equal(t, 1, *orchestrator.ParallelAgents)
	assert.Equal(t, 2, *orchestrator.TaskTimeout)
	require.NotNil(t, mergeTaskForceAIOrchestrator(nil, &TaskForceAIOrchestratorConfig{}))

	search := mergeTaskForceAISearch(&TaskForceAISearchConfig{}, &TaskForceAISearchConfig{
		Provider: str("brave"),
		Brave:    &TaskForceAIBraveConfig{APIKey: str("brave-key")},
	})
	assert.Equal(t, "brave", *search.Provider)
	assert.Equal(t, "brave-key", *search.Brave.APIKey)
	require.NotNil(t, mergeTaskForceAISearch(nil, &TaskForceAISearchConfig{}))

	web := mergeTaskForceAIWebApp(&TaskForceAIWebAppConfig{}, &TaskForceAIWebAppConfig{
		RateLimit: &TaskForceAIRateLimitConfig{RequestsPerMinute: integer(10)},
	})
	assert.Equal(t, 10, *web.RateLimit.RequestsPerMinute)
	require.NotNil(t, mergeTaskForceAIWebApp(nil, &TaskForceAIWebAppConfig{}))

	cors := mergeTaskForceAICORS(&TaskForceAICORSConfig{AllowedOrigins: []string{"base"}}, &TaskForceAICORSConfig{AllowedOrigins: []string{"overlay"}})
	assert.Equal(t, []string{"overlay"}, cors.AllowedOrigins)
	require.NotNil(t, mergeTaskForceAICORS(nil, &TaskForceAICORSConfig{}))
}

func TestAgentProviderAndCloneReflectEdges(t *testing.T) {
	str := func(v string) *string { return &v }
	steps := 3
	mergedAgents := mergeAgentMap(
		map[string]Agent{"writer": {Model: str("base"), Options: AnyMap{"nested": AnyMap{"base": true}}}},
		map[string]Agent{
			"writer": {Prompt: str("prompt"), Options: AnyMap{"nested": AnyMap{"overlay": true}}, Steps: &steps},
			"reader": {Model: str("reader")},
		},
	)
	assert.Equal(t, "base", *mergedAgents["writer"].Model)
	assert.Equal(t, "prompt", *mergedAgents["writer"].Prompt)
	assert.Equal(t, 3, *mergedAgents["writer"].Steps)
	nested, ok := asAnyMap(mergedAgents["writer"].Options["nested"])
	require.True(t, ok)
	assert.Equal(t, true, nested["base"])
	assert.Equal(t, true, nested["overlay"])
	assert.Equal(t, "reader", *mergedAgents["reader"].Model)
	assert.Nil(t, mergeAgentMap(nil, nil))

	mergedProviders := mergeProviderMap(
		map[string]Provider{"openai": {Options: AnyMap{"base": true}}},
		map[string]Provider{"openai": {Options: AnyMap{"overlay": true}}},
	)
	assert.Equal(t, true, mergedProviders["openai"].Options["base"])
	assert.Equal(t, true, mergedProviders["openai"].Options["overlay"])
	assert.Nil(t, mergeProviderMap(nil, nil))

	var nilAny any
	assert.Nil(t, cloneValue[any](nilAny))
	nilInterface := reflect.Zero(reflect.TypeOf((*any)(nil)).Elem())
	assert.Equal(t, nilInterface, cloneReflectValue(nilInterface))
	assert.Equal(t, [2]string{"a", "b"}, cloneValue([2]string{"a", "b"}))
	value := reflect.ValueOf(unexportedConfigStruct{value: "x"})
	assert.Equal(t, value, cloneReflectValue(value))
}

func TestRuntimeDirEdges(t *testing.T) {
	root := t.TempDir()
	t.Setenv("TASKFORCEAI_CORE_ROOT", root)
	assert.Equal(t, root, runtimeDir())

	t.Setenv("TASKFORCEAI_CORE_ROOT", "")
	cwd, err := os.Getwd()
	require.NoError(t, err)
	assert.Equal(t, cwd, runtimeDir())

	previousGetwd := getConfigWorkingDir
	getConfigWorkingDir = func() (string, error) {
		return "", errors.New("cwd failed")
	}
	t.Cleanup(func() {
		getConfigWorkingDir = previousGetwd
	})
	assert.Equal(t, ".", runtimeDir())
}
