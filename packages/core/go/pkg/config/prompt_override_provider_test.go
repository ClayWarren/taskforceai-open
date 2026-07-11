package config

import (
	"testing"

	enginecoreconfig "github.com/TaskForceAI/core/pkg/enginecore/config"
)

type testPromptOverrideProvider struct {
	system      string
	question    string
	synthesis   string
	models      map[string]string
	fingerprint uint64
}

func (p *testPromptOverrideProvider) SystemPromptOverride() string {
	return p.system
}

func (p *testPromptOverrideProvider) QuestionGenerationPromptOverride() string {
	return p.question
}

func (p *testPromptOverrideProvider) SynthesisPromptOverride() string {
	return p.synthesis
}

func (p *testPromptOverrideProvider) ModelSystemPromptOverride(modelID string) string {
	if p.models == nil {
		return ""
	}
	return p.models[modelID]
}

func (p *testPromptOverrideProvider) PromptOverridesFingerprint() uint64 {
	return p.fingerprint
}

func resetPromptOverrideProviderForTest(t *testing.T) {
	t.Helper()
	reset := func() {
		promptOverrideProviderMu.Lock()
		promptOverrideProvider = emptyPromptOverrideProvider{}
		promptOverrideProviderMu.Unlock()
	}
	reset()
	t.Cleanup(reset)
}

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
