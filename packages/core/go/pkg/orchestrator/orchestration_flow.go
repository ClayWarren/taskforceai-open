package orchestrator

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/platform"
	"github.com/TaskForceAI/core/pkg/team"
)

const MaxPendingSteeringBytes = 64 * 1024

const steeringPromptPrefix = "\n\n[Additional user guidance received while this turn was running]\n"

func (o *TaskOrchestrator) OrchestrateMultimodal(ctx context.Context, text string, images []agent.ContentPart) (string, *OrchestrationTrace, error) {
	if o.telemetry != nil {
		var result string
		var trace *OrchestrationTrace
		err := o.telemetry.StartSpan(ctx, "orchestrate", "workflow", map[string]any{
			"agent_count": o.agentCount,
			"multimodal":  true,
		}, func(ctx context.Context) error {
			res, t, orchErr := o.doOrchestrate(ctx, text, images, "", nil, nil)
			result = res
			trace = t
			return orchErr
		})
		return result, trace, err
	}
	return o.doOrchestrate(ctx, text, images, "", nil, nil)
}

func (o *TaskOrchestrator) Orchestrate(ctx context.Context, q string) (string, *OrchestrationTrace, error) {
	if o.telemetry != nil {
		var result string
		var trace *OrchestrationTrace
		err := o.telemetry.StartSpan(ctx, "orchestrate", "workflow", map[string]any{
			"agent_count": o.agentCount,
		}, func(ctx context.Context) error {
			res, t, orchErr := o.doOrchestrate(ctx, q, nil, "", nil, nil)
			result = res
			trace = t
			return orchErr
		})
		return result, trace, err
	}
	return o.doOrchestrate(ctx, q, nil, "", nil, nil)
}

func (o *TaskOrchestrator) doOrchestrate(ctx context.Context, q string, images []agent.ContentPart, taskID string, userID *int32, existingTrace *ExecutionTrace) (string, *OrchestrationTrace, error) {
	o.usageTracker.ResetAll()
	q = o.applyPendingSteering(ctx, q)

	teamName := fmt.Sprintf("orch-%d", time.Now().UnixNano())
	_, err := o.TeamService.Create(ctx, teamName, "lead-session", false)
	if err != nil {
		platform.GetLogger().Warn("Failed to create orchestration team", "error", err)
	}

	qs := o.executionSubtasks(ctx, q, existingTrace)
	o.progressTracker.Initialize(len(qs))

	tasks := make([]team.Task, len(qs))
	for i, subtask := range qs {
		tasks[i] = team.Task{
			ID:       fmt.Sprintf("%d", i+1),
			Content:  subtask,
			Status:   team.TaskStatusPending,
			Priority: team.TaskPriorityMedium,
		}
	}
	if err := o.TeamService.AddTasks(ctx, teamName, tasks); err != nil {
		platform.GetLogger().Warn("Failed to attach orchestration tasks to team", "team", teamName, "taskCount", len(tasks), "error", err)
	}

	var completedResults []AgentResult
	if existingTrace != nil && existingTrace.Steps != nil {
		if steps, ok := existingTrace.Steps.([]AgentResult); ok {
			completedResults = steps
		}
	}

	agentResults := o.execAgentsWithCheckpoint(ctx, teamName, qs, images, taskID, userID, completedResults)
	q = o.applyPendingSteering(ctx, q)

	hasSuccess := false
	for _, r := range agentResults {
		if r.Status == "success" {
			hasSuccess = true
			break
		}
	}

	if !hasSuccess {
		if err := ctx.Err(); err != nil {
			return "", nil, err
		}
		return "", nil, &platform.OrchestrationError{
			Message: "All agents failed to provide results",
			Stage:   "orchestration",
			Cause:   firstAgentFailureCause(agentResults),
		}
	}

	synthesis, err := o.aggregateResults(ctx, agentResults, q, taskID)
	if err != nil {
		return "", nil, err
	}

	tokenUsage, _ := o.usageTracker.GetTokenUsageSummary()
	trace := &OrchestrationTrace{
		OriginalQuery:  q,
		SubQuestions:   qs,
		AgentResults:   agentResults,
		FinalSynthesis: synthesis,
		ModelConfig:    o.config.Gateway.Model,
		Timestamp:      time.Now().Unix(),
		TokenUsage:     tokenUsage,
		ToolUsage:      o.usageTracker.GetToolUsage(),
	}

	o.saveTrace(ctx, taskID, userID, q, qs, agentResults, synthesis)

	return synthesis, trace, nil
}

