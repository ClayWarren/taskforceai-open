package core

import (
	"strings"
	"sync"

	"github.com/TaskForceAI/core/internal/runtimevalue"
	"github.com/TaskForceAI/core/pkg/enginecore/config"
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
)

var instructionFiles = []string{
	"AGENTS.md",
	"CLAUDE.md",
	"CONTEXT.md",
}

type InstructionLoader struct {
	RootDir        string
	ConfigDir      string
	DisableProject bool
	DisableClaude  bool
}

type InstructionContext struct {
	ConfigDir      string
	HomeDir        string
	UserConfigDir  string
	DisableProject bool
	DisableClaude  bool
}

type InstructionContextSource interface {
	InstructionContext() InstructionContext
}

type InstructionContextSourceFunc func() InstructionContext

func (f InstructionContextSourceFunc) InstructionContext() InstructionContext {
	if f == nil {
		return InstructionContext{}
	}
	return f()
}

type emptyInstructionContextSource struct{}

func (emptyInstructionContextSource) InstructionContext() InstructionContext {
	return InstructionContext{}
}

type InstructionFileRequest struct {
	RootDir                string
	ConfigDir              string
	ContextConfigDir       string
	HomeDir                string
	UserConfigDir          string
	DisableProject         bool
	DisableClaude          bool
	FileNames              []string
	ConfiguredInstructions []string
}

type InstructionFileCandidate struct {
	Path  string
	Claim bool
}

type InstructionFileSource interface {
	SystemPaths(request InstructionFileRequest) []string
	ResolvePaths(filePath string, systemPaths []string, request InstructionFileRequest) []InstructionFileCandidate
	ReadFile(path string) (string, bool)
}

type emptyInstructionFileSource struct{}

func (emptyInstructionFileSource) SystemPaths(InstructionFileRequest) []string {
	return nil
}

func (emptyInstructionFileSource) ResolvePaths(string, []string, InstructionFileRequest) []InstructionFileCandidate {
	return nil
}

func (emptyInstructionFileSource) ReadFile(string) (string, bool) {
	return "", false
}

var (
	instructionContextSources = runtimevalue.New[InstructionContextSource](emptyInstructionContextSource{})
	instructionFileSources    = runtimevalue.New[InstructionFileSource](emptyInstructionFileSource{})
)

func SetInstructionContextSource(source InstructionContextSource) func() {
	return instructionContextSources.Set(source)
}

func SetInstructionFileSource(source InstructionFileSource) func() {
	return instructionFileSources.Set(source)
}

func instructionContext() InstructionContext {
	return instructionContextSources.Current().InstructionContext()
}

func currentInstructionFileSource() InstructionFileSource {
	return instructionFileSources.Current()
}

func (l InstructionLoader) SystemPaths() []string {
	source := currentInstructionFileSource()
	paths := source.SystemPaths(l.fileRequest())
	return append([]string{}, paths...)
}

func (l InstructionLoader) System() []string {
	source := currentInstructionFileSource()
	out := []string{}
	for _, p := range l.SystemPaths() {
		if text, ok := instructionText(source, p); ok {
			out = append(out, "Instructions from: "+p+"\n"+text)
		}
	}
	return out
}

// Resolve returns any instruction payloads that should be appended to a read file output.
func (l InstructionLoader) Resolve(filePath string) []protocol.InstructionEntry {
	source := currentInstructionFileSource()
	paths := l.SystemPaths()
	if len(paths) == 0 {
		return nil
	}

	out := []protocol.InstructionEntry{}
	for _, candidate := range source.ResolvePaths(filePath, paths, l.fileRequest()) {
		if candidate.Path == "" {
			continue
		}
		if candidate.Claim && !claimInstruction(candidate.Path) {
			continue
		}
		if entry, ok := instructionEntry(source, candidate.Path); ok {
			out = append(out, entry)
			break
		}
	}
	return out
}

func (l InstructionLoader) fileRequest() InstructionFileRequest {
	context := instructionContext()
	request := InstructionFileRequest{
		RootDir:          l.RootDir,
		ConfigDir:        l.ConfigDir,
		ContextConfigDir: context.ConfigDir,
		HomeDir:          context.HomeDir,
		UserConfigDir:    context.UserConfigDir,
		DisableProject:   l.DisableProject || context.DisableProject,
		DisableClaude:    l.DisableClaude || context.DisableClaude,
		FileNames:        append([]string{}, instructionFiles...),
	}
	if cfg, _ := config.Get(); cfg != nil {
		request.ConfiguredInstructions = append([]string{}, cfg.Instructions...)
	}
	return request
}

func instructionEntry(source InstructionFileSource, path string) (protocol.InstructionEntry, bool) {
	text, ok := instructionText(source, path)
	if !ok {
		return protocol.InstructionEntry{}, false
	}
	return protocol.InstructionEntry{
		Path:    path,
		Content: "Instructions from: " + path + "\n" + text,
	}, true
}

func instructionText(source InstructionFileSource, path string) (string, bool) {
	content, ok := source.ReadFile(path)
	if !ok {
		return "", false
	}
	text := strings.TrimSpace(content)
	if text == "" {
		return "", false
	}
	return text, true
}

var instructionClaims sync.Map

func claimInstruction(path string) bool {
	_, loaded := instructionClaims.LoadOrStore(path, struct{}{})
	return !loaded
}
