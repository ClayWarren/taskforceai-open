package configadapter

import (
	"hash/fnv"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	coreconfig "github.com/TaskForceAI/core/pkg/config"
	enginecore "github.com/TaskForceAI/core/pkg/enginecore/core"
	"github.com/TaskForceAI/core/pkg/enginecore/skill"
	enginecoreutil "github.com/TaskForceAI/core/pkg/enginecore/util"
	corePrompts "github.com/TaskForceAI/core/prompts"
)

type corePromptProvider struct {
	// overrideRoot, when set, is checked before the embedded defaults so
	// prompts can be swapped without a rebuild (e.g. for local iteration).
	overrideRoot string
	repoRoot     string
	cache        sync.Map
}

var (
	statCorePromptPath = os.Stat
	walkCorePromptTree = filepath.WalkDir
	relCorePromptPath  = filepath.Rel
)

// NewPromptProviderFromEnv creates the engine-owned prompt provider. Built-in
// prompt content comes from the embedded corePrompts.FS; an optional
// TASKFORCEAI_CORE_PROMPTS_DIR/TASKFORCEAI_PROMPTS_DIR env var can override
// individual files on disk without requiring a rebuild.
func NewPromptProviderFromEnv() *corePromptProvider {
	overrideRoot := resolveCorePromptsOverrideFromEnv()
	return &corePromptProvider{
		overrideRoot: overrideRoot,
		repoRoot:     resolveRepoRootFromOverrideRoot(overrideRoot),
	}
}

func (p *corePromptProvider) RolePrompt(name string) string {
	if name == "" || p == nil {
		return ""
	}
	return p.readTrimmedPrompt("role:"+name, filepath.Join("orchestrator", "roles", name+".txt"))
}

func (p *corePromptProvider) ToolPrompt(name string) string {
	if name == "" || p == nil {
		return ""
	}
	return p.readTrimmedPrompt("tool:"+name, filepath.Join("tool", name+".txt"))
}

func (p *corePromptProvider) SystemPrompt(enginecore.ProviderModel) []string {
	if p == nil {
		return nil
	}
	text := p.readRawPrompt("engine-system", filepath.Join("session", "prompt", "beast.txt"))
	if text == "" {
		return nil
	}
	return []string{text}
}

func (p *corePromptProvider) SystemPromptEnvironment(model enginecore.ProviderModel, cwd string, limit int) []string {
	if cwd == "" {
		cwd = enginecoreutil.Directory()
	}
	tree, err := enginecoreutil.Tree(cwd, limit)
	if err != nil {
		tree = ""
	}
	lines := []string{
		"You are powered by the model named " + model.ModelID + ". The exact model ID is " + model.ProviderID + "/" + model.ModelID,
		"Here is some useful information about the environment you are running in:",
		"<env>",
		"  Working directory: " + cwd,
		"  Platform: " + runtime.GOOS,
		"  Today's date: " + time.Now().Format("Mon Jan 2 2006"),
		"</env>",
		"<files>",
	}
	if tree != "" {
		lines = append(lines, "  "+strings.ReplaceAll(tree, "\n", "\n  "))
	}
	lines = append(lines, "</files>")
	if available := skill.FormatAvailable(skill.Discover(cwd)); available != "" {
		lines = append(lines, "", available)
	}
	return []string{strings.Join(lines, "\n")}
}

func (p *corePromptProvider) CompactionPrompt() string {
	if p == nil {
		return ""
	}
	return p.readTrimmedPrompt("compaction", "compaction.txt")
}

func (p *corePromptProvider) SystemPromptOverride() string {
	if p == nil {
		return ""
	}
	return p.readTrimmedPrompt("config-system", "system_prompt.txt")
}

func (p *corePromptProvider) QuestionGenerationPromptOverride() string {
	if p == nil {
		return ""
	}
	return p.readTrimmedPrompt("config-question-generation", filepath.Join("orchestrator", "question_generation.txt"))
}

func (p *corePromptProvider) SynthesisPromptOverride() string {
	if p == nil {
		return ""
	}
	return p.readTrimmedPrompt("config-synthesis", filepath.Join("orchestrator", "synthesis.txt"))
}

func (p *corePromptProvider) ModelSystemPromptOverride(modelID string) string {
	if p == nil || strings.TrimSpace(modelID) == "" {
		return ""
	}
	name := strings.NewReplacer("/", "_", ":", "_").Replace(strings.TrimSpace(modelID))
	return p.readTrimmedPrompt("config-model:"+name, filepath.Join("models", name+".txt"))
}

func (p *corePromptProvider) PromptOverridesFingerprint() uint64 {
	if p == nil || p.overrideRoot == "" {
		// Embedded defaults are immutable within a build; only an active
		// override directory can change content at runtime.
		return 0
	}
	return promptTreeFingerprint(p.overrideRoot)
}

func (p *corePromptProvider) SoulContent() string {
	if p == nil {
		return ""
	}
	for _, candidate := range p.soulCandidates() {
		if text := strings.TrimSpace(p.readDiskPrompt("soul:"+candidate, candidate)); text != "" {
			return text
		}
	}
	return ""
}