func (o *TaskOrchestrator) applyPendingSteering(ctx context.Context, query string) string {
	if o == nil || o.steeringProvider == nil {
		return query
	}
	messages, err := o.steeringProvider(ctx)
	if err != nil {
		platform.GetLogger().Warn("Failed to load active-turn steering", "error", err)
		return query
	}
	remaining := MaxPendingSteeringBytes
	for _, message := range messages {
		if message = strings.TrimSpace(message); message != "" {
			addition := steeringPromptPrefix + message
			if len(addition) > remaining {
				platform.GetLogger().Warn("Discarded active-turn steering beyond prompt budget")
				continue
			}
			query += addition
			remaining -= len(addition)
		}
	}
	return query
}

func (o *TaskOrchestrator) executionSubtasks(ctx context.Context, q string, existingTrace *ExecutionTrace) []string {
	var qs []string
	if existingTrace != nil && existingTrace.Plan != nil {
		if plan, ok := existingTrace.Plan.([]string); ok {
			qs = plan
		} else if plan, ok := existingTrace.Plan.([]any); ok {
			for _, p := range plan {
				qs = append(qs, fmt.Sprint(p))
			}
		}
	}

	if len(qs) > 0 {
		return qs
	}

	if IsGeneratedFileRequest(q) {
		return o.buildDefaultSubtasks(q)
	}
	if o.decomposer != nil {
		if subtasks, err := o.decomposer.GenerateSubtasks(ctx, q, o.agentCount); err == nil && len(subtasks) > 0 {
			return subtasks
		}
	}
	return o.buildDefaultSubtasks(q)
}

func (o *TaskOrchestrator) OrchestrateWithTask(ctx context.Context, q string, taskID string, userID *int32) (string, *OrchestrationTrace, error) {
	return o.doOrchestrate(ctx, q, nil, taskID, userID, nil)
}

func (o *TaskOrchestrator) OrchestrateMultimodalWithTask(ctx context.Context, q string, images []agent.ContentPart, taskID string, userID *int32) (string, *OrchestrationTrace, error) {
	return o.doOrchestrate(ctx, q, images, taskID, userID, nil)
}

func (o *TaskOrchestrator) ResumeOrchestration(ctx context.Context, q string, images []agent.ContentPart, taskID string, userID *int32, existingTrace *ExecutionTrace) (string, *OrchestrationTrace, error) {
	return o.doOrchestrate(ctx, q, images, taskID, userID, existingTrace)
}

func (o *TaskOrchestrator) saveTrace(ctx context.Context, taskID string, userID *int32, goal string, subtasks []string, results []AgentResult, synthesis string) {
	if o.traceRepo == nil || taskID == "" {
		return
	}

	trace := &ExecutionTrace{
		TaskID: taskID,
		UserID: userID,
		Goal:   goal,
		Plan:   subtasks,
		Steps:  results,
		SelfEval: map[string]any{
			"status": "completed",
		},
		Artifacts: map[string]any{
			"final_answer": synthesis,
		},
	}

	// Generate human-readable report if generator is available
	if o.reportGenerator != nil {
		report, err := o.reportGenerator.GenerateReport(ctx, trace)
		if err != nil {
			platform.GetLogger().Warn("Failed to generate execution report", "error", err, "taskId", taskID)
		} else {
			trace.Report = report
		}
	}

	if err := o.traceRepo.SaveExecutionTrace(ctx, trace); err != nil {
		platform.GetLogger().Error("Failed to save execution trace", "error", err, "taskId", taskID)
	}
}
