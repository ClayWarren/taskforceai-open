package run

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/TaskForceAI/core/pkg/agent"
	corecache "github.com/TaskForceAI/core/pkg/cache"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/core/pkg/orchestrator"
	"github.com/TaskForceAI/core/pkg/payments"
	coretools "github.com/TaskForceAI/core/pkg/tools"
	"github.com/TaskForceAI/core/pkg/workflows"
)

func newOrchestrateTaskRunner(taskID string, userID int, prompt, modelID string, opts OrchestrateTaskOptions, registry TaskRegistrar) *orchestrateTaskRunner {
	return &orchestrateTaskRunner{
		taskID:   taskID,
		userID:   userID,
		prompt:   prompt,
		modelID:  modelID,
		opts:     opts,
		registry: registry,
	}
}

func (r *orchestrateTaskRunner) run(ctx context.Context) {
	start := time.Now()
	slog.Info(
		"[OrchestrateTask] Starting background task",
		"taskId", r.taskID,
		"userId", r.userID,
		"orgId", r.opts.OrgID,
		"modelId", r.modelID,
		"quickMode", r.opts.QuickModeEnabled,
		"autonomy", r.opts.AutonomyEnabled,
		"computerUse", r.opts.ComputerUseEnabled,
		"computerUseTarget", r.opts.ComputerUseTarget,
		"attachmentCount", r.opts.AttachmentCount,
		"userPlan", r.opts.UserPlan,
	)

	timeout := payments.TaskTimeoutForPlan(r.opts.UserPlan)
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	clearTaskCancellation := registerTaskCancellation(r.taskID, cancel)
	defer clearTaskCancellation()
	ctx, taskSpan := startTaskSpan(ctx, r.taskID, r.userID, r.modelID, r.opts)
	defer func() {
		status := StatusCompleted
		if state := r.registry.Get(r.taskID); state != nil {
			status = state.Status
		}
		finishTaskObservation(ctx, taskSpan, start, status, r.taskErr, r.opts)
	}()

	if !r.claimStart(ctx) {
		return
	}
	if state := r.registry.Get(r.taskID); state != nil && state.Status == StatusCanceled {
		return
	}

	stopHeartbeat := r.startHeartbeat(ctx, start)
	defer stopHeartbeat()
	stopCancellationMonitor := r.startCancellationMonitor(ctx, cancel)
	defer stopCancellationMonitor()

	prep, ok := r.prepare(ctx)
	if !ok {
		return
	}

	runCtx := coretools.WithComputerUseExecutionContext(ctx, coretools.ComputerUseExecutionContext{
		ProfileKey:          runProfileKey(r.userID, r.opts.OrgID),
		UseLoggedInServices: r.opts.UseLoggedInServices,
	})
	result, trace, ok := r.execute(runCtx, prep)
	if !ok {
		return
	}

	r.complete(runCtx, prep, result, trace)
}

func (r *orchestrateTaskRunner) startCancellationMonitor(ctx context.Context, cancel context.CancelFunc) func() {
	stop := make(chan struct{})
	interval := getTaskCancellationPollInterval()
	if interval <= 0 {
		interval = time.Second
	}
	go func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				slog.Error("[OrchestrateTask] Panic in task cancellation monitor", "taskId", r.taskID, "panic", recovered)
			}
		}()
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				state := r.registry.Get(r.taskID)
				if state != nil && state.Status == StatusCanceled {
					slog.Info("[OrchestrateTask] Observed distributed task cancellation", "taskId", r.taskID)
					cancel()
					return
				}
			case <-ctx.Done():
				return
			case <-stop:
				return
			}
		}
	}()

	return func() { close(stop) }
}

func (r *orchestrateTaskRunner) setTaskStatus(ctx context.Context, status TaskStatus, errStr string) {
	updateCtx := context.WithoutCancel(ctx)
	if updateErr := updateTaskStatusWithLockRetry(updateCtx, r.registry, r.taskID, status, "", errStr); updateErr != nil {
		slog.Error("[OrchestrateTask] Failed to persist task status", "taskId", r.taskID, "status", status, "error", updateErr)
	}
}

func (r *orchestrateTaskRunner) fail(ctx context.Context, err error, message string) {
	r.taskErr = err
	r.setTaskStatus(ctx, StatusFailed, message)
}

