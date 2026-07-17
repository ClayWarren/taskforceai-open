package orchestrator

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type testPromptProvider struct {
	roles      map[string]string
	tools      map[string]string
	soul       string
	compaction string
}

func (p testPromptProvider) RolePrompt(name string) string {
	return p.roles[name]
}

func (p testPromptProvider) ToolPrompt(name string) string {
	return p.tools[name]
}

func (p testPromptProvider) SoulContent() string {
	return p.soul
}

func (p testPromptProvider) CompactionPrompt() string {
	return p.compaction
}

func TestIsAllowedSystemOverride(t *testing.T) {
	provider := testPromptProvider{roles: map[string]string{"Researcher": "researcher prompt"}}
	deps := gapOrchestratorDeps(nil)
	deps.PromptProvider = provider
	orch := New(testConfig(), deps, OrchestratorOptions{})

	roles := orch.agentRoles()
	require.NotEmpty(t, roles)

	assert.True(t, isAllowedSystemOverride(orch, roles[0].SystemPrompt))
	assert.False(t, isAllowedSystemOverride(orch, "attacker controlled override"))
	assert.False(t, isAllowedSystemOverride(nil, roles[0].SystemPrompt))
}

func TestLoadRolePrompt_Provider(t *testing.T) {
	provider := testPromptProvider{roles: map[string]string{"Researcher": "  Prompt from provider  "}}
	assert.Equal(t, "Prompt from provider", loadRolePromptFromProvider(provider, "Researcher"))
	assert.Empty(t, loadRolePromptFromProvider(provider, ""))
}

func TestLoadRolePrompt_DefaultFallback(t *testing.T) {
	roles := GetAgentRoles()
	require.NotEmpty(t, roles)
	assert.Contains(t, roles[0].SystemPrompt, "specialized in the role")

	var orch *TaskOrchestrator
	roles = orch.agentRoles()
	require.NotEmpty(t, roles)
	assert.Contains(t, roles[0].SystemPrompt, "specialized in the role")
}

func TestLoadRolePrompt_MissingPromptReturnsEmpty(t *testing.T) {
	assert.Empty(t, loadRolePromptFromProvider(testPromptProvider{}, "Missing"))
}

func TestLoadSoulContent_LoadsAndTrims(t *testing.T) {
	assert.Equal(t, "Mission Soul", loadSoulContentFromProvider(testPromptProvider{soul: "  Mission Soul  \n"}))
}

func TestLoadSoulContent_MissingReturnsEmpty(t *testing.T) {
	assert.Empty(t, loadSoulContentFromProvider(nil))
}

func TestNewOrchestrator_RoleModels(t *testing.T) {
	roleModels := map[string]string{
		"Researcher": "claude-opus-4-6",
		"Analyst":    "gpt-4",
	}

	orch := New(testConfig(), OrchestratorDeps{}, OrchestratorOptions{
		RoleModels: roleModels,
	})

	if orch.roleModels == nil {
		t.Fatal("expected roleModels to be set")
	}
	if orch.roleModels["Researcher"] != "claude-opus-4-6" {
		t.Errorf("Researcher model = %q, want claude-opus-4-6", orch.roleModels["Researcher"])
	}
	if orch.roleModels["Analyst"] != "gpt-4" {
		t.Errorf("Analyst model = %q, want gpt-4", orch.roleModels["Analyst"])
	}
}

func TestTaskOrchestrator_RoleModelOverrideSkipsGenerationModel(t *testing.T) {
	roleModels := map[string]string{"Researcher": "openai/gpt-5"}

	textOrch := New(testConfig(), OrchestratorDeps{}, OrchestratorOptions{
		RoleModels: roleModels,
	})
	modelID, ok := textOrch.roleModelOverride("Researcher")
	require.True(t, ok)
	assert.Equal(t, "openai/gpt-5", modelID)

	genCfg := testConfig()
	genCfg.Gateway.Model = "xai/grok-imagine-video-1.5"
	genOrch := New(genCfg, OrchestratorDeps{}, OrchestratorOptions{
		RoleModels: roleModels,
	})
	modelID, ok = genOrch.roleModelOverride("Researcher")
	require.False(t, ok)
	assert.Empty(t, modelID)
}

func TestNewOrchestrator_RoleModels_Nil(t *testing.T) {
	orch := New(testConfig(), gapOrchestratorDeps(nil), OrchestratorOptions{})

	if orch.roleModels != nil {
		t.Errorf("expected nil roleModels when not provided, got %v", orch.roleModels)
	}
}
