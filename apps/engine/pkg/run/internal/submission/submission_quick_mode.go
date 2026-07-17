package submission

import (
	"os"
	"strings"

	coreorchestrator "github.com/TaskForceAI/core/pkg/orchestrator"
	"github.com/google/uuid"
)

func shouldExecuteQuickModeInline(req TaskSubmissionRequest) bool {
	if !req.Options.QuickModeEnabled {
		return false
	}
	if len(req.Attachments.Files) > 0 {
		return false
	}
	if coreorchestrator.IsGeneratedFileRequest(req.Prompt) {
		return false
	}
	return strings.TrimSpace(os.Getenv("TASKFORCE_ASYNC_QUICK_MODE")) != "1"
}

func shouldExecuteQuickModeInBackground(req TaskSubmissionRequest) bool {
	return req.Options.QuickModeEnabled && req.Options.ComputerUseEnabled && !req.IsEval
}

func shouldExecuteLocalTaskInBackground(req TaskSubmissionRequest) bool {
	if req.IsEval {
		return false
	}
	if req.Options.QuickModeEnabled && !coreorchestrator.IsGeneratedFileRequest(req.Prompt) {
		return false
	}
	switch strings.TrimSpace(strings.ToLower(os.Getenv("TASKFORCE_LOCAL_TASK_EXECUTION"))) {
	case "1", "true", "yes":
		return true
	default:
		return false
	}
}

func makeTaskID(prefix string, newTaskID func(prefix string) string) string {
	if newTaskID != nil {
		return newTaskID(prefix)
	}
	return prefix + uuid.New().String()
}