func (r *orchestrateTaskRunner) claimStart(ctx context.Context) bool {
	started, startErr := r.registry.MarkStartedWithError(r.taskID)
	if startErr != nil {
		r.taskErr = fmt.Errorf("mark task started: %w", startErr)
		slog.Error("[OrchestrateTask] Failed to claim task start lock", "taskId", r.taskID, "error", startErr)
		if updateErr := r.registry.Update(ctx, r.taskID, StatusFailed, "", "Task could not be claimed for execution; please retry"); updateErr != nil {
			slog.Warn("[OrchestrateTask] Failed to persist claim failure status", "taskId", r.taskID, "error", updateErr)
		}
		return false
	}
	if !started {
		slog.Info("[OrchestrateTask] Task already started or finished, skipping", "taskId", r.taskID)
		return false
	}
	slog.Info("[OrchestrateTask] Task start claimed", "taskId", r.taskID, "userId", r.userID)
	return true
}

func (r *orchestrateTaskRunner) startHeartbeat(ctx context.Context, start time.Time) func() {
	stopHeartbeat := make(chan struct{})
	heartbeatInterval := getOrchestrateTaskHeartbeatInterval()
	go func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				slog.Error("[OrchestrateTask] Panic in task heartbeat goroutine", "taskId", r.taskID, "panic", recovered)
			}
		}()
		ticker := time.NewTicker(heartbeatInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if err := r.registry.Heartbeat(ctx, r.taskID); err != nil {
					slog.Warn("[OrchestrateTask] Failed to persist task heartbeat", "taskId", r.taskID, "error", err)
				}
			case <-stopHeartbeat:
				return
			}
		}
	}()

	return func() {
		close(stopHeartbeat)
		slog.Info("[OrchestrateTask] Task finished", "taskId", r.taskID, "duration", time.Since(start).String())
	}
}

