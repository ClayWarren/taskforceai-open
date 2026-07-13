package run

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	enginecore "github.com/TaskForceAI/core/pkg/enginecore/core"
	enginecoreutil "github.com/TaskForceAI/core/pkg/enginecore/util"
)

type enginecoreEnvInstructionSource struct{}

var globInstructionPattern = filepath.Glob

func installEnginecoreInstructionContextSource() {
	source := enginecoreEnvInstructionSource{}
	enginecore.SetInstructionContextSource(source)
	enginecore.SetInstructionFileSource(source)
}

func (enginecoreEnvInstructionSource) InstructionContext() enginecore.InstructionContext {
	context := enginecore.InstructionContext{
		ConfigDir:      os.Getenv("TASKFORCEAI_CORE_CONFIG_DIR"),
		DisableProject: envTruthy("TASKFORCEAI_CORE_DISABLE_PROJECT_CONFIG"),
		DisableClaude:  envTruthy("TASKFORCEAI_CORE_DISABLE_CLAUDE_CODE_PROMPT"),
	}
	if home, err := os.UserHomeDir(); err == nil {
		context.HomeDir = home
	}
	if dir, err := os.UserConfigDir(); err == nil {
		context.UserConfigDir = dir
	}
	return context
}

func (enginecoreEnvInstructionSource) SystemPaths(request enginecore.InstructionFileRequest) []string {
	paths := map[string]struct{}{}
	root := request.RootDir
	if root == "" {
		root = enginecoreutil.Directory()
	}
	worktree := enginecoreutil.Worktree()
	if !request.DisableProject {
		for _, name := range request.FileNames {
			if p := findInstructionUp(root, name, worktree); p != "" {
				paths[p] = struct{}{}
				break
			}
		}
	}

	configDir := instructionConfigDir(request)
	for _, p := range globalInstructionFiles(request, configDir) {
		if instructionFileExists(p) {
			paths[p] = struct{}{}
			break
		}
	}

	addConfiguredInstructionPaths(paths, request, configDir, root, worktree)

	out := make([]string, 0, len(paths))
	for p := range paths {
		out = append(out, p)
	}
	return out
}

func (enginecoreEnvInstructionSource) ResolvePaths(
	filePath string,
	systemPaths []string,
	request enginecore.InstructionFileRequest,
) []enginecore.InstructionFileCandidate {
	normalized := filepath.Clean(filePath)
	systemPathSet := map[string]struct{}{}
	for _, p := range systemPaths {
		systemPathSet[filepath.Clean(p)] = struct{}{}
	}
	if _, ok := systemPathSet[normalized]; ok {
		return []enginecore.InstructionFileCandidate{{Path: normalized}}
	}

	root := request.RootDir
	if root == "" {
		root = enginecoreutil.Directory()
	}
	root = filepath.Clean(root)
	current := filepath.Dir(normalized)
	for current != root && strings.HasPrefix(current, root) {
		found := findInstructionInDir(current, request.FileNames)
		if found != "" && found != normalized {
			clean := filepath.Clean(found)
			if _, ok := systemPathSet[clean]; !ok {
				return []enginecore.InstructionFileCandidate{{Path: clean, Claim: true}}
			}
		}
		parent := filepath.Dir(current)
		current = parent
	}
	return nil
}

func (enginecoreEnvInstructionSource) ReadFile(path string) (string, bool) {
	content, err := readInstructionFileScoped(path)
	if err != nil {
		return "", false
	}
	return string(content), true
}

func instructionConfigDir(request enginecore.InstructionFileRequest) string {
	if request.ConfigDir != "" {
		return request.ConfigDir
	}
	if request.ContextConfigDir != "" {
		return request.ContextConfigDir
	}
	if request.UserConfigDir != "" {
		return filepath.Join(request.UserConfigDir, "taskforceai")
	}
	return ""
}

func globalInstructionFiles(request enginecore.InstructionFileRequest, configDir string) []string {
	files := []string{}
	if configDir != "" {
		files = append(files, filepath.Join(configDir, "AGENTS.md"))
	}
	if !request.DisableClaude && request.HomeDir != "" {
		files = append(files, filepath.Join(request.HomeDir, ".claude", "CLAUDE.md"))
	}
	if request.ContextConfigDir != "" {
		files = append(files, filepath.Join(request.ContextConfigDir, "AGENTS.md"))
	}
	return files
}

func addConfiguredInstructionPaths(
	paths map[string]struct{},
	request enginecore.InstructionFileRequest,
	configDir string,
	root string,
	worktree string,
) {
	for _, instruction := range request.ConfiguredInstructions {
		path, ok := configuredInstructionPath(instruction, request.HomeDir)
		if !ok {
			continue
		}
		if filepath.IsAbs(path) {
			addInstructionGlobMatches(paths, path)
			continue
		}
		base, searchRoot, ok := instructionSearchRoots(request, configDir, root, worktree)
		if !ok {
			continue
		}
		for _, match := range globInstructionUp(path, base, searchRoot) {
			paths[filepath.Clean(match)] = struct{}{}
		}
	}
}

func configuredInstructionPath(instruction string, homeDir string) (string, bool) {
	if instruction == "" || isInstructionURL(instruction) {
		return "", false
	}
	path := instruction
	if after, ok := strings.CutPrefix(path, "~/"); ok && homeDir != "" {
		path = filepath.Join(homeDir, after)
	}
	return path, true
}

func instructionSearchRoots(
	request enginecore.InstructionFileRequest,
	configDir string,
	root string,
	worktree string,
) (string, string, bool) {
	if !request.DisableProject {
		return root, worktree, true
	}
	if configDir == "" {
		return "", "", false
	}
	return configDir, configDir, true
}

func addInstructionGlobMatches(paths map[string]struct{}, path string) {
	matches, _ := filepath.Glob(path)
	for _, match := range matches {
		paths[filepath.Clean(match)] = struct{}{}
	}
}

func findInstructionUp(dir, filename, root string) string {
	current := dir
	for {
		target := filepath.Join(current, filename)
		if instructionFileExists(target) {
			return target
		}
		if root != "" && filepath.Clean(current) == filepath.Clean(root) {
			break
		}
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		current = parent
	}
	return ""
}

func instructionFileExists(path string) bool {
	info, err := os.Stat(path)
	if err != nil || info == nil {
		return false
	}
	return !info.IsDir()
}

func globInstructionUp(pattern, start, root string) []string {
	results := []string{}
	seen := map[string]struct{}{}
	current := start
	for {
		matches, _ := globInstructionPattern(filepath.Join(current, pattern))
		for _, match := range matches {
			clean := filepath.Clean(match)
			if _, ok := seen[clean]; ok {
				continue
			}
			seen[clean] = struct{}{}
			results = append(results, clean)
		}
		if root != "" && filepath.Clean(current) == filepath.Clean(root) {
			break
		}
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		current = parent
	}
	return results
}

func findInstructionInDir(dir string, fileNames []string) string {
	for _, name := range fileNames {
		target := filepath.Join(dir, name)
		if instructionFileExists(target) {
			return target
		}
	}
	return ""
}

func isInstructionURL(value string) bool {
	return strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://")
}

func readInstructionFileScoped(path string) ([]byte, error) {
	cleanPath := filepath.Clean(path)
	dir, name := filepath.Split(cleanPath)
	if name == "" {
		return nil, fmt.Errorf("path must reference a file")
	}
	if dir == "" {
		dir = "."
	}

	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, err
	}
	defer root.Close()

	return root.ReadFile(name)
}

func envTruthy(key string) bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if value == "" {
		return false
	}
	return value == "1" || value == "true" || value == "yes"
}
