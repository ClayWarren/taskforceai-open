package submission

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

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