func (r *orchestrateTaskRunner) prepare(ctx context.Context) (*orchestrationPreparation, bool) {
	attachments, attachmentErr := fetchAttachments(ctx, r.taskID)
	if attachmentErr != nil {
		r.fail(ctx, attachmentErr, "Task attachments are no longer available. Please re-upload and retry.")
		return nil, false
	}
	if r.opts.AttachmentCount > 0 && len(attachments.Files) < r.opts.AttachmentCount {
		r.fail(ctx, fmt.Errorf("expected %d attachments, resolved %d", r.opts.AttachmentCount, len(attachments.Files)), "Task attachments are no longer available. Please re-upload and retry.")
		return nil, false
	}
	hasAttachments := len(attachments.Files) > 0
	slog.Info("[OrchestrateTask] Attachments resolved", "taskId", r.taskID, "attachmentCount", len(attachments.Files), "expectedAttachmentCount", r.opts.AttachmentCount)

	cfg, err := prepareConfig(r.taskID, r.modelID, r.opts)
	if err != nil {
		r.fail(ctx, err, "Internal configuration error")
		return nil, false
	}
	slog.Info("[OrchestrateTask] Configuration prepared", "taskId", r.taskID, "modelId", r.modelID, "parallelAgents", cfg.Orchestrator.ParallelAgents)

	cacheInstance, requiresCurrentData, ok := r.prepareCache(ctx, hasAttachments, cfg)
	if !ok {
		return nil, false
	}

	adapter, err := ResolveAdapter(ctx, cfg, r.modelID)
	if err != nil {
		r.fail(ctx, err, err.Error())
		return nil, false
	}
	if adapter == nil {
		r.fail(ctx, fmt.Errorf("adapter is nil"), "adapter is nil")
		return nil, false
	}
	slog.Info("[OrchestrateTask] Model adapter resolved", "taskId", r.taskID, "modelId", r.modelID, "adapterType", fmt.Sprintf("%T", adapter))

	if err := uploadNativeAttachments(ctx, adapter, r.modelID, &attachments); err != nil {
		r.fail(ctx, err, err.Error())
		return nil, false
	}

	if err := initRegistryProgress(r.registry, r.taskID, cfg, r.opts.QuickModeEnabled); err != nil {
		slog.Warn("[OrchestrateTask] Failed to persist initial progress state", "taskId", r.taskID, "error", err)
	}

	if r.opts.QuickModeEnabled {
		slog.Info("[OrchestrateTask] Quick Mode enabled, running single-agent orchestration", "taskId", r.taskID)
	}

	userContext, err := LoadRunUserContext(ctx, UserContextLoadInput{
		UserID:    int32(r.userID), // #nosec G115 -- existing API accepts int32 and user IDs are database bounded.
		ProjectID: r.opts.ProjectID,
		OrgID:     r.opts.OrgID,
	})
	if err != nil {
		r.fail(ctx, err, "Failed to load user context")
		return nil, false
	}
	slog.Info(
		"[OrchestrateTask] User context loaded",
		"taskId", r.taskID,
		"memoryEnabled", userContext.MemoryEnabled,
		"memoryCount", len(userContext.Memories),
		"trustLayerEnabled", userContext.TrustLayerEnabled,
		"webSearchEnabled", userContext.WebSearchEnabled,
		"codeExecutionEnabled", userContext.CodeExecutionEnabled,
		"hasGithubToken", userContext.GithubToken != "",
	)
	userContext.ProjectInstructions = applyComputerUseSessionMode(
		userContext.ProjectInstructions,
		r.opts.ComputerUseEnabled,
		r.opts.UseLoggedInServices,
	)
	userContext.ProjectInstructions = workflows.ApplyResearchWorkflowInstructions(
		userContext.ProjectInstructions,
		r.opts.ResearchWorkflow,
	)

	var traceRepo *Repository
	if userContext.TrustLayerEnabled {
		if repo, err := LoadTraceRepository(ctx); err == nil {
			traceRepo = repo
		}
	}

	orch := InitOrchestrator(OrchestratorInitInput{
		Config:               cfg,
		Mode:                 r.opts.Mode,
		UserID:               r.userID,
		Cache:                cacheInstance,
		Memories:             userContext.Memories,
		DriveClient:          userContext.DriveClient,
		ProjectInstructions:  userContext.ProjectInstructions,
		ComputerUseEnabled:   r.opts.ComputerUseEnabled,
		GithubToken:          userContext.GithubToken,
		LLMAdapter:           adapter,
		RoleModels:           r.opts.RoleModels,
		TraceRepo:            traceRepo,
		AutonomyEnabled:      r.opts.AutonomyEnabled,
		BudgetUSD:            r.opts.Budget,
		QuickModeEnabled:     r.opts.QuickModeEnabled,
		WebSearchEnabled:     userContext.WebSearchEnabled,
		CodeExecutionEnabled: userContext.CodeExecutionEnabled,
		SteeringProvider:     newTaskSteeringProvider(r.taskID),
	})
	if orch == nil {
		r.fail(ctx, fmt.Errorf("orchestrator is nil"), "orchestrator is nil")
		return nil, false
	}
	slog.Info("[OrchestrateTask] Orchestrator initialized", "taskId", r.taskID, "quickMode", r.opts.QuickModeEnabled, "clientMCPToolCount", len(r.opts.ClientMCPTools))
	if len(r.opts.ClientMCPTools) > 0 {
		orch.RegisterClientMCPTools(r.taskID, clientMCPToolDescriptors(r.opts.ClientMCPTools))
	}

	return &orchestrationPreparation{
		cfg:                 cfg,
		attachments:         attachments,
		adapter:             adapter,
		hasAttachments:      hasAttachments,
		cacheInstance:       cacheInstance,
		requiresCurrentData: requiresCurrentData,
		userContext:         userContext,
		traceRepo:           traceRepo,
		orch:                orch,
	}, true
}

func (r *orchestrateTaskRunner) prepareCache(ctx context.Context, hasAttachments bool, cfg coreconfig.Config) (corecache.ICache, bool, bool) {
	if r.opts.ConversationID != nil {
		slog.Info("[OrchestrateTask] Cache SKIPPED (existing conversation)", "taskId", r.taskID, "conversationId", *r.opts.ConversationID)
		recordCacheDecision(ctx, "skipped_conversation")
		return getCacheInstance(), true, true
	}
	if hasAttachments {
		slog.Info("[OrchestrateTask] Cache SKIPPED (attachments present)", "taskId", r.taskID)
		recordCacheDecision(ctx, "skipped_attachments")
		return getCacheInstance(), true, true
	}

	result, cacheInstance, requiresCurrentData := checkLLMCache(ctx, r.taskID, r.userID, r.prompt, r.modelID, r.opts)
	if result != "" {
		FinalizeTask(ctx, r.taskID, r.userID, r.prompt, r.modelID, result, nil, cfg, cacheInstance, true, false, r.opts, "")
		return cacheInstance, requiresCurrentData, false
	}
	return cacheInstance, requiresCurrentData, true
}

