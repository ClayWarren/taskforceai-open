package run

import coreengine "github.com/TaskForceAI/core/pkg/engine"

func isMediaGenerationModelID(modelID string) bool {
	return coreengine.IsMediaGenerationModelID(modelID)
}
