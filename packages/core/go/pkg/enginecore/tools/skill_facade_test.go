package tools

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSkillToolBranches(t *testing.T) {
	cwd := t.TempDir()
	ctx := protocol.ToolContext{Cwd: cwd}

	missingName := toolSkill(ctx, map[string]any{})
	assert.Equal(t, "error", missingName.Status)

	missing := toolSkill(ctx, map[string]any{"name": "missing"})
	assert.Equal(t, "error", missing.Status)
	assert.NotContains(t, missing.Error, "Available Skills")

	skillDir := filepath.Join(cwd, ".taskforceai", "skills", "review")
	require.NoError(t, os.MkdirAll(skillDir, 0o750))
	require.NoError(t, os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte("---\nname: review\ndescription: Review code\n---\nInspect the diff."), 0o600))

	missing = toolSkill(ctx, map[string]any{"name": "other"})
	assert.Contains(t, missing.Error, "Available Skills")

	result := toolSkill(ctx, map[string]any{"name": "review"})
	assert.Equal(t, "completed", result.Status)
	assert.Equal(t, "review", result.Title)
	assert.Contains(t, result.Output, "Inspect the diff")
}