func (p *corePromptProvider) soulCandidates() []string {
	var candidates []string
	if p.repoRoot != "" {
		candidates = append(candidates, filepath.Join(p.repoRoot, "docs", "SOUL.txt"))
	}
	if cwd, err := os.Getwd(); err == nil {
		candidates = append(candidates, filepath.Join(cwd, "docs", "SOUL.txt"))
	}
	return candidates
}

// readTrimmedPrompt resolves relPath against the override directory first
// (if configured), falling back to the embedded default.
func (p *corePromptProvider) readTrimmedPrompt(cacheKey, relPath string) string {
	if cached, ok := p.cache.Load(cacheKey); ok {
		if text, ok := cached.(string); ok {
			return text
		}
	}

	text := ""
	if p.overrideRoot != "" {
		text = strings.TrimSpace(p.readDiskPrompt(cacheKey+":override", filepath.Join(p.overrideRoot, relPath)))
	}
	if text == "" {
		data, err := corePrompts.FS.ReadFile(filepath.ToSlash(relPath))
		if err == nil {
			text = strings.TrimSpace(string(data))
		}
	}

	p.cache.Store(cacheKey, text)
	return text
}

// readRawPrompt is like readTrimmedPrompt but preserves surrounding
// whitespace, used for prompts injected verbatim (e.g. the system prompt).
func (p *corePromptProvider) readRawPrompt(cacheKey, relPath string) string {
	if cached, ok := p.cache.Load(cacheKey); ok {
		if text, ok := cached.(string); ok {
			return text
		}
	}

	text := ""
	if p.overrideRoot != "" {
		if diskText := p.readDiskPrompt(cacheKey+":override", filepath.Join(p.overrideRoot, relPath)); diskText != "" {
			text = diskText
		}
	}
	if text == "" {
		data, err := corePrompts.FS.ReadFile(filepath.ToSlash(relPath))
		if err == nil {
			text = string(data)
		}
	}

	p.cache.Store(cacheKey, text)
	return text
}

// readDiskPrompt reads an absolute path from disk (used for override files
// and for SoulContent, which is always a runtime, repo-relative file).
func (p *corePromptProvider) readDiskPrompt(cacheKey, path string) string {
	if cached, ok := p.cache.Load(cacheKey); ok {
		if text, ok := cached.(string); ok {
			return text
		}
	}
	data, err := os.ReadFile(filepath.Clean(path)) // #nosec G304 -- paths are resolved by the engine adapter.
	if err != nil {
		p.cache.Store(cacheKey, "")
		return ""
	}
	text := string(data)
	p.cache.Store(cacheKey, text)
	return text
}

func resolveCorePromptsOverrideFromEnv() string {
	for _, key := range []string{"TASKFORCEAI_CORE_PROMPTS_DIR", "TASKFORCEAI_PROMPTS_DIR"} {
		if override := strings.TrimSpace(os.Getenv(key)); override != "" {
			return filepath.Clean(override)
		}
	}
	return ""
}

func promptTreeFingerprint(root string) uint64 {
	if root == "" {
		return 0
	}
	info, err := statCorePromptPath(root)
	if err != nil || !info.IsDir() {
		return 0
	}

	hash := fnv.New64a()
	if err := walkCorePromptTree(root, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		entryInfo, err := d.Info()
		if err != nil {
			return err
		}
		rel, err := relCorePromptPath(root, path)
		if err != nil {
			rel = path
		}
		_, _ = hash.Write([]byte(rel))
		_, _ = hash.Write([]byte{0})
		_, _ = hash.Write([]byte(strconv.FormatInt(entryInfo.ModTime().UnixNano(), 10)))
		_, _ = hash.Write([]byte{0})
		_, _ = hash.Write([]byte(strconv.FormatInt(entryInfo.Size(), 10)))
		_, _ = hash.Write([]byte{0})
		return nil
	}); err != nil {
		return 0
	}
	return hash.Sum64()
}

// resolveRepoRootFromOverrideRoot lets SoulContent find docs/SOUL.txt
// relative to the repo when an override directory follows the conventional
// packages/core/go/prompts (or legacy packages/core/prompts) layout.
func resolveRepoRootFromOverrideRoot(overrideRoot string) string {
	if overrideRoot == "" {
		return ""
	}
	clean := filepath.Clean(overrideRoot)
	if filepath.Base(clean) == "prompts" &&
		filepath.Base(filepath.Dir(clean)) == "go" &&
		filepath.Base(filepath.Dir(filepath.Dir(clean))) == "core" &&
		filepath.Base(filepath.Dir(filepath.Dir(filepath.Dir(clean)))) == "packages" {
		return filepath.Dir(filepath.Dir(filepath.Dir(filepath.Dir(clean))))
	}
	if filepath.Base(clean) == "prompts" &&
		filepath.Base(filepath.Dir(clean)) == "core" &&
		filepath.Base(filepath.Dir(filepath.Dir(clean))) == "packages" {
		return filepath.Dir(filepath.Dir(filepath.Dir(clean)))
	}
	if filepath.Base(clean) == "prompts" {
		return filepath.Dir(clean)
	}
	return ""
}

var _ coreconfig.PromptOverrideProvider = (*corePromptProvider)(nil)
var _ enginecore.SystemEnvironmentSource = (*corePromptProvider)(nil)
var _ enginecore.SystemPromptSource = (*corePromptProvider)(nil)
