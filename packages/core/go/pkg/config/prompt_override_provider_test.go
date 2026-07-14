package config

import (
	"testing"

	"github.com/TaskForceAI/core/internal/testsupport/configsource"
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
	t.Cleanup(SetPromptOverrideProvider(nil))
}

type testEnginecoreConfigSource = configsource.Source
