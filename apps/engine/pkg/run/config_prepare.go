package run

import (
	"fmt"
	"log/slog"
	"strings"

	configpkg "github.com/TaskForceAI/config/pkg"
	corechat "github.com/TaskForceAI/core/pkg/chat"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/core/pkg/orchestrator"
	"github.com/TaskForceAI/core/pkg/payments"
)

func prepareConfig(taskID string, modelID string, opts OrchestrateTaskOptions) (coreconfig.Config, error) {
	cfg, err := ConfigLoader("")
	if err != nil {
		slog.Error("[OrchestrateTask] Configuration load failed", "taskId", taskID, "error", err)
		return coreconfig.Config{}, fmt.Errorf("internal configuration error: %w", err)
	}

	if err := validateRoleModels(cfg, opts.RoleModels); err != nil {
		slog.Warn("[OrchestrateTask] Role model validation failed", "taskId", taskID, "error", err)
		return coreconfig.Config{}, err
	}

	// Resolve and validate model selection
	selection, err := ModelSelectionResolver(cfg, modelID)
	if err != nil {
		slog.Warn("[OrchestrateTask] Model selection failed", "taskId", taskID, "error", err)
		return coreconfig.Config{}, err
	}
	cfg = selection.Config
	if err := corechat.ValidateReasoningEffort(selection.SelectedModel.ID, opts.ReasoningEffort); err != nil {
		return coreconfig.Config{}, err
	}
	cfg.Agent.ReasoningEffort = strings.ToLower(strings.TrimSpace(opts.ReasoningEffort))

	webEnv := loadOptionalWebEnv("prepareConfig", "taskId", taskID)
	if webEnv.AIGatewayAPIKey != "" {
		cfg.Gateway.APIKey = webEnv.AIGatewayAPIKey
	}
	if webEnv.VercelAIGatewayURL != "" {
		cfg.Gateway.BaseURL = webEnv.VercelAIGatewayURL
	}

	planLimit := payments.AgentLimitForPlan(opts.UserPlan)
	if cfg.Orchestrator.ParallelAgents <= 0 || cfg.Orchestrator.ParallelAgents > planLimit {
		cfg.Orchestrator.ParallelAgents = planLimit
	}
	if opts.AgentCount > 0 {
		requestedCount := opts.AgentCount
		if requestedCount > planLimit {
			requestedCount = planLimit
		}
		cfg.Orchestrator.ParallelAgents = requestedCount
	}

	if strings.TrimSpace(cfg.Gateway.BaseURL) == "" {
		cfg.Gateway.BaseURL = defaultAIGatewayBaseURL
	}

	if strings.Contains(cfg.Gateway.BaseURL, "api.vercel.ai") && !strings.Contains(cfg.Gateway.BaseURL, "/gateway/") {
		return coreconfig.Config{}, fmt.Errorf("VERCEL_AI_GATEWAY_URL is incomplete. Use a full gateway path or the generic 'https://ai-gateway.vercel.sh/v1'")
	}

	return cfg, nil
}

func validateRoleModels(cfg coreconfig.Config, roleModels map[string]string) error {
	for role, roleModelID := range roleModels {
		trimmedModelID := strings.TrimSpace(roleModelID)
		if trimmedModelID == "" {
			continue
		}
		if _, err := ModelSelectionResolver(cfg, trimmedModelID); err != nil {
			return fmt.Errorf("invalid role model for %q: %w", role, err)
		}
	}

	return nil
}

func initRegistryProgress(registry TaskRegistrar, taskID string, cfg coreconfig.Config, quickModeEnabled bool) error {
	agentCount := cfg.Orchestrator.ParallelAgents
	if quickModeEnabled {
		agentCount = 1
	}
	if agentCount <= 0 {
		agentCount = 1
	}
	initialStatuses := make([]orchestrator.AgentStatusSnapshot, agentCount)
	for i := range initialStatuses {
		initialStatuses[i] = orchestrator.AgentStatusSnapshot{
			AgentID:  i,
			Status:   "QUEUED",
			Progress: 0.05,
		}
	}
	return registry.UpdateProgress(taskID, initialStatuses, nil, nil)
}

func loadOptionalWebEnv(operation string, args ...any) *configpkg.WebEnv {
	webEnv, err := WebEnvLoader(configpkg.LoadWebEnvOptions{SkipValidation: true})
	if err != nil {
		attrs := append([]any{"operation", operation, "error", err}, args...)
		slog.Warn("[OrchestrateTask] Optional web environment load failed", attrs...)
		return &configpkg.WebEnv{}
	}
	if webEnv == nil {
		attrs := append([]any{"operation", operation}, args...)
		slog.Warn("[OrchestrateTask] Optional web environment loader returned nil", attrs...)
		return &configpkg.WebEnv{}
	}
	return webEnv
}