func (r *orchestrateTaskRunner) execute(ctx context.Context, prep *orchestrationPreparation) (string, *orchestrator.OrchestrationTrace, bool) {
	if isMediaGenerationModelID(r.modelID) {
		result, err := executeDirectMediaGeneration(ctx, mediaGenerationInput{
			Adapter:        prep.adapter,
			ModelID:        r.modelID,
			Prompt:         r.prompt,
			Attachments:    prep.attachments,
			HasAttachments: prep.hasAttachments,
		})
		if err != nil {
			r.taskErr = err
			r.setTaskStatus(ctx, StatusFailed, err.Error())
			return "", nil, false
		}
		return result, nil, true
	}

	prep.orch.OnProgress(r.progressUpdateHandler(prep))
	prep.orch.OnToolUsage(r.toolUsageUpdateHandler(ctx, prep))

	trustUserID, err := trustLayerUserID(r.userID, prep.userContext.TrustLayerEnabled)
	if err != nil {
		r.fail(ctx, err, err.Error())
		return "", nil, false
	}

	executionPrompt := r.prompt
	if threadContext := strings.TrimSpace(r.opts.ThreadContext); threadContext != "" {
		executionPrompt = "Continue the existing conversation below.\n\n" + threadContext + "\n\nuser: " + r.prompt
	}
	result, trace, err := executeTaskOrchestration(ctx, taskExecutionInput{
		Orchestrator:      prep.orch,
		Prompt:            executionPrompt,
		TaskID:            r.taskID,
		TrustUserID:       trustUserID,
		TraceRepo:         prep.traceRepo,
		Attachments:       prep.attachments,
		HasAttachments:    prep.hasAttachments,
		TrustLayerEnabled: prep.userContext.TrustLayerEnabled,
	})
	if err != nil {
		r.taskErr = err
		errMsg := err.Error()
		if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
			r.setTaskStatus(context.WithoutCancel(ctx), StatusCanceled, "Run canceled")
			return "", nil, false
		}
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			errMsg = "Request timed out. For complex questions, try breaking them into smaller parts."
		}
		r.setTaskStatus(ctx, StatusFailed, errMsg)
		return "", nil, false
	}
	slog.Info("[OrchestrateTask] Orchestration execution completed", "taskId", r.taskID, "resultLength", len(result), "hasTrace", trace != nil)

	if r.opts.QuickModeEnabled {
		result = enforceQuickModeIdentity(r.prompt, r.modelID, result)
	}

	return result, trace, true
}

func (r *orchestrateTaskRunner) progressUpdateHandler(prep *orchestrationPreparation) func([]orchestrator.AgentStatusSnapshot) {
	return func(status []orchestrator.AgentStatusSnapshot) {
		handleOrchestrateTaskProgressUpdate(r.registry, r.taskID, prep.orch, r.opts, status)
	}
}

func (r *orchestrateTaskRunner) toolUsageUpdateHandler(ctx context.Context, prep *orchestrationPreparation) func(agent.ToolEvent, []agent.ToolEvent) {
	return func(_ agent.ToolEvent, history []agent.ToolEvent) {
		handleOrchestrateTaskToolUsageUpdate(ctx, r.registry, r.taskID, r.userID, prep.orch, r.opts, history)
	}
}

func (r *orchestrateTaskRunner) complete(ctx context.Context, prep *orchestrationPreparation, result string, trace *orchestrator.OrchestrationTrace) {
	var traceID string
	if trace != nil {
		traceID = "trace_" + r.taskID
	}
	FinalizeTask(ctx, r.taskID, r.userID, r.prompt, r.modelID, result, trace, prep.cfg, prep.cacheInstance, prep.requiresCurrentData, prep.userContext.MemoryEnabled, r.opts, traceID)
}

func updateTaskStatusWithLockRetry(ctx context.Context, registry TaskRegistrar, taskID string, status TaskStatus, result, errStr string) error {
	return retryTaskStatusUpdate(ctx, func() error {
		return registry.Update(ctx, taskID, status, result, errStr)
	})
}

func completeTaskStatusWithConversationLockRetry(ctx context.Context, registry TaskRegistrar, taskID string, result, errStr string, conversationID int32, traceID string) error {
	return retryTaskStatusUpdate(ctx, func() error {
		return registry.UpdateWithConversation(ctx, taskID, StatusCompleted, result, errStr, conversationID, traceID)
	})
}

func retryTaskStatusUpdate(ctx context.Context, update func() error) error {
	var lastErr error
	for attempt := 1; attempt <= 3; attempt++ {
		err := update()
		if err == nil {
			return nil
		}
		lastErr = err
		if !strings.Contains(err.Error(), "failed to acquire update lock") {
			return err
		}
		timer := time.NewTimer(time.Duration(attempt*10) * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
	return lastErr
}
