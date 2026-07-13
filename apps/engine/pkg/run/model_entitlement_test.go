package run

import (
	"testing"

	coreconfig "github.com/TaskForceAI/core/pkg/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidateModelEntitlements(t *testing.T) {
	require.ErrorContains(
		t,
		validateModelEntitlements("free", "google/gemini-3.1-pro-preview", nil),
		"requires a Pro or Super subscription",
	)
	require.ErrorContains(
		t,
		validateModelEntitlements("free", "zai/glm-5.2", map[string]string{
			"researcher": "anthropic/claude-sonnet-5",
		}),
		"requires a Pro or Super subscription",
	)
	assert.NoError(t, validateModelEntitlements("pro", "openai/gpt-5.6-sol", map[string]string{
		"researcher": "anthropic/claude-fable-5",
	}))
	assert.NoError(t, validateModelEntitlements("free", "google/gemini-3.1-flash-lite", nil))
}

func TestValidateSubmissionRequest_EvalCannotBypassModelEntitlements(t *testing.T) {
	for _, tc := range []struct {
		name          string
		requestIsEval bool
		optionsIsEval bool
	}{
		{name: "request flag", requestIsEval: true},
		{name: "options flag", optionsIsEval: true},
		{name: "both flags", requestIsEval: true, optionsIsEval: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			code, err := validateSubmissionRequest(TaskSubmissionRequest{
				ModelID: "openai/gpt-5.6-sol",
				IsEval:  tc.requestIsEval,
				Options: OrchestrateTaskOptions{
					UserPlan: "free",
					IsEval:   tc.optionsIsEval,
				},
			}, TaskSubmissionDeps{
				Registry: &captureRegistry{},
				Inngest:  &captureInngest{},
			})

			require.ErrorContains(t, err, "requires a Pro or Super subscription")
			assert.Equal(t, TaskSubmissionEntitlement, code)
		})
	}
}

func TestValidateSubmissionRequest_PaidEvalRetainsAccess(t *testing.T) {
	code, err := validateSubmissionRequest(TaskSubmissionRequest{
		ModelID: "openai/gpt-5.6-sol",
		IsEval:  true,
		Options: OrchestrateTaskOptions{
			UserPlan: "pro",
			IsEval:   true,
		},
	}, TaskSubmissionDeps{
		Registry: &captureRegistry{},
		Inngest:  &captureInngest{},
	})

	require.NoError(t, err)
	assert.Empty(t, code)
}

func TestPrepareConfig_EvalCannotBypassModelEntitlements(t *testing.T) {
	restore(t, &ConfigLoader)
	ConfigLoader = func(string) (coreconfig.Config, error) {
		return coreconfig.Config{}, nil
	}

	_, err := prepareConfig("task-eval", "openai/gpt-5.6-sol", OrchestrateTaskOptions{
		UserPlan: "free",
		IsEval:   true,
	})

	require.ErrorContains(t, err, "requires a Pro or Super subscription")
}
