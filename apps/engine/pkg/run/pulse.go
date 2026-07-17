package run

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/TaskForceAI/core/pkg/orchestrator"
)

func setPulseAgentStatus(ctx context.Context, store pulseAgentStore, agentID string, status string, ttl time.Duration) {
	if err := store.UpdateAgentStatus(ctx, pulseAgentStatusUpdate{ID: agentID, Status: status}); err != nil {
		slog.Warn("[OrchestratePulseTurn] Failed to update agent status", "agentId", agentID, "status", status, "error", err)
	}

	if r, err := RedisClientGetter(); err == nil && r != nil {
		if err := r.Set(ctx, "agent_status:"+agentID, []byte(status), ttl); err != nil {
			slog.Warn("[OrchestratePulseTurn] Failed to update agent status in Redis", "agentId", agentID, "status", status, "error", err)
		}
	}
}

func setPulseAgentIdle(ctx context.Context, store pulseAgentStore, agentID string) {
	cleanupCtx, cleanupCancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cleanupCancel()
	setPulseAgentStatus(cleanupCtx, store, agentID, "IDLE", 24*time.Hour)
}

// OrchestratePulseTurn runs an autonomous turn for an agent triggered by a pulse.
func OrchestratePulseTurn(ctx context.Context, agentID string, reason string) {
	const pulseTurnTimeout = 5 * time.Minute
	ctx, cancel := context.WithTimeout(ctx, pulseTurnTimeout)
	defer cancel()

	ctx, pulseSpan := startPulseSpan(ctx, agentID, reason)
	start := time.Now()
	var pulseErr error
	defer func() {
		finishPulseObservation(ctx, pulseSpan, start, pulseErr)
	}()

	slog.Info("[OrchestratePulseTurn] Starting pulse turn", "agentId", agentID, "reason", reason)

	store, err := loadPulseAgentStore(ctx)
	if err != nil {
		pulseErr = fmt.Errorf("failed to get DB queries: %w", err)
		slog.Error("[OrchestratePulseTurn] Failed to get DB queries", "error", err)
		return
	}

	agentRow, err := store.GetAgent(ctx, agentID)
	if err != nil {
		pulseErr = fmt.Errorf("failed to fetch agent: %w", err)
		slog.Error("[OrchestratePulseTurn] Failed to fetch agent", "agentId", agentID, "error", err)
		return
	}

	userID := int(agentRow.UserID)
	taskID := "pulse_" + uuid.New().String()
	modelID := ""
	if agentRow.ModelID != nil && *agentRow.ModelID != "" {
		modelID = strings.TrimSpace(*agentRow.ModelID)
	}

	setPulseAgentStatus(ctx, store, agentID, "BUSY", 30*time.Minute)
	setIdleStatus := func() { setPulseAgentIdle(ctx, store, agentID) }

	prompt := fmt.Sprintf("You are waking up for your scheduled autonomous check (reason: %s). Check your team inbox for new messages and tasks. If there is work to do, proceed. If not, provide a brief status update and go back to sleep.", reason)

	userContext, err := LoadRunUserContext(ctx, UserContextLoadInput{UserID: agentRow.UserID})
	if err != nil {
		pulseErr = fmt.Errorf("user context load failed: %w", err)
		slog.Error("[OrchestratePulseTurn] User context load failed", "error", err)
		setIdleStatus()
		return
	}
	if userContext.UserPlan == "" {
		userContext.UserPlan = "free"
	}

	opts := OrchestrateTaskOptions{
		UserPlan:         userContext.UserPlan,
		QuickModeEnabled: false,
		Source:           "pulse",
	}

	cfg, err := prepareConfig(taskID, modelID, opts)
	if err != nil {
		pulseErr = fmt.Errorf("config load failed: %w", err)
		slog.Error("[OrchestratePulseTurn] Config load failed", "error", err)
		setIdleStatus()
		return
	}
	if strings.TrimSpace(modelID) == "" {
		modelID = strings.TrimSpace(cfg.Gateway.Model)
	}
	if strings.TrimSpace(modelID) == "" {
		modelID = strings.TrimSpace(cfg.Models.Default)
	}

	adapter, err := ResolveAdapter(ctx, cfg, modelID)
	if err != nil {
		pulseErr = fmt.Errorf("adapter resolution failed: %w", err)
		slog.Error("[OrchestratePulseTurn] Adapter resolution failed", "error", err)
		setIdleStatus()
		return
	}

	var traceRepo *Repository
	if userContext.TrustLayerEnabled {
		if repo, err := LoadTraceRepository(ctx); err == nil {
			traceRepo = repo
		}
	}

	orch := InitOrchestrator(OrchestratorInitInput{
		Config:               cfg,
		UserID:               userID,
		Memories:             userContext.Memories,
		DriveClient:          userContext.DriveClient,
		ProjectInstructions:  userContext.ProjectInstructions,
		GithubToken:          userContext.GithubToken,
		LLMAdapter:           adapter,
		TraceRepo:            traceRepo,
		AutonomyEnabled:      true,
		WebSearchEnabled:     userContext.WebSearchEnabled,
		CodeExecutionEnabled: userContext.CodeExecutionEnabled,
	})

	if err := GetRegistry().Register(taskID, userID, prompt, modelID, opts); err != nil {
		pulseErr = fmt.Errorf("task registration failed: %w", err)
		slog.Error("[OrchestratePulseTurn] Task registration failed", "taskId", taskID, "error", err)
		setIdleStatus()
		return
	}

	result, trace, err := ExecutePulseOrchestration(ctx, orch, prompt, taskID, userID, userContext.TrustLayerEnabled)
	if err != nil {
		pulseErr = fmt.Errorf("pulse orchestration failed: %w", err)
		slog.Error("[OrchestratePulseTurn] Orchestration failed", "error", err)
		if updateErr := updateTaskStatusWithLockRetry(ctx, GetRegistry(), taskID, StatusFailed, "", err.Error()); updateErr != nil {
			slog.Warn("[OrchestratePulseTurn] Failed to persist failed pulse task state", "taskId", taskID, "error", updateErr)
		}
		setIdleStatus()
		return
	}

	now := time.Now()
	interval := time.Duration(agentRow.CheckInterval) * time.Second
	nextDue := now.Add(interval)

	err = store.UpdateAgentPulseState(ctx, pulseAgentPulseStateUpdate{
		ID:        agentID,
		LastRunAt: now,
		NextRunAt: nextDue,
	})
	logPulseStateUpdateError(err)

	setIdleStatus()

	slog.Info("[OrchestratePulseTurn] Pulse turn finished", "agentId", agentID, "duration", time.Since(start).String(), "result", result)

	var traceID string
	if trace != nil {
		traceID = "trace_" + taskID
	}
	FinalizeTask(ctx, taskID, userID, prompt, modelID, result, trace, cfg, nil, true, userContext.MemoryEnabled, opts, traceID)
}

func logPulseStateUpdateError(err error) {
	if err != nil {
		slog.Warn("[OrchestratePulseTurn] Failed to update agent pulse state", "error", err)
	}
}

func executePulseOrchestration(ctx context.Context, orch *orchestrator.TaskOrchestrator, prompt, taskID string, userID int, trustLayerEnabled bool) (string, *orchestrator.OrchestrationTrace, error) {
	if orch == nil {
		return "", nil, fmt.Errorf("orchestrator is nil")
	}
	trustUserID, err := trustLayerUserID(userID, trustLayerEnabled)
	if err != nil {
		return "", nil, err
	}
	if trustUserID != nil {
		return ExecuteOrchestrateWithTask(orch, ctx, prompt, taskID, trustUserID)
	}
	return ExecuteOrchestrate(orch, ctx, prompt)
}

func trustLayerUserID(userID int, enabled bool) (*int32, error) {
	if !enabled {
		return nil, nil //nolint:nilnil // Disabled trust intentionally has no user ID.
	}
	if userID > math.MaxInt32 || userID < 0 {
		return nil, fmt.Errorf("userID out of range: %d", userID)
	}
	id := int32(userID)
	return &id, nil
}
