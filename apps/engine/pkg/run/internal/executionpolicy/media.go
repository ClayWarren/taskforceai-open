package executionpolicy

import coreengine "github.com/TaskForceAI/core/pkg/engine"

func IsMediaGenerationModelID(modelID string) bool {
	return coreengine.IsMediaGenerationModelID(modelID)
}
