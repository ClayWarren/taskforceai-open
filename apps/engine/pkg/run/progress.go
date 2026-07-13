package run

import (
	"context"
	"log/slog"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/orchestrator"
)

func handleOrchestrateTaskProgressUpdate(
	registry TaskRegistrar,
	taskID string,
	orch *orchestrator.TaskOrchestrator,
	opts OrchestrateTaskOptions,
	status []orchestrator.AgentStatusSnapshot,
) {
	slog.Info("[OrchestrateTask] Progress update received", "taskId", taskID, "numAgents", len(status))
	var budgetUsage *BudgetUsage
	if opts.Budget != nil {
		bu := orch.GetBudgetUsage()
		budgetUsage = &BudgetUsage{
			InitialUSD:   bu.InitialUSD,
			ConsumedUSD:  bu.ConsumedUSD,
			RemainingUSD: bu.RemainingUSD,
		}
	}
	if err := registry.UpdateProgress(taskID, status, nil, budgetUsage); err != nil {
		slog.Warn("[OrchestrateTask] Failed to persist progress update", "taskId", taskID, "error", err)
	}
}

func handleOrchestrateTaskToolUsageUpdate(
	ctx context.Context,
	registry TaskRegistrar,
	taskID string,
	userID int,
	orch *orchestrator.TaskOrchestrator,
	opts OrchestrateTaskOptions,
	toolEvents []agent.ToolEvent,
) {
	if len(toolEvents) > 0 {
		latest := toolEvents[len(toolEvents)-1]
		slog.Info(
			"[OrchestrateTask] Tool usage update received",
			"taskId", taskID,
			"count", len(toolEvents),
			"latestTool", latest.ToolName,
			"latestStatus", latest.Status,
			"latestAgentId", latest.AgentID,
			"latestAgentLabel", latest.AgentLabel,
		)
	}
	persistedToolEvents, err := PersistGeneratedFileArtifacts(ctx, GeneratedFilePersistenceInput{
		UserID: userID,
		OrgID:  opts.OrgID,
		TaskID: taskID,
		Events: toolEvents,
	})
	if err != nil {
		slog.Warn("[OrchestrateTask] Failed to persist generated file artifacts", "taskId", taskID, "error", err)
	} else {
		toolEvents = persistedToolEvents
	}
	var budgetUsage *BudgetUsage
	if opts.Budget != nil {
		bu := orch.GetBudgetUsage()
		budgetUsage = &BudgetUsage{
			InitialUSD:   bu.InitialUSD,
			ConsumedUSD:  bu.ConsumedUSD,
			RemainingUSD: bu.RemainingUSD,
		}
	}
	if err := registry.UpdateProgress(taskID, nil, toolEvents, budgetUsage); err != nil {
		slog.Warn("[OrchestrateTask] Failed to persist tool usage update", "taskId", taskID, "error", err)
	}
}
