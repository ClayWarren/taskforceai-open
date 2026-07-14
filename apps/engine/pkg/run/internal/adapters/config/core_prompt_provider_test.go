package configadapter

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
	"time"

	enginecore "github.com/TaskForceAI/core/pkg/enginecore/core"
	enginecoreadapter "github.com/TaskForceAI/go-engine/pkg/run/internal/adapters/enginecore"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type errorPromptDirEntry struct{}

func (errorPromptDirEntry) Name() string               { return "bad" }
func (errorPromptDirEntry) IsDir() bool                { return false }
func (errorPromptDirEntry) Type() fs.FileMode          { return 0 }
func (errorPromptDirEntry) Info() (fs.FileInfo, error) { return nil, errors.New("info failed") }

func TestCorePromptProviderLoadsPromptsFromEnvRoot(t *testing.T) {
	root := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(root, "orchestrator", "roles"), 0o750))
	require.NoError(t, os.MkdirAll(filepath.Join(root, "orchestrator"), 0o750))
	require.NoError(t, os.MkdirAll(filepath.Join(root, "session", "prompt"), 0o750))
	require.NoError(t, os.MkdirAll(filepath.Join(root, "models"), 0o750))
	require.NoError(t, os.MkdirAll(filepath.Join(root, "tool"), 0o750))
	require.NoError(t, os.WriteFile(filepath.Join(root, "orchestrator", "roles", "Researcher.txt"), []byte(" role prompt "), 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(root, "orchestrator", "question_generation.txt"), []byte(" question prompt "), 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(root, "orchestrator", "synthesis.txt"), []byte(" synthesis prompt "), 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(root, "session", "prompt", "beast.txt"), []byte(" system prompt "), 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(root, "system_prompt.txt"), []byte(" config system prompt "), 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(root, "models", "model_a.txt"), []byte(" model prompt "), 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(root, "tool", "websearch.txt"), []byte(" tool prompt "), 0o600))

	t.Setenv("TASKFORCEAI_CORE_PROMPTS_DIR", root)
	provider := NewPromptProviderFromEnv()

	assert.Equal(t, root, provider.promptsRoot)
	assert.Equal(t, "role prompt", provider.RolePrompt("Researcher"))
	assert.Equal(t, []string{" system prompt "}, provider.SystemPrompt(enginecore.ProviderModel{}))
	assert.Equal(t, "config system prompt", provider.SystemPromptOverride())
	assert.Equal(t, "question prompt", provider.QuestionGenerationPromptOverride())
	assert.Equal(t, "synthesis prompt", provider.SynthesisPromptOverride())
	assert.Equal(t, "model prompt", provider.ModelSystemPromptOverride("model/a"))
	assert.Equal(t, "tool prompt", provider.ToolPrompt("websearch"))
	assert.NotZero(t, provider.PromptOverridesFingerprint())
	assert.Empty(t, provider.RolePrompt("Missing"))
}

func TestCorePromptProviderEmptyAndNilBranches(t *testing.T) {
	var nilProvider *corePromptProvider
	assert.Empty(t, nilProvider.RolePrompt("Researcher"))
	assert.Empty(t, nilProvider.RolePrompt(""))
	assert.Empty(t, nilProvider.SystemPrompt(enginecore.ProviderModel{}))
	assert.Empty(t, nilProvider.SystemPromptOverride())
	assert.Empty(t, nilProvider.QuestionGenerationPromptOverride())
	assert.Empty(t, nilProvider.SynthesisPromptOverride())
	assert.Empty(t, nilProvider.ModelSystemPromptOverride("model/a"))
	assert.Zero(t, nilProvider.PromptOverridesFingerprint())
	assert.Empty(t, nilProvider.SoulContent())

	emptyProvider := &corePromptProvider{}
	assert.Empty(t, emptyProvider.RolePrompt("Researcher"))
	assert.Empty(t, emptyProvider.ToolPrompt("websearch"))
	assert.Empty(t, emptyProvider.SystemPrompt(enginecore.ProviderModel{}))
	assert.Empty(t, emptyProvider.ModelSystemPromptOverride(" "))
	assert.Empty(t, emptyProvider.SoulContent())
}

