package run

import (
	"os"
	"path/filepath"
	"testing"

	enginecore "github.com/TaskForceAI/core/pkg/enginecore/core"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEnginecoreEnvInstructionContextSourceUsesEnv(t *testing.T) {
	configDir := t.TempDir()
	t.Setenv("TASKFORCEAI_CORE_CONFIG_DIR", configDir)
	t.Setenv("TASKFORCEAI_CORE_DISABLE_PROJECT_CONFIG", "yes")
	t.Setenv("TASKFORCEAI_CORE_DISABLE_CLAUDE_CODE_PROMPT", "true")

	context := (enginecoreEnvInstructionSource{}).InstructionContext()
	assert.Equal(t, configDir, context.ConfigDir)
	assert.True(t, context.DisableProject)
	assert.True(t, context.DisableClaude)
	assert.NotEmpty(t, context.HomeDir)
	assert.NotEmpty(t, context.UserConfigDir)
}

func TestEnginecoreEnvTruthy(t *testing.T) {
	t.Setenv("YES_VALUE", "yes")
	t.Setenv("TRUE_VALUE", "true")
	t.Setenv("ONE_VALUE", "1")
	t.Setenv("NO_VALUE", "no")

	assert.True(t, envTruthy("YES_VALUE"))
	assert.True(t, envTruthy("TRUE_VALUE"))
	assert.True(t, envTruthy("ONE_VALUE"))
	assert.False(t, envTruthy("NO_VALUE"))
	assert.False(t, envTruthy("MISSING_VALUE"))
}

func TestEnginecoreInstructionSourceSystemPaths(t *testing.T) {
	source := enginecoreEnvInstructionSource{}
	root := t.TempDir()
	nested := filepath.Join(root, "nested", "deep")
	require.NoError(t, os.MkdirAll(nested, 0o750))
	rootAgents := filepath.Join(root, "AGENTS.md")
	require.NoError(t, os.WriteFile(rootAgents, []byte("root agents"), 0o600))

	configDir := filepath.Join(root, "config")
	require.NoError(t, os.MkdirAll(configDir, 0o750))
	configAgents := filepath.Join(configDir, "AGENTS.md")
	configLocal := filepath.Join(configDir, "LOCAL.md")
	require.NoError(t, os.WriteFile(configAgents, []byte("config agents"), 0o600))
	require.NoError(t, os.WriteFile(configLocal, []byte("config local"), 0o600))
	absolute := filepath.Join(root, "absolute.md")
	require.NoError(t, os.WriteFile(absolute, []byte("absolute"), 0o600))

	projectPaths := source.SystemPaths(enginecore.InstructionFileRequest{
		RootDir:   nested,
		FileNames: []string{"AGENTS.md", "CLAUDE.md", "CONTEXT.md"},
	})
	assert.Contains(t, projectPaths, rootAgents)

	configPaths := source.SystemPaths(enginecore.InstructionFileRequest{
		ConfigDir:              configDir,
		DisableProject:         true,
		DisableClaude:          true,
		FileNames:              []string{"AGENTS.md", "CLAUDE.md", "CONTEXT.md"},
		ConfiguredInstructions: []string{"LOCAL.md", filepath.ToSlash(absolute), "https://example.com/skip.md"},
	})
	assert.Contains(t, configPaths, configAgents)
	assert.Contains(t, configPaths, configLocal)
	assert.Contains(t, configPaths, absolute)
}

func TestEnginecoreInstructionSourceResolvePaths(t *testing.T) {
	source := enginecoreEnvInstructionSource{}
	root := t.TempDir()
	nested := filepath.Join(root, "nested", "deep")
	require.NoError(t, os.MkdirAll(nested, 0o750))
	rootAgents := filepath.Join(root, "AGENTS.md")
	nestedContext := filepath.Join(root, "nested", "CONTEXT.md")
	require.NoError(t, os.WriteFile(rootAgents, []byte("root agents"), 0o600))
	require.NoError(t, os.WriteFile(nestedContext, []byte("nested context"), 0o600))

	request := enginecore.InstructionFileRequest{
		RootDir:   root,
		FileNames: []string{"AGENTS.md", "CLAUDE.md", "CONTEXT.md"},
	}
	candidates := source.ResolvePaths(filepath.Join(nested, "file.txt"), []string{rootAgents}, request)
	require.Len(t, candidates, 1)
	assert.Equal(t, nestedContext, candidates[0].Path)
	assert.True(t, candidates[0].Claim)

	direct := source.ResolvePaths(rootAgents, []string{rootAgents}, request)
	require.Len(t, direct, 1)
	assert.Equal(t, rootAgents, direct[0].Path)
	assert.False(t, direct[0].Claim)

	assert.Nil(t, source.ResolvePaths(filepath.Join(root, "other", "file.txt"), nil, request))
	assert.Nil(t, source.ResolvePaths(filepath.Join(root, "file.txt"), nil, enginecore.InstructionFileRequest{FileNames: []string{"AGENTS.md"}}))
}

func TestEnginecoreInstructionSourceReadFileAndHelpers(t *testing.T) {
	source := enginecoreEnvInstructionSource{}
	dir := t.TempDir()
	path := filepath.Join(dir, "AGENTS.md")
	require.NoError(t, os.WriteFile(path, []byte("content"), 0o600))

	content, ok := source.ReadFile(path)
	assert.True(t, ok)
	assert.Equal(t, "content", content)

	_, ok = source.ReadFile(filepath.Join(dir, "missing.md"))
	assert.False(t, ok)
	assert.Equal(t, filepath.Join("/user/config", "taskforceai"), instructionConfigDir(enginecore.InstructionFileRequest{UserConfigDir: "/user/config"}))
	assert.Equal(t, "/context/config", instructionConfigDir(enginecore.InstructionFileRequest{ContextConfigDir: "/context/config"}))
	assert.True(t, isInstructionURL("https://example.com/AGENTS.md"))
	assert.False(t, isInstructionURL("AGENTS.md"))
}

func TestEnginecoreInstructionSourceHelperBranches(t *testing.T) {
	root := t.TempDir()
	child := filepath.Join(root, "child")
	require.NoError(t, os.MkdirAll(child, 0o750))
	home := filepath.Join(root, "home")
	contextDir := filepath.Join(root, "context")
	require.NoError(t, os.MkdirAll(filepath.Join(home, ".claude"), 0o750))
	require.NoError(t, os.MkdirAll(contextDir, 0o750))
	claudePath := filepath.Join(home, ".claude", "CLAUDE.md")
	contextAgents := filepath.Join(contextDir, "AGENTS.md")
	require.NoError(t, os.WriteFile(claudePath, []byte("claude"), 0o600))
	require.NoError(t, os.WriteFile(contextAgents, []byte("context"), 0o600))

	files := globalInstructionFiles(enginecore.InstructionFileRequest{
		HomeDir:          home,
		ContextConfigDir: contextDir,
	}, "")
	assert.Contains(t, files, claudePath)
	assert.Contains(t, files, contextAgents)

	path, ok := configuredInstructionPath("~/local.md", home)
	require.True(t, ok)
	assert.Equal(t, filepath.Join(home, "local.md"), path)

	_, ok = configuredInstructionPath("", home)
	assert.False(t, ok)
	_, ok = configuredInstructionPath("https://example.com/AGENTS.md", home)
	assert.False(t, ok)

	base, searchRoot, ok := instructionSearchRoots(enginecore.InstructionFileRequest{}, "", root, child)
	require.True(t, ok)
	assert.Equal(t, root, base)
	assert.Equal(t, child, searchRoot)

	_, _, ok = instructionSearchRoots(enginecore.InstructionFileRequest{DisableProject: true}, "", root, child)
	assert.False(t, ok)

	base, searchRoot, ok = instructionSearchRoots(enginecore.InstructionFileRequest{DisableProject: true}, contextDir, root, child)
	require.True(t, ok)
	assert.Equal(t, contextDir, base)
	assert.Equal(t, contextDir, searchRoot)

	paths := map[string]struct{}{}
	addConfiguredInstructionPaths(paths, enginecore.InstructionFileRequest{
		DisableProject:         true,
		ConfiguredInstructions: []string{"LOCAL.md"},
	}, "", root, child)
	assert.Empty(t, paths)

	assert.Empty(t, findInstructionUp(child, "MISSING.md", root))
	assert.Empty(t, findInstructionUp("/", "MISSING.md", ""))

	configured := filepath.Join(child, "LOCAL.md")
	require.NoError(t, os.WriteFile(configured, []byte("local"), 0o600))
	matches := globInstructionUp("LOCAL.md", child, root)
	assert.Contains(t, matches, configured)

	originalGlob := globInstructionPattern
	globInstructionPattern = func(string) ([]string, error) {
		return []string{configured, configured}, nil
	}
	t.Cleanup(func() { globInstructionPattern = originalGlob })
	matches = globInstructionUp("ignored", child, child)
	assert.Equal(t, []string{configured}, matches)
	globInstructionPattern = originalGlob

	matches = globInstructionUp("LOCAL.md", "/", "")
	assert.Empty(t, matches)

	t.Chdir(child)
	content, err := readInstructionFileScoped("LOCAL.md")
	require.NoError(t, err)
	assert.Equal(t, []byte("local"), content)

	_, err = readInstructionFileScoped(string(filepath.Separator))
	require.ErrorContains(t, err, "path must reference a file")

	blocker := filepath.Join(root, "blocker")
	require.NoError(t, os.WriteFile(blocker, []byte("not a directory"), 0o600))
	_, err = readInstructionFileScoped(filepath.Join(blocker, "AGENTS.md"))
	require.Error(t, err)
}
