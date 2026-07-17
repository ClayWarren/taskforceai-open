package skill

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func writeSkill(t *testing.T, cwd, dir, content string) {
	t.Helper()
	full := filepath.Join(cwd, ".taskforceai", "skills", dir)
	require.NoError(t, os.MkdirAll(full, 0o750))
	require.NoError(t, os.WriteFile(filepath.Join(full, "SKILL.md"), []byte(content), 0o600))
}

const validSkill = `---
name: deploy
description: Deploy the app to production
---

## Steps
1. Run the tests
2. Ship it
`

func TestDiscoverFindsAndSortsSkills(t *testing.T) {
	cwd := t.TempDir()
	writeSkill(t, cwd, "zeta", "---\nname: zeta\ndescription: last\n---\nbody z")
	writeSkill(t, cwd, "deploy", validSkill)
	writeSkill(t, cwd, "nested/inner", "---\nname: alpha\ndescription: first\n---\nbody a")

	skills := Discover(cwd)
	require.Len(t, skills, 3)
	assert.Equal(t, "alpha", skills[0].Name)
	assert.Equal(t, "deploy", skills[1].Name)
	assert.Equal(t, "Deploy the app to production", skills[1].Description)
	assert.Equal(t, "zeta", skills[2].Name)
}

func TestDiscoverSkipsMalformedAndMissing(t *testing.T) {
	assert.Empty(t, Discover(t.TempDir()), "missing skills dir yields no skills, no error")

	cwd := t.TempDir()
	writeSkill(t, cwd, "no-frontmatter", "just a plain file")
	writeSkill(t, cwd, "no-name", "---\ndescription: nameless\n---\nbody")
	writeSkill(t, cwd, "good", validSkill)
	skills := Discover(cwd)
	require.Len(t, skills, 1)
	assert.Equal(t, "deploy", skills[0].Name)
}

func TestLoadReturnsBody(t *testing.T) {
	cwd := t.TempDir()
	writeSkill(t, cwd, "deploy", validSkill)

	body, err := Load(cwd, "deploy")
	require.NoError(t, err)
	assert.Contains(t, body, "## Steps")
	assert.Contains(t, body, "Ship it")
	assert.NotContains(t, body, "description:", "frontmatter must be stripped from the body")
}

func TestLoadErrors(t *testing.T) {
	cwd := t.TempDir()
	writeSkill(t, cwd, "deploy", validSkill)

	_, err := Load(cwd, "missing")
	require.ErrorContains(t, err, "not found")
	_, err = Load(cwd, "  ")
	require.ErrorContains(t, err, "required")
}

func TestFormatAvailable(t *testing.T) {
	assert.Empty(t, FormatAvailable(nil))

	out := FormatAvailable([]Info{{Name: "deploy", Description: "Deploy the app"}})
	assert.Contains(t, out, "## Available Skills")
	assert.Contains(t, out, "**deploy**: Deploy the app")
}

func TestReadSkillFileHandlesCRLFAndUnterminated(t *testing.T) {
	cwd := t.TempDir()
	writeSkill(t, cwd, "crlf", "---\r\nname: crlf\r\ndescription: windows\r\n---\r\nbody line")
	skills := Discover(cwd)
	require.Len(t, skills, 1)
	body, err := Load(cwd, "crlf")
	require.NoError(t, err)
	assert.Equal(t, "body line", body)

	writeSkill(t, cwd, "unterminated", "---\nname: broken")
	assert.Len(t, Discover(cwd), 1, "unterminated frontmatter is skipped")
}

func TestReadSkillFileErrors(t *testing.T) {
	_, _, err := readSkillFile(filepath.Join(t.TempDir(), "missing.md"))
	require.Error(t, err)

	path := filepath.Join(t.TempDir(), "SKILL.md")
	require.NoError(t, os.WriteFile(path, []byte("---\nname: [invalid\n---\nbody"), 0o600))
	_, _, err = readSkillFile(path)
	require.ErrorContains(t, err, "invalid frontmatter")
}

func TestLoadPropagatesSecondReadFailure(t *testing.T) {
	cwd := t.TempDir()
	writeSkill(t, cwd, "deploy", validSkill)

	original := readSkillDefinition
	calls := 0
	readSkillDefinition = func(path string) (frontmatter, string, error) {
		calls++
		if calls == 2 {
			return frontmatter{}, "", errors.New("second read failed")
		}
		return readSkillFile(path)
	}
	t.Cleanup(func() { readSkillDefinition = original })

	_, err := Load(cwd, "deploy")
	require.ErrorContains(t, err, "second read failed")
}