func TestCorePromptProviderSystemPromptEnvironment(t *testing.T) {
	enginecoreadapter.InstallSources()
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "README.md"), []byte("hello"), 0o600))

	prompt := (&corePromptProvider{}).SystemPromptEnvironment(enginecore.ProviderModel{
		ProviderID: "openai",
		ModelID:    "gpt-5",
	}, dir, 10)

	require.Len(t, prompt, 1)
	assert.Contains(t, prompt[0], "openai/gpt-5")
	assert.Contains(t, prompt[0], "Working directory: "+dir)
	assert.Contains(t, prompt[0], "README.md")

	prompt = (&corePromptProvider{}).SystemPromptEnvironment(enginecore.ProviderModel{
		ProviderID: "openai",
		ModelID:    "gpt-5",
	}, "", 1)
	require.Len(t, prompt, 1)
	assert.Contains(t, prompt[0], "Working directory:")

	prompt = (&corePromptProvider{}).SystemPromptEnvironment(enginecore.ProviderModel{
		ProviderID: "openai",
		ModelID:    "gpt-5",
	}, filepath.Join(dir, "missing"), 1)
	require.Len(t, prompt, 1)
	assert.Contains(t, prompt[0], "<files>")
}

func TestCorePromptProviderSystemPromptEmptyWhenMissing(t *testing.T) {
	provider := &corePromptProvider{promptsRoot: t.TempDir()}
	assert.Empty(t, provider.SystemPrompt(enginecore.ProviderModel{}))
}

func TestCorePromptProviderReadRawPromptCache(t *testing.T) {
	provider := &corePromptProvider{}
	provider.cache.Store("cached", "from cache")
	assert.Equal(t, "from cache", provider.readRawPrompt("cached", filepath.Join(t.TempDir(), "missing.txt")))

	path := filepath.Join(t.TempDir(), "prompt.txt")
	require.NoError(t, os.WriteFile(path, []byte("from file"), 0o600))
	provider.cache.Store("bad-cache-type", 123)
	assert.Equal(t, "from file", provider.readRawPrompt("bad-cache-type", path))
}

func TestNewPromptProviderFromEnvReturnsProvider(t *testing.T) {
	assert.NotNil(t, NewPromptProviderFromEnv())
}

func TestResolveCorePromptsRootFallbacks(t *testing.T) {
	t.Setenv("TASKFORCEAI_CORE_PROMPTS_DIR", "")
	t.Setenv("TASKFORCEAI_PROMPTS_DIR", "")

	originalCaller := corePromptRuntimeCaller
	originalStat := statCorePromptPath
	originalGetwd := getCorePromptWorkingDir
	t.Cleanup(func() {
		corePromptRuntimeCaller = originalCaller
		statCorePromptPath = originalStat
		getCorePromptWorkingDir = originalGetwd
	})

	repoRoot := t.TempDir()
	promptsRoot := filepath.Join(repoRoot, "packages", "core", "prompts")
	require.NoError(t, os.MkdirAll(promptsRoot, 0o750))
	corePromptRuntimeCaller = func(int) (uintptr, string, int, bool) {
		return 0, filepath.Join(repoRoot, "apps", "engine", "pkg", "run", "core_prompt_provider.go"), 0, true
	}
	assert.Equal(t, promptsRoot, resolveCorePromptsRootFromEnv())

	cwd := t.TempDir()
	require.NoError(t, os.Mkdir(filepath.Join(cwd, "prompts"), 0o750))
	corePromptRuntimeCaller = func(int) (uintptr, string, int, bool) {
		return 0, "", 0, false
	}
	getCorePromptWorkingDir = func() (string, error) {
		return cwd, nil
	}
	assert.Equal(t, filepath.Join(cwd, "prompts"), resolveCorePromptsRootFromEnv())

	getCorePromptWorkingDir = func() (string, error) {
		return "", errors.New("getwd failed")
	}
	assert.Empty(t, resolveCorePromptsRootFromEnv())
}

