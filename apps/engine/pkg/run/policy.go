package run

import executionpolicy "github.com/TaskForceAI/go-engine/pkg/run/internal/executionpolicy"

func applyComputerUseSessionMode(projectInstructions string, computerUseEnabled, useLoggedInServices bool) string {
	return executionpolicy.ApplyComputerUseSessionMode(projectInstructions, computerUseEnabled, useLoggedInServices)
}

func enforceQuickModeIdentity(prompt, modelID, result string) string {
	return executionpolicy.EnforceQuickModeIdentity(prompt, modelID, result, sentinelIdentityReply)
}

func isMediaGenerationModelID(modelID string) bool {
	return executionpolicy.IsMediaGenerationModelID(modelID)
}

func runProfileKey(userID int, orgID *int32) string {
	return executionpolicy.RunProfileKey(userID, orgID)
}
