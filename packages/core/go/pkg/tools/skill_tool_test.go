package tools

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/TaskForceAI/core/pkg/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func writeTestSkill(t *testing.T, cwd, dir, content string) {
	t.Helper()
	full := filepath.Join(cwd, ".taskforceai", "skills", dir)
	require.NoError(t, os.MkdirAll(full, 0o750))
	require.NoError(t, os.WriteFile(filepath.Join(full, "SKILL.md"), []byte(content), 0o600))
}

func TestSkillToolLoadsKnownSkill(t *testing.T) {
	cwd := t.TempDir()
	writeTestSkill(t, cwd, "deploy", "---\nname: deploy\ndescription: Deploy the app\n---\nRun the deploy script.")

	tool := CreateSkillTool(func() string { return cwd })
	res, err := tool.Execute(context.Background(), `{"name":"deploy"}`)
	require.NoError(t, err)
	assert.Equal(t, true, res["success"])
	assert.Contains(t, res["content"], `<skill_content name="deploy">`)
	assert.Contains(t, res["content"], "Run the deploy script.")
}

func TestSkillToolUnknownSkillListsAvailable(t *testing.T) {
	cwd := t.TempDir()
	writeTestSkill(t, cwd, "deploy", "---\nname: deploy\ndescription: Deploy the app\n---\nbody")

	tool := CreateSkillTool(func() string { return cwd })
	res, err := tool.Execute(context.Background(), `{"name":"nope"}`)
	require.NoError(t, err)
	assert.Equal(t, false, res["success"])
	errMsg, _ := res["error"].(string)
	assert.Contains(t, errMsg, "not found")
	assert.Contains(t, errMsg, "**deploy**", "the error should list what IS available")
}

func TestSkillToolInvalidJSON(t *testing.T) {
	tool := CreateSkillTool(func() string { return t.TempDir() })
	_, err := tool.Execute(context.Background(), "not json")
	assert.Error(t, err)
}

func TestSkillToolRegisteredInDiscoverTools(t *testing.T) {
	registry := DiscoverTools(config.Config{}, nil, nil, nil, false)
	_, ok := registry.Get("skill")
	assert.True(t, ok, "skill tool must be registered for the live orchestrator path")
}