func TestPromptTreeFingerprintErrorBranches(t *testing.T) {
	root := t.TempDir()

	originalStat := statCorePromptPath
	originalWalk := walkCorePromptTree
	originalRel := relCorePromptPath
	t.Cleanup(func() {
		statCorePromptPath = originalStat
		walkCorePromptTree = originalWalk
		relCorePromptPath = originalRel
	})

	statCorePromptPath = func(string) (os.FileInfo, error) {
		return nil, errors.New("stat failed")
	}
	assert.Zero(t, promptTreeFingerprint(root))

	statCorePromptPath = originalStat
	walkCorePromptTree = func(root string, fn fs.WalkDirFunc) error {
		return fn(filepath.Join(root, "bad"), errorPromptDirEntry{}, nil)
	}
	assert.Zero(t, promptTreeFingerprint(root))

	walkCorePromptTree = func(root string, fn fs.WalkDirFunc) error {
		info, err := os.Stat(root)
		require.NoError(t, err)
		return fn(root, fs.FileInfoToDirEntry(info), errors.New("walk failed"))
	}
	assert.Zero(t, promptTreeFingerprint(root))

	walkCorePromptTree = originalWalk
	relCorePromptPath = func(string, string) (string, error) {
		return "", errors.New("rel failed")
	}
	assert.NotZero(t, promptTreeFingerprint(root))
}

func TestCorePromptProviderLoadsLegacyPromptEnvRoot(t *testing.T) {
	root := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(root, "system_prompt.txt"), []byte(" legacy prompt "), 0o600))

	t.Setenv("TASKFORCEAI_CORE_PROMPTS_DIR", "")
	t.Setenv("TASKFORCEAI_PROMPTS_DIR", root)

	provider := NewPromptProviderFromEnv()
	assert.Equal(t, root, provider.promptsRoot)
	assert.Equal(t, "legacy prompt", provider.SystemPromptOverride())
}

func TestCorePromptProviderLoadsSoulFromRepoRoot(t *testing.T) {
	repoRoot := t.TempDir()
	promptsRoot := filepath.Join(repoRoot, "packages", "core", "prompts")
	docsRoot := filepath.Join(repoRoot, "docs")
	require.NoError(t, os.MkdirAll(promptsRoot, 0o750))
	require.NoError(t, os.MkdirAll(docsRoot, 0o750))
	require.NoError(t, os.WriteFile(filepath.Join(docsRoot, "SOUL.txt"), []byte(" soul content "), 0o600))

	provider := &corePromptProvider{
		promptsRoot: promptsRoot,
		repoRoot:    resolveRepoRootFromPromptsRoot(promptsRoot),
	}

	assert.Equal(t, repoRoot, provider.repoRoot)
	assert.Equal(t, "soul content", provider.SoulContent())
}

func TestResolveRepoRootFromPromptsRoot(t *testing.T) {
	repoRoot := t.TempDir()
	promptsRoot := filepath.Join(repoRoot, "packages", "core", "prompts")
	plainPromptsRoot := filepath.Join(repoRoot, "prompts")
	nonPromptRoot := filepath.Join(repoRoot, "packages", "core")

	assert.Equal(t, repoRoot, resolveRepoRootFromPromptsRoot(promptsRoot))
	assert.Equal(t, repoRoot, resolveRepoRootFromPromptsRoot(plainPromptsRoot))
	assert.Empty(t, resolveRepoRootFromPromptsRoot(nonPromptRoot))
}

func TestPromptTreeFingerprintTracksPromptChanges(t *testing.T) {
	root := t.TempDir()
	promptPath := filepath.Join(root, "system_prompt.txt")
	require.NoError(t, os.WriteFile(promptPath, []byte("first"), 0o600))

	first := promptTreeFingerprint(root)
	require.NotZero(t, first)

	require.NoError(t, os.WriteFile(promptPath, []byte("second"), 0o600))
	now := time.Now().Add(2 * time.Second)
	require.NoError(t, os.Chtimes(promptPath, now, now))

	assert.NotEqual(t, first, promptTreeFingerprint(root))
	assert.Zero(t, promptTreeFingerprint(""))
	assert.Zero(t, promptTreeFingerprint(filepath.Join(root, "missing")))
}
