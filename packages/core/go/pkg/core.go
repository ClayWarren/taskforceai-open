package core

import (
	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/core/pkg/orchestrator"
	"github.com/TaskForceAI/core/pkg/platform"
	"github.com/TaskForceAI/core/pkg/tools"
)

//

// Main entry point exports
type TaskOrchestrator = orchestrator.TaskOrchestrator
type ProgressTracker = orchestrator.ProgressTracker
type GatewayAgent = agent.GatewayAgent

// Re-export common functions
var LoadConfig = config.LoadConfig
var NewOrchestrator = orchestrator.New
var DiscoverTools = tools.DiscoverTools
var SanitizePrompt = platform.SanitizePrompt
var ValidatePrompt = platform.ValidatePrompt
var GetLogger = platform.GetLogger
