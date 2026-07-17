package orchestrator

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/cache"
	"github.com/TaskForceAI/core/pkg/config"
	coreengine "github.com/TaskForceAI/core/pkg/engine"
	"github.com/TaskForceAI/core/pkg/platform"
	"github.com/TaskForceAI/core/pkg/tools"
)

type AgentRunnerDeps struct {
	Config            config.Config
	Orchestrator      *TaskOrchestrator
	CacheNamespace    string
	UsageTracker      IUsageTracker
	ProgressTracker   IProgressTracker
	Budget            *BudgetManager
	Telemetry         ITelemetry
	ErrorReporter     IErrorReporter
	Silent            bool
	Mock              bool
	Cache             cache.ICache
	LLMCache          *cache.LLMCache
	GoogleDriveClient any
	Registry          *tools.ToolRegistry
	Images            []agent.ContentPart // multimodal image parts
	ModelID           string              // Optional model override
	TeamInbox         agent.TeamInbox
	TeamName          string
	AgentName         string
	ApprovalRegistry  IApprovalRegistry
	TaskID            string
}

func RunAgentParallel(ctx context.Context, deps *AgentRunnerDeps, agentID int, subtask string) AgentResult {
	if deps.Telemetry != nil {
		var result AgentResult
		ran := false
		if err := deps.Telemetry.StartSpan(ctx, "orchestrator.runAgentParallel", "orchestrator.agent", map[string]any{"agent_id": agentID}, func(ctx context.Context) error {
			ran = true
			result = doRunAgentParallel(ctx, deps, agentID, subtask)
			return nil
		}); err != nil {
			platform.GetLogger().Warn("Agent telemetry span failed", "agentId", agentID+1, "error", err)
			if !ran {
				return doRunAgentParallel(ctx, deps, agentID, subtask)
			}
		}
		return result
	}
	return doRunAgentParallel(ctx, deps, agentID, subtask)
}

// parseSubtaskOverrides extracts role and system prompt overrides from the subtask string
func parseSubtaskOverrides(subtask string) (roleName string, systemOverride string, cleanQuery string) {
	// Extract role name
	roleRe := regexp.MustCompile(`<<ROLE:([^>]+)>>`)
	if match := roleRe.FindStringSubmatch(subtask); len(match) > 1 {
		roleName = match[1]
	}

	// Extract system prompt override
	sysRe := regexp.MustCompile(`<<SYSTEM_OVERRIDE:([^>]+)>>`)
	if match := sysRe.FindStringSubmatch(subtask); len(match) > 1 {
		systemOverride = match[1]
	}

	// Remove the markers from the query
	cleanQuery = roleRe.ReplaceAllString(subtask, "")
	cleanQuery = sysRe.ReplaceAllString(cleanQuery, "")
	cleanQuery = strings.TrimSpace(cleanQuery)

	return roleName, systemOverride, cleanQuery
}

func isAllowedSystemOverride(o *TaskOrchestrator, systemOverride string) bool {
	if o == nil || systemOverride == "" {
		return false
	}

	for _, role := range o.agentRoles() {
		if systemOverride == role.SystemPrompt {
			return true
		}
	}

	return systemOverride == generatedFileSingleAgentPrompt ||
		systemOverride == o.resolveSingleAgentPrompt("")
}

