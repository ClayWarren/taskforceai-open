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
	enginecoreutil "github.com/TaskForceAI/core/pkg/enginecore/util"
)

type corePromptProvider struct {
	promptsRoot string
	repoRoot    string
	cache       sync.Map
}

var (
	corePromptRuntimeCaller = runtime.Caller
	statCorePromptPath      = os.Stat
	getCorePromptWorkingDir = os.Getwd
	walkCorePromptTree      = filepath.WalkDir
	relCorePromptPath       = filepath.Rel
)

// NewPromptProviderFromEnv creates the engine-owned prompt provider.
func NewPromptProviderFromEnv() *corePromptProvider {
	promptsRoot := resolveCorePromptsRootFromEnv()
	return &corePromptProvider{
		promptsRoot: promptsRoot,
		repoRoot:    resolveRepoRootFromPromptsRoot(promptsRoot),
	}
}

func (p *corePromptProvider) RolePrompt(name string) string {
	if name == "" || p == nil || p.promptsRoot == "" {
		return ""
	}
	return p.readTrimmedPrompt("role:"+name, filepath.Join(p.promptsRoot, "orchestrator", "roles", name+".txt"))
}

func (p *corePromptProvider) ToolPrompt(name string) string {
	if name == "" || p == nil || p.promptsRoot == "" {
		return ""
	}
	return p.readTrimmedPrompt("tool:"+name, filepath.Join(p.promptsRoot, "tool", name+".txt"))
}

func (p *corePromptProvider) SystemPrompt(enginecore.ProviderModel) []string {
	if p == nil || p.promptsRoot == "" {
		return nil
	}
	text := p.readRawPrompt("engine-system", filepath.Join(p.promptsRoot, "session", "prompt", "beast.txt"))
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
	return []string{strings.Join(lines, "\n")}
}

func (p *corePromptProvider) SystemPromptOverride() string {
	if p == nil || p.promptsRoot == "" {
		return ""
	}
	return p.readTrimmedPrompt("config-system", filepath.Join(p.promptsRoot, "system_prompt.txt"))
}

func (p *corePromptProvider) QuestionGenerationPromptOverride() string {
	if p == nil || p.promptsRoot == "" {
		return ""
	}
	return p.readTrimmedPrompt("config-question-generation", filepath.Join(p.promptsRoot, "orchestrator", "question_generation.txt"))
}

func (p *corePromptProvider) SynthesisPromptOverride() string {
	if p == nil || p.promptsRoot == "" {
		return ""
	}
	return p.readTrimmedPrompt("config-synthesis", filepath.Join(p.promptsRoot, "orchestrator", "synthesis.txt"))
}

func (p *corePromptProvider) ModelSystemPromptOverride(modelID string) string {
	if p == nil || p.promptsRoot == "" || strings.TrimSpace(modelID) == "" {
		return ""
	}
	name := strings.NewReplacer("/", "_", ":", "_").Replace(strings.TrimSpace(modelID))
	return p.readTrimmedPrompt("config-model:"+name, filepath.Join(p.promptsRoot, "models", name+".txt"))
}

func (p *corePromptProvider) PromptOverridesFingerprint() uint64 {
	if p == nil {
		return 0
	}
	return promptTreeFingerprint(p.promptsRoot)
}

func (p *corePromptProvider) SoulContent() string {
	if p == nil {
		return ""
	}
	for _, candidate := range p.soulCandidates() {
		if text := p.readTrimmedPrompt("soul:"+candidate, candidate); text != "" {
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

func (p *corePromptProvider) readTrimmedPrompt(cacheKey, path string) string {
	return strings.TrimSpace(p.readRawPrompt(cacheKey, path))
}

func (p *corePromptProvider) readRawPrompt(cacheKey, path string) string {
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

func resolveCorePromptsRootFromEnv() string {
	for _, key := range []string{"TASKFORCEAI_CORE_PROMPTS_DIR", "TASKFORCEAI_PROMPTS_DIR"} {
		if override := strings.TrimSpace(os.Getenv(key)); override != "" {
			return filepath.Clean(override)
		}
	}

	if _, file, _, ok := corePromptRuntimeCaller(0); ok {
		pkgDir := filepath.Dir(file)
		candidates := []string{
			filepath.Clean(filepath.Join(pkgDir, "..", "..", "..", "..", "packages", "core", "prompts")),
			filepath.Clean(filepath.Join(pkgDir, "..", "..", "..", "..", "..", "packages", "core", "prompts")),
		}
		for _, candidate := range candidates {
			if info, err := statCorePromptPath(candidate); err == nil && info.IsDir() {
				return candidate
			}
		}
	}

	if cwd, err := getCorePromptWorkingDir(); err == nil {
		candidates := []string{
			filepath.Clean(filepath.Join(cwd, "packages", "core", "prompts")),
			filepath.Clean(filepath.Join(cwd, "prompts")),
		}
		for _, candidate := range candidates {
			if info, err := statCorePromptPath(candidate); err == nil && info.IsDir() {
				return candidate
			}
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

func resolveRepoRootFromPromptsRoot(promptsRoot string) string {
	if promptsRoot == "" {
		return ""
	}
	clean := filepath.Clean(promptsRoot)
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
