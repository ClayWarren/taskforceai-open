package core

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPromptBuilder(t *testing.T) {
	b := PromptBuilder{System: []string{"s1", "s2"}}
	p, s := b.Build("user prompt")
	assert.Equal(t, "user prompt", p)
	assert.Equal(t, []string{"s1", "s2"}, s)
}

func TestFilterEmpty(t *testing.T) {
	in := []string{"a", "", "  ", "b"}
	out := filterEmpty(in)
	assert.Equal(t, []string{"a", "b"}, out)
}

type promptTestProvider struct{}

func (p promptTestProvider) GetModel(providerID, modelID string) (ProviderModel, error) {
	return ProviderModel{ProviderID: "provider", ModelID: "model"}, nil
}

func TestSessionPromptRunBranches(t *testing.T) {
	assert.Equal(t, Transcript{}, mustTranscript((&SessionPrompt{}).Run(RunOptions{})))

	tmpDir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(tmpDir, "file.txt"), []byte("x"), 0600))
	runner := NewSessionRunner(NewProcessorWithIDs(tmpDir, nil))
	prompt := &SessionPrompt{Orchestrator: &Orchestrator{
		Runner:   runner,
		Provider: promptTestProvider{},
	}}
	stream := NewSliceStream([]Event{{Type: EventFinishStep}})

	transcript, err := prompt.Run(RunOptions{
		SessionID:   "s1",
		Prompt:      "hello",
		Stream:      stream,
		Cwd:         tmpDir,
		AgentPrompt: "agent prompt",
		UserSystem:  "user system",
		System:      []string{"extra system"},
	})
	require.NoError(t, err)
	assert.Len(t, transcript.Messages, 2)
	assert.Contains(t, transcript.Messages[0].Parts[0].System, "agent prompt")
	assert.Contains(t, transcript.Messages[0].Parts[0].System, "user system")
}

func mustTranscript(transcript Transcript, err error) Transcript {
	if err != nil {
		panic(err)
	}
	return transcript
}