func doRunAgentParallel(ctx context.Context, deps *AgentRunnerDeps, agentID int, subtask string) AgentResult {
	deps.ProgressTracker.UpdateAgentProgress(agentID, StatusProcessing, "")

	// Parse role-specific overrides from subtask
	roleName, systemOverride, cleanQuery := parseSubtaskOverrides(subtask)

	agentConfig := configuredParallelAgent(deps, agentID, roleName, systemOverride)

	hasImages := len(deps.Images) > 0
	skipCache := hasImages ||
		deps.Orchestrator.computerUseEnabled ||
		isGenerationModelID(agentConfig.Gateway.Model) ||
		IsGeneratedFileRequest(cleanQuery) ||
		RequiresScienceReference(cleanQuery) ||
		RequiresCurrentData(cleanQuery)
	cacheSystemPrompt := agentCacheSystemPrompt(agentConfig.SystemPrompt, agentConfig.Gateway.Model)

	if cachedResult, ok := cachedParallelAgentResult(ctx, deps, agentID, roleName, cleanQuery, cacheSystemPrompt, skipCache); ok {
		return cachedResult
	}

	agentStage := fmt.Sprintf("agent-%d", agentID+1)
	if roleName != "" {
		agentStage = fmt.Sprintf("agent-%d (%s)", agentID+1, roleName)
	}

	var toolEvents []agent.ToolEvent
	// Create agent options
	opts := agent.AgentOptions{
		AgentID:    agentID,
		AgentLabel: agentStage,
		TaskID:     deps.TaskID,
		ToolLogger: agent.ToolLogger(func(e agent.ToolEvent) {
			id := agentID
			e.AgentID = &id
			e.AgentLabel = agentStage
			toolEvents = upsertToolEvent(toolEvents, e)
			deps.UsageTracker.RecordToolUsage(e)
			if e.Status == "running" {
				deps.ProgressTracker.UpdateAgentProgressDetailed(agentID, StatusProcessing, liveToolActivity(e.ToolName), "")
			}
		}),
		UsageLogger:          agent.UsageLogger(func(p agent.UsagePayload) { deps.UsageTracker.RecordTokenUsage(p.Stage, p.Usage, p.Model) }),
		Registry:             deps.Registry,
		WebSearchEnabled:     deps.Orchestrator.webSearchEnabled,
		CodeExecutionEnabled: deps.Orchestrator.codeExecutionEnabled,
		ComputerUseEnabled:   deps.Orchestrator.computerUseEnabled,
		GoogleDriveClient:    deps.GoogleDriveClient,
		TeamInbox:            deps.TeamInbox,
		TeamName:             deps.TeamName,
		AgentName:            deps.AgentName,
		ApprovalRegistry:     deps.ApprovalRegistry,
		RawSystemPrompt:      true,
		OnReasoning: func(reasoning string) {
			deps.ProgressTracker.UpdateAgentProgressDetailed(agentID, StatusProcessing, "", reasoning)
		},
	}
	opts.Temperature = agentConfig.Agent.Temperature

	a := agent.NewGatewayAgent(agentConfig, deps.Orchestrator.GetClient(), opts)

	startTime := time.Now()
	var response string
	err := deps.Budget.WithBudget(agentStage, func() error {
		var runErr error
		if hasImages {
			response, runErr = a.RunMultimodal(ctx, cleanQuery, deps.Images, func(content string) {
				deps.ProgressTracker.UpdateAgentProgress(agentID, StatusProcessing, content)
			})
		} else {
			response, runErr = a.Run(ctx, cleanQuery, func(content string) {
				deps.ProgressTracker.UpdateAgentProgress(agentID, StatusProcessing, content)
			})
		}
		return runErr
	})
	executionTime := time.Since(startTime).Milliseconds()

	if err != nil {
		platform.GetLogger().Warn("Agent failed", "agentId", agentID+1, "error", err)
		if deps.ErrorReporter != nil {
			deps.ErrorReporter.CaptureException(ctx, err, map[string]string{"agent_id": fmt.Sprintf("%d", agentID)})
		}
		deps.ProgressTracker.UpdateAgentProgress(agentID, StatusFailed, fmt.Sprintf("Error: %v", err))
		return AgentResult{
			AgentID:       agentID,
			AgentName:     deps.AgentName,
			Status:        "error",
			Response:      fmt.Sprintf("Error: %v", err),
			ExecutionTime: executionTime,
			ToolEvents:    toolEvents,
		}
	}

	if !skipCache && deps.LLMCache != nil && response != "" {
		if err := deps.LLMCache.SetCachedAgentResponse(ctx, deps.CacheNamespace, cleanQuery, cacheSystemPrompt, response); err != nil {
			platform.GetLogger().Warn("Failed to cache agent response", "namespace", deps.CacheNamespace, "agentId", agentID+1, "responseLength", len(response), "error", err)
		}
	}

	deps.ProgressTracker.UpdateAgentProgress(agentID, StatusCompleted, response)

	return AgentResult{
		AgentID:       agentID,
		AgentName:     deps.AgentName,
		Status:        "success",
		Response:      response,
		ExecutionTime: executionTime,
		ToolEvents:    toolEvents,
	}
}

func configuredParallelAgent(deps *AgentRunnerDeps, agentID int, roleName, systemOverride string) config.Config {
	agentConfig := deps.Config
	if deps.ModelID != "" {
		agentConfig.Gateway.Model = deps.ModelID
	}
	if systemOverride == "" {
		return agentConfig
	}
	if isAllowedSystemOverride(deps.Orchestrator, systemOverride) {
		agentConfig.SystemPrompt = systemOverride + "\n\n" + deps.Config.SystemPrompt
		platform.GetLogger().Info("Agent using role-specific system prompt", "agentId", agentID+1, "role", roleName)
	} else {
		platform.GetLogger().Warn("Rejected untrusted system prompt override", "agentId", agentID+1, "role", roleName)
	}
	return agentConfig
}

func cachedParallelAgentResult(ctx context.Context, deps *AgentRunnerDeps, agentID int, roleName, query, systemPrompt string, skipCache bool) (AgentResult, bool) {
	if skipCache || deps.LLMCache == nil {
		return AgentResult{}, false
	}
	cached := deps.LLMCache.GetCachedAgentResponse(ctx, deps.CacheNamespace, query, systemPrompt)
	if !cached.Ok || cached.Value == "" {
		return AgentResult{}, false
	}
	platform.GetLogger().Info("Agent cache HIT", "agentId", agentID+1, "role", roleName)
	deps.ProgressTracker.UpdateAgentProgress(agentID, StatusCompleted, cached.Value)
	return AgentResult{AgentID: agentID, AgentName: deps.AgentName, Status: "success", Response: cached.Value, ExecutionTime: 0, ToolEvents: nil}, true
}

func liveToolActivity(toolName string) string {
	name := strings.TrimSpace(toolName)
	if name == "" {
		return "Using tool..."
	}
	name = strings.ReplaceAll(name, "_", " ")
	return fmt.Sprintf("Using %s...", name)
}

func agentCacheSystemPrompt(systemPrompt, modelID string) string {
	model := strings.TrimSpace(strings.ToLower(modelID))
	if model == "" {
		return systemPrompt
	}
	return systemPrompt + "\n\n[model:" + model + "]"
}

func isGenerationModelID(modelID string) bool {
	return coreengine.IsMediaGenerationModelID(modelID)
}
