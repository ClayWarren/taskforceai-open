package orchestrator

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/platform"
	"github.com/TaskForceAI/core/pkg/team"
	"github.com/TaskForceAI/core/pkg/tools"
)

func (o *TaskOrchestrator) execAgentsWithCheckpoint(ctx context.Context, teamName string, qs []string, images []agent.ContentPart, taskID string, userID *int32, completed []AgentResult) []AgentResult {
	results := make([]AgentResult, len(qs))
	var wg sync.WaitGroup
	var resultsMu sync.Mutex

	baseComputerUseCtx := tools.ComputerUseExecutionFromContext(ctx)

	baseDeps := AgentRunnerDeps{
		Config:            o.config,
		Orchestrator:      o,
		CacheNamespace:    o.namespace,
		UsageTracker:      o.usageTracker,
		ProgressTracker:   o.progressTracker,
		Budget:            o.budget,
		Telemetry:         o.telemetry,
		ErrorReporter:     o.errorReporter,
		Silent:            o.silent,
		Mock:              o.mock,
		Cache:             o.cache,
		LLMCache:          o.llmCache,
		GoogleDriveClient: o.googleDriveClient,
		Registry:          o.registry,
		TeamInbox:         o.TeamInbox,
		TeamName:          teamName,
		ApprovalRegistry:  o.approvalReg,
		TaskID:            taskID,
	}

	for i, q := range qs {
		roleName, _, _ := parseSubtaskOverrides(q)
		if roleName == "" {
			roleName = fmt.Sprintf("Agent-%d", i+1)
		}
		sessionID := fmt.Sprintf("%s:%d", teamName, i+1)

		var existing *AgentResult
		for _, r := range completed {
			if r.AgentName == roleName || r.AgentID == i+1 {
				if r.Status == "success" {
					existing = &r
					break
				}
			}
		}

		if existing != nil {
			platform.GetLogger().Info("Resuming agent from checkpoint", "role", roleName, "taskId", taskID)
			results[i] = *existing
			o.progressTracker.UpdateAgentProgress(i, StatusCompleted, existing.Response)
			continue
		}

		if err := o.TeamService.AddMember(ctx, teamName, team.Member{
			Name:            roleName,
			SessionID:       sessionID,
			Status:          team.MemberStatusReady,
			ExecutionStatus: team.ExecutionStatusIdle,
		}); err != nil {
			platform.GetLogger().Error("Failed to register team member", "role", roleName, "team", teamName, "error", err)
			results[i] = AgentResult{
				AgentID:   i + 1,
				AgentName: roleName,
				Status:    "error",
				Response:  err.Error(),
			}
			continue
		}

		agentIndex := i
		subtask := q
		memberRoleName := roleName
		memberSessionID := sessionID

		wg.Add(1)
		go withBackgroundRecovery(fmt.Sprintf("agent_%s_%d", teamName, agentIndex+1), o.panicReporter, func() {
			defer wg.Done()
			agentCtx, sessionCancel := context.WithCancel(ctx)
			o.registerSessionCancel(memberSessionID, sessionCancel)
			defer func() {
				o.clearSessionCancel(memberSessionID)
				sessionCancel()
			}()

			if o.timeout > 0 {
				var timeoutCancel context.CancelFunc
				agentCtx, timeoutCancel = context.WithTimeout(agentCtx, o.timeout)
				defer timeoutCancel()
			}

			if _, err := o.TeamService.TransitionMemberStatus(agentCtx, teamName, memberRoleName, team.MemberStatusBusy, true); err != nil {
				platform.GetLogger().Warn("Failed to transition member to busy", "role", memberRoleName, "team", teamName, "error", err)
			}

			d := baseDeps
			if modelID, ok := o.roleModelOverride(memberRoleName); ok {
				d.ModelID = modelID
			}

			if agentIndex == 0 {
				d.Images = images
			}
			d.AgentName = memberRoleName

			progressModelID := d.ModelID
			if progressModelID == "" {
				progressModelID = d.Config.Gateway.Model
			}
			o.progressTracker.SetAgentModel(agentIndex, progressModelID)

			teamCtx := context.WithValue(agentCtx, sessionIDKey, memberSessionID)
			teamCtx = tools.WithComputerUseExecutionContext(teamCtx, tools.ComputerUseExecutionContext{
				SessionID:           memberSessionID,
				ProfileKey:          baseComputerUseCtx.ProfileKey,
				UseLoggedInServices: baseComputerUseCtx.UseLoggedInServices,
			})

			res := RunAgentParallel(teamCtx, &d, agentIndex, subtask)

			resultsMu.Lock()
			results[agentIndex] = res
			o.saveTrace(ctx, taskID, userID, "", qs, results, "")
			resultsMu.Unlock()

			if _, err := o.TeamService.TransitionMemberStatus(agentCtx, teamName, memberRoleName, team.MemberStatusReady, true); err != nil {
				platform.GetLogger().Warn("Failed to transition member to ready", "role", memberRoleName, "team", teamName, "error", err)
			}
		})
	}

	wg.Wait()

	sort.Slice(results, func(i, j int) bool {
		return results[i].AgentID < results[j].AgentID
	})

	return results
}

func firstAgentFailureCause(results []AgentResult) error {
	for _, result := range results {
		if result.Status == "success" {
			continue
		}
		message := strings.TrimSpace(result.Response)
		message = strings.TrimSpace(strings.TrimPrefix(message, "Error:"))
		if message != "" {
			return errors.New(message)
		}
	}
	return nil
}

func (o *TaskOrchestrator) roleModelOverride(roleName string) (string, bool) {
	if isGenerationModelID(o.config.Gateway.Model) {
		return "", false
	}
	modelID, ok := o.roleModels[roleName]
	return modelID, ok && modelID != ""
}
