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

// This is the scenario that was silently broken before prompts were embedded:
// no env override, arbitrary cwd, no on-disk prompts directory reachable at
// runtime. It must still resolve real content from the compiled-in defaults.
func TestCorePromptProviderLoadsEmbeddedDefaults(t *testing.T) {
	t.Setenv("TASKFORCEAI_CORE_PROMPTS_DIR", "")
	t.Setenv("TASKFORCEAI_PROMPTS_DIR", "")

	provider := NewPromptProviderFromEnv()

	assert.NotEmpty(t, provider.RolePrompt("Researcher"))
	assert.NotEmpty(t, provider.ToolPrompt("websearch"))
	assert.NotEmpty(t, provider.SystemPromptOverride())
	assert.NotEmpty(t, provider.QuestionGenerationPromptOverride())
	assert.NotEmpty(t, provider.SynthesisPromptOverride())
	assert.NotEmpty(t, provider.ModelSystemPromptOverride("zai/glm-5.2"))
	assert.NotEmpty(t, provider.CompactionPrompt())

	systemPrompt := provider.SystemPrompt(enginecore.ProviderModel{})
	require.Len(t, systemPrompt, 1)
	assert.NotEmpty(t, systemPrompt[0])

	assert.Zero(t, provider.PromptOverridesFingerprint())
	assert.Empty(t, provider.RolePrompt("Missing"))
	assert.Empty(t, provider.ModelSystemPromptOverride("no/such-model"))
}

func TestCorePromptProviderOverrideBeatsEmbedded(t *testing.T) {
	root := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(root, "system_prompt.txt"), []byte(" overridden system prompt "), 0o600))

	t.Setenv("TASKFORCEAI_CORE_PROMPTS_DIR", root)
	provider := NewPromptProviderFromEnv()

	assert.Equal(t, root, provider.overrideRoot)
	assert.Equal(t, "overridden system prompt", provider.SystemPromptOverride())
	// Anything not present in the override directory still falls back to the
	// embedded default rather than going empty.
	assert.NotEmpty(t, provider.ToolPrompt("websearch"))
	assert.NotEmpty(t, provider.RolePrompt("Researcher"))
	assert.NotZero(t, provider.PromptOverridesFingerprint())
}

