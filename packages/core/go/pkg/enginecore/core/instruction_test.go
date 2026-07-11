package core

import (
	"testing"

	enginecoreconfig "github.com/TaskForceAI/core/pkg/enginecore/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type testEnginecoreConfigSource struct {
	snapshot enginecoreconfig.ConfigSnapshot
	writable enginecoreconfig.ConfigDocument
	store    func([]byte) error
}

func (s testEnginecoreConfigSource) Load() (enginecoreconfig.ConfigSnapshot, error) {
	return s.snapshot, nil
}

func (s testEnginecoreConfigSource) LoadWritable() (enginecoreconfig.ConfigDocument, error) {
	return s.writable, nil
}

func (s testEnginecoreConfigSource) Store(data []byte) error {
	if s.store != nil {
		return s.store(data)
	}
	return enginecoreconfig.ErrConfigSourceUnavailable
}

type testInstructionFileSource struct {
	systemPaths []string
	resolved    map[string][]InstructionFileCandidate
	content     map[string]string
	requests    []InstructionFileRequest
}

func (s *testInstructionFileSource) SystemPaths(request InstructionFileRequest) []string {
	s.requests = append(s.requests, request)
	return append([]string{}, s.systemPaths...)
}

func (s *testInstructionFileSource) ResolvePaths(
	filePath string,
	_ []string,
	_ InstructionFileRequest,
) []InstructionFileCandidate {
	if s.resolved == nil {
		return nil
	}
	return append([]InstructionFileCandidate{}, s.resolved[filePath]...)
}

func (s *testInstructionFileSource) ReadFile(path string) (string, bool) {
	value, ok := s.content[path]
	return value, ok
}

func resetInstructionLoaderState(t *testing.T) {
	t.Helper()
	enginecoreconfig.Reset()
	SetInstructionContextSource(nil)
	SetInstructionFileSource(nil)
	instructionClaims.Range(func(key, value any) bool {
		instructionClaims.Delete(key)
		return true
	})
	t.Cleanup(func() {
		enginecoreconfig.Reset()
		SetInstructionContextSource(nil)
		SetInstructionFileSource(nil)
		instructionClaims.Range(func(key, value any) bool {
			instructionClaims.Delete(key)
			return true
		})
	})
}

func TestInstructionLoaderUsesInstructionFileSource(t *testing.T) {
	resetInstructionLoaderState(t)

	source := &testInstructionFileSource{
		systemPaths: []string{"/repo/AGENTS.md"},
		content: map[string]string{
			"/repo/AGENTS.md": " project instructions ",
		},
	}
	SetInstructionFileSource(source)

	loader := InstructionLoader{RootDir: "/repo"}
	paths := loader.SystemPaths()
	require.Equal(t, []string{"/repo/AGENTS.md"}, paths)

	paths[0] = "mutated"
	assert.Equal(t, []string{"/repo/AGENTS.md"}, loader.SystemPaths())

	assert.Equal(
		t,
		[]string{"Instructions from: /repo/AGENTS.md\nproject instructions"},
		loader.System(),
	)
}

func TestInstructionLoaderResolveUsesCandidatesAndClaims(t *testing.T) {
	resetInstructionLoaderState(t)

	source := &testInstructionFileSource{
		systemPaths: []string{"/repo/AGENTS.md"},
		resolved: map[string][]InstructionFileCandidate{
			"/repo/sub/file.txt": {{Path: "/repo/sub/CONTEXT.md", Claim: true}},
			"/repo/AGENTS.md":    {{Path: "/repo/AGENTS.md"}},
		},
		content: map[string]string{
			"/repo/sub/CONTEXT.md": "sub context",
			"/repo/AGENTS.md":      "root context",
		},
	}
	SetInstructionFileSource(source)

	loader := InstructionLoader{RootDir: "/repo"}
	first := loader.Resolve("/repo/sub/file.txt")
	require.Len(t, first, 1)
	assert.Equal(t, "/repo/sub/CONTEXT.md", first[0].Path)
	assert.Contains(t, first[0].Content, "sub context")

	assert.Empty(t, loader.Resolve("/repo/sub/file.txt"))

	direct := loader.Resolve("/repo/AGENTS.md")
	require.Len(t, direct, 1)
	assert.Equal(t, "/repo/AGENTS.md", direct[0].Path)
	assert.Contains(t, direct[0].Content, "root context")
}

func TestInstructionLoaderBuildsFileRequest(t *testing.T) {
	resetInstructionLoaderState(t)

	configJSON := `{"instructions":["LOCAL.md","https://example.com/skip.md"]}`
	restoreSource := enginecoreconfig.SetConfigSource(testEnginecoreConfigSource{
		snapshot: enginecoreconfig.ConfigSnapshot{
			Documents: []enginecoreconfig.ConfigDocument{{Name: "config.json", Data: []byte(configJSON)}},
		},
	})
	t.Cleanup(restoreSource)

	SetInstructionContextSource(InstructionContextSourceFunc(func() InstructionContext {
		return InstructionContext{
			ConfigDir:      "/env/config",
			HomeDir:        "/home/user",
			UserConfigDir:  "/user/config",
			DisableProject: true,
		}
	}))

	source := &testInstructionFileSource{}
	SetInstructionFileSource(source)

	loader := InstructionLoader{RootDir: "/repo/sub", ConfigDir: "/loader/config", DisableClaude: true}
	_ = loader.SystemPaths()

	require.Len(t, source.requests, 1)
	request := source.requests[0]
	assert.Equal(t, "/repo/sub", request.RootDir)
	assert.Equal(t, "/loader/config", request.ConfigDir)
	assert.Equal(t, "/env/config", request.ContextConfigDir)
	assert.Equal(t, "/home/user", request.HomeDir)
	assert.Equal(t, "/user/config", request.UserConfigDir)
	assert.True(t, request.DisableProject)
	assert.True(t, request.DisableClaude)
	assert.Equal(t, []string{"AGENTS.md", "CLAUDE.md", "CONTEXT.md"}, request.FileNames)
	assert.Equal(t, []string{"LOCAL.md", "https://example.com/skip.md"}, request.ConfiguredInstructions)
}

func TestInstructionLoaderSkipsMissingAndEmptyInstructionContent(t *testing.T) {
	resetInstructionLoaderState(t)

	source := &testInstructionFileSource{
		systemPaths: []string{"/repo/empty.md", "/repo/missing.md", "/repo/filled.md"},
		content: map[string]string{
			"/repo/empty.md":  "  ",
			"/repo/filled.md": "filled",
		},
	}
	SetInstructionFileSource(source)

	assert.Equal(
		t,
		[]string{"Instructions from: /repo/filled.md\nfilled"},
		(InstructionLoader{RootDir: "/repo"}).System(),
	)
}

func TestInstructionClaimPreventsDuplicateParentInstructionEntries(t *testing.T) {
	resetInstructionLoaderState(t)

	assert.True(t, claimInstruction("/repo/CONTEXT.md"))
	assert.False(t, claimInstruction("/repo/CONTEXT.md"))
}