func TestCorePromptProviderEmptyAndNilBranches(t *testing.T) {
	var nilProvider *corePromptProvider
	assert.Empty(t, nilProvider.RolePrompt("Researcher"))
	assert.Empty(t, nilProvider.RolePrompt(""))
	assert.Empty(t, nilProvider.ToolPrompt("websearch"))
	assert.Empty(t, nilProvider.SystemPrompt(enginecore.ProviderModel{}))
	assert.Empty(t, nilProvider.CompactionPrompt())
	assert.Empty(t, nilProvider.SystemPromptOverride())
	assert.Empty(t, nilProvider.QuestionGenerationPromptOverride())
	assert.Empty(t, nilProvider.SynthesisPromptOverride())
	assert.Empty(t, nilProvider.ModelSystemPromptOverride("model/a"))
	assert.Zero(t, nilProvider.PromptOverridesFingerprint())
	assert.Empty(t, nilProvider.SoulContent())

	// A provider with no override configured still resolves embedded
	// defaults rather than going empty (there's no "missing prompts" state
	// for the built-in set anymore).
	emptyProvider := &corePromptProvider{}
	assert.Empty(t, emptyProvider.ModelSystemPromptOverride(" "))
	assert.Empty(t, emptyProvider.ToolPrompt(""))
	assert.NotEmpty(t, emptyProvider.RolePrompt("Researcher"))
	assert.NotEmpty(t, emptyProvider.ToolPrompt("websearch"))
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

func TestCorePromptProviderReadDiskPromptCache(t *testing.T) {
	provider := &corePromptProvider{}
	provider.cache.Store("cached", "from cache")
	assert.Equal(t, "from cache", provider.readDiskPrompt("cached", filepath.Join(t.TempDir(), "missing.txt")))

	path := filepath.Join(t.TempDir(), "prompt.txt")
	require.NoError(t, os.WriteFile(path, []byte("from file"), 0o600))
	provider.cache.Store("bad-cache-type", 123)
	assert.Equal(t, "from file", provider.readDiskPrompt("bad-cache-type", path))

	assert.Empty(t, provider.readDiskPrompt("missing-key", filepath.Join(t.TempDir(), "missing.txt")))
}

func TestCorePromptProviderReadRawPromptFallsBackToEmbedded(t *testing.T) {
	provider := &corePromptProvider{}
	text := provider.readRawPrompt("raw-embedded", filepath.Join("session", "prompt", "beast.txt"))
	assert.NotEmpty(t, text)
	// Cached on the second call.
	assert.Equal(t, text, provider.readRawPrompt("raw-embedded", filepath.Join("session", "prompt", "beast.txt")))
}

func TestCorePromptProviderPromptCachesAndMissingSystemPrompt(t *testing.T) {
	provider := &corePromptProvider{}
	provider.cache.Store("trimmed", " cached prompt ")
	assert.Equal(t, " cached prompt ", provider.readTrimmedPrompt("trimmed", "missing.txt"))

	provider.cache.Store("trimmed-bad-type", 42)
	assert.Empty(t, provider.readTrimmedPrompt("trimmed-bad-type", "missing.txt"))

	provider.cache.Store("raw", " cached raw prompt ")
	assert.Equal(t, " cached raw prompt ", provider.readRawPrompt("raw", "missing.txt"))

	provider.cache.Store("raw-bad-type", 42)
	assert.Empty(t, provider.readRawPrompt("raw-bad-type", "missing.txt"))

	provider.cache.Store("engine-system", "")
	assert.Empty(t, provider.SystemPrompt(enginecore.ProviderModel{}))

	overrideRoot := t.TempDir()
	systemPath := filepath.Join(overrideRoot, "session", "prompt", "beast.txt")
	require.NoError(t, os.MkdirAll(filepath.Dir(systemPath), 0o750))
	require.NoError(t, os.WriteFile(systemPath, []byte(" raw override \n"), 0o600))
	rawProvider := &corePromptProvider{overrideRoot: overrideRoot}
	assert.Equal(t, []string{" raw override \n"}, rawProvider.SystemPrompt(enginecore.ProviderModel{}))
}

func TestCorePromptProviderSystemPromptEnvironmentIncludesSkills(t *testing.T) {
	dir := t.TempDir()
	skillDir := filepath.Join(dir, ".taskforceai", "skills", "review")
	require.NoError(t, os.MkdirAll(skillDir, 0o750))
	require.NoError(t, os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte("---\nname: review\ndescription: Review code\n---\n"), 0o600))

	prompt := (&corePromptProvider{}).SystemPromptEnvironment(enginecore.ProviderModel{}, dir, 10)
	require.Len(t, prompt, 1)
	assert.Contains(t, prompt[0], "review")
}

func TestNewPromptProviderFromEnvReturnsProvider(t *testing.T) {
	assert.NotNil(t, NewPromptProviderFromEnv())
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
	assert.Equal(t, root, provider.overrideRoot)
	assert.Equal(t, "legacy prompt", provider.SystemPromptOverride())
}

func TestCorePromptProviderLoadsSoulFromRepoRoot(t *testing.T) {
	repoRoot := t.TempDir()
	overrideRoot := filepath.Join(repoRoot, "packages", "core", "go", "prompts")
	docsRoot := filepath.Join(repoRoot, "docs")
	require.NoError(t, os.MkdirAll(overrideRoot, 0o750))
	require.NoError(t, os.MkdirAll(docsRoot, 0o750))
	require.NoError(t, os.WriteFile(filepath.Join(docsRoot, "SOUL.txt"), []byte(" soul content "), 0o600))

	provider := &corePromptProvider{
		overrideRoot: overrideRoot,
		repoRoot:     resolveRepoRootFromOverrideRoot(overrideRoot),
	}

	assert.Equal(t, repoRoot, provider.repoRoot)
	assert.Equal(t, "soul content", provider.SoulContent())
}

func TestResolveRepoRootFromOverrideRoot(t *testing.T) {
	repoRoot := t.TempDir()
	promptsRoot := filepath.Join(repoRoot, "packages", "core", "go", "prompts")
	legacyPromptsRoot := filepath.Join(repoRoot, "packages", "core", "prompts")
	plainPromptsRoot := filepath.Join(repoRoot, "prompts")
	nonPromptRoot := filepath.Join(repoRoot, "packages", "core")

	assert.Equal(t, repoRoot, resolveRepoRootFromOverrideRoot(promptsRoot))
	assert.Equal(t, repoRoot, resolveRepoRootFromOverrideRoot(legacyPromptsRoot))
	assert.Equal(t, repoRoot, resolveRepoRootFromOverrideRoot(plainPromptsRoot))
	assert.Empty(t, resolveRepoRootFromOverrideRoot(nonPromptRoot))
	assert.Empty(t, resolveRepoRootFromOverrideRoot(""))
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
