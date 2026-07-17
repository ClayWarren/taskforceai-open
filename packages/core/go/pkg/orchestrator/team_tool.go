package orchestrator

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/TaskForceAI/core/pkg/platform"
	"github.com/TaskForceAI/core/pkg/team"
	"github.com/TaskForceAI/core/pkg/tools"
)

type ToolResult struct {
	Title    string         `json:"title"`
	Output   string         `json:"output"`
	Metadata map[string]any `json:"metadata"`
}

type ToolContext struct {
	SessionID string
}

type TeamTools struct {
	service    *team.Service
	runnerDeps *TeamRunnerDeps
}

func teamToolContext(ctx context.Context) (ToolContext, bool) {
	sessionID, ok := ctx.Value(sessionIDKey).(string)
	return ToolContext{SessionID: sessionID}, ok && sessionID != ""
}

func registeredToolResult(result *ToolResult, err error) (tools.ToolResult, error) {
	if err != nil {
		return nil, err
	}
	return tools.ToolResult{"content": result.Output, "title": result.Title}, nil
}

func teamMemberIdentity(role, memberName string) string {
	if role == "member" {
		return memberName
	}
	return role
}

func NewTeamTools(service *team.Service) *TeamTools {
	return &TeamTools{service: service}
}

func NewTeamToolsWithRunnerDeps(service *team.Service, deps TeamRunnerDeps) *TeamTools {
	return &TeamTools{service: service, runnerDeps: cloneTeamRunnerDeps(&deps)}
}

func (t *TeamTools) Register(registry *tools.ToolRegistry) {
	registry.Register(tools.NewBaseTool("team_create", "Create a team and become its lead. Do this before spawning teammates.", tools.ToolParameters{
		Type: "object",
		Properties: map[string]any{
			"name": map[string]any{"type": "string", "description": "A name for the team"},
			"tasks": map[string]any{
				"type":        "array",
				"description": "Optional initial tasks for the shared task board",
				"items":       map[string]any{"type": "object"},
			},
			"delegate": map[string]any{
				"type":        "boolean",
				"description": "Delegate mode: restrict yourself to coordination-only tools (no write/edit/bash) once the team is created",
			},
		},
		Required: []string{"name"},
	}, func(ctx context.Context, args string) (tools.ToolResult, error) {
		var input struct {
			Name     string      `json:"name"`
			Tasks    []team.Task `json:"tasks"`
			Delegate bool        `json:"delegate"`
		}
		if err := json.Unmarshal([]byte(args), &input); err != nil {
			return nil, err
		}
		toolCtx, ok := teamToolContext(ctx)
		if !ok {
			return tools.ToolResult{"content": "session ID not found in context", "title": "Error"}, nil
		}
		return registeredToolResult(t.Create(ctx, toolCtx, input.Name, input.Tasks, input.Delegate))
	}))

	registry.Register(tools.NewBaseTool("team_spawn", "Spawn a teammate to work in parallel. Only the team lead can spawn teammates.", tools.ToolParameters{
		Type: "object",
		Properties: map[string]any{
			"name":  map[string]any{"type": "string", "description": "A unique name for this teammate"},
			"agent": map[string]any{"type": "string", "description": "The agent type/role this teammate should use"},
			"model": map[string]any{"type": "string", "description": "Optional model override, formatted as 'provider/model'"},
			"prompt": map[string]any{
				"type":        "string",
				"description": "The task and instructions for this teammate",
			},
			"claimTask": map[string]any{"type": "string", "description": "Optional task ID from the shared board for this teammate to claim immediately"},
			"requirePlanApproval": map[string]any{
				"type":        "boolean",
				"description": "Require this teammate to submit a plan for your approval before it can write, edit, or run bash commands",
			},
		},
		Required: []string{"name", "agent", "prompt"},
	}, func(ctx context.Context, args string) (tools.ToolResult, error) {
		var input struct {
			Name                string `json:"name"`
			Agent               string `json:"agent"`
			Model               string `json:"model"`
			Prompt              string `json:"prompt"`
			ClaimTask           string `json:"claimTask"`
			RequirePlanApproval bool   `json:"requirePlanApproval"`
		}
		if err := json.Unmarshal([]byte(args), &input); err != nil {
			return nil, err
		}
		toolCtx, ok := teamToolContext(ctx)
		if !ok {
			return tools.ToolResult{"content": "session ID not found in context", "title": "Error"}, nil
		}
		return registeredToolResult(t.Spawn(ctx, toolCtx, input.Name, input.Agent, input.Model, input.Prompt, input.ClaimTask, input.RequirePlanApproval))
	}))

	registry.Register(tools.NewBaseTool("team_approve_plan", "Approve or reject a plan submitted by a teammate in plan mode. Only the team lead can approve plans.", tools.ToolParameters{
		Type: "object",
		Properties: map[string]any{
			"name":     map[string]any{"type": "string", "description": "The teammate whose plan you're reviewing"},
			"approved": map[string]any{"type": "boolean", "description": "Whether to approve the plan and unlock write access"},
			"feedback": map[string]any{"type": "string", "description": "Optional feedback for the teammate, especially if rejecting"},
		},
		Required: []string{"name", "approved"},
	}, func(ctx context.Context, args string) (tools.ToolResult, error) {
		var input struct {
			Name     string `json:"name"`
			Approved bool   `json:"approved"`
			Feedback string `json:"feedback"`
		}
		if err := json.Unmarshal([]byte(args), &input); err != nil {
			return nil, err
		}
		toolCtx, ok := teamToolContext(ctx)
		if !ok {
			return tools.ToolResult{"content": "session ID not found in context", "title": "Error"}, nil
		}
		return registeredToolResult(t.ApprovePlan(ctx, toolCtx, input.Name, input.Approved, input.Feedback))
	}))

	registry.Register(tools.NewBaseTool("team_shutdown", "Request a teammate to wrap up and stop. Only the team lead can shut down teammates.", tools.ToolParameters{
		Type: "object",
		Properties: map[string]any{
			"name":   map[string]any{"type": "string", "description": "The teammate to shut down"},
			"reason": map[string]any{"type": "string", "description": "Optional reason to give the teammate"},
		},
		Required: []string{"name"},
	}, func(ctx context.Context, args string) (tools.ToolResult, error) {
		var input struct {
			Name   string `json:"name"`
			Reason string `json:"reason"`
		}
		if err := json.Unmarshal([]byte(args), &input); err != nil {
			return nil, err
		}
		toolCtx, ok := teamToolContext(ctx)
		if !ok {
			return tools.ToolResult{"content": "session ID not found in context", "title": "Error"}, nil
		}
		return registeredToolResult(t.Shutdown(ctx, toolCtx, input.Name, input.Reason))
	}))

	registry.Register(tools.NewBaseTool("team_cleanup", "Remove a team's resources once every teammate has shut down. Only the team lead can clean up.", tools.ToolParameters{
		Type: "object",
		Properties: map[string]any{
			"name": map[string]any{"type": "string", "description": "The team to clean up"},
		},
		Required: []string{"name"},
	}, func(ctx context.Context, args string) (tools.ToolResult, error) {
		var input struct {
			Name string `json:"name"`
		}
		if err := json.Unmarshal([]byte(args), &input); err != nil {
			return nil, err
		}
		toolCtx, ok := teamToolContext(ctx)
		if !ok {
			return tools.ToolResult{"content": "session ID not found in context", "title": "Error"}, nil
		}
		return registeredToolResult(t.Cleanup(ctx, toolCtx, input.Name))
	}))

	registry.Register(tools.NewBaseTool("team_message", "Send a message to the lead or another teammate.", tools.ToolParameters{
		Type: "object",
		Properties: map[string]any{
			"to":   map[string]any{"type": "string", "description": "Name of the teammate or 'lead'"},
			"text": map[string]any{"type": "string", "description": "The message text"},
		},
		Required: []string{"to", "text"},
	}, func(ctx context.Context, args string) (tools.ToolResult, error) {
		var input struct {
			To   string `json:"to"`
			Text string `json:"text"`
		}
		if err := json.Unmarshal([]byte(args), &input); err != nil {
			return nil, err
		}
		toolCtx, ok := teamToolContext(ctx)
		if !ok {
			return tools.ToolResult{"content": "session ID not found in context", "title": "Error"}, nil
		}
		return registeredToolResult(t.Message(ctx, toolCtx, input.To, input.Text))
	}))

	registry.Register(tools.NewBaseTool("team_broadcast", "Send a message to ALL teammates.", tools.ToolParameters{
		Type: "object",
		Properties: map[string]any{
			"text": map[string]any{"type": "string", "description": "The message text"},
		},
		Required: []string{"text"},
	}, func(ctx context.Context, args string) (tools.ToolResult, error) {
		var input struct {
			Text string `json:"text"`
		}
		if err := json.Unmarshal([]byte(args), &input); err != nil {
			return nil, err
		}
		toolCtx, ok := teamToolContext(ctx)
		if !ok {
			return tools.ToolResult{"content": "session ID not found in context", "title": "Error"}, nil
		}
		return registeredToolResult(t.Broadcast(ctx, toolCtx, input.Text))
	}))

	registry.Register(tools.NewBaseTool("team_tasks", "Manage the shared task board.", tools.ToolParameters{
		Type: "object",
		Properties: map[string]any{
			"action": map[string]any{"type": "string", "enum": []string{"list", "add", "complete", "update"}},
			"taskID": map[string]any{"type": "string", "description": "Required for 'complete'"},
			"tasks":  map[string]any{"type": "array", "items": map[string]any{"type": "object"}},
		},
		Required: []string{"action"},
	}, func(ctx context.Context, args string) (tools.ToolResult, error) {
		var input struct {
			Action string      `json:"action"`
			TaskID string      `json:"taskID"`
			Tasks  []team.Task `json:"tasks"`
		}
		if err := json.Unmarshal([]byte(args), &input); err != nil {
			return nil, err
		}
		toolCtx, ok := teamToolContext(ctx)
		if !ok {
			return tools.ToolResult{"content": "session ID not found in context", "title": "Error"}, nil
		}
		return registeredToolResult(t.Tasks(ctx, toolCtx, input.Action, input.Tasks, input.TaskID))
	}))

	registry.Register(tools.NewBaseTool("team_claim", "Claim a pending task from the shared task list.", tools.ToolParameters{
		Type: "object",
		Properties: map[string]any{
			"taskID": map[string]any{"type": "string"},
		},
		Required: []string{"taskID"},
	}, func(ctx context.Context, args string) (tools.ToolResult, error) {
		var input struct {
			TaskID string `json:"taskID"`
		}
		if err := json.Unmarshal([]byte(args), &input); err != nil {
			return nil, err
		}
		toolCtx, ok := teamToolContext(ctx)
		if !ok {
			return tools.ToolResult{"content": "session ID not found in context", "title": "Error"}, nil
		}
		return registeredToolResult(t.Claim(ctx, toolCtx, input.TaskID))
	}))
}

// TeamCreateTool
func (t *TeamTools) Create(ctx context.Context, toolCtx ToolContext, name string, tasks []team.Task, delegate bool) (*ToolResult, error) {
	existing, _, _, err := t.service.FindBySession(ctx, toolCtx.SessionID)
	if err != nil {
		return &ToolResult{Title: "Error", Output: err.Error()}, err
	}
	if existing != nil {
		return &ToolResult{
			Title:  "Error",
			Output: fmt.Sprintf("You are already part of team %q.", existing.Name),
		}, nil
	}

	_, err = t.service.Create(ctx, name, toolCtx.SessionID, delegate)
	if err != nil {
		return &ToolResult{Title: "Error", Output: err.Error()}, err
	}

	if len(tasks) > 0 {
		if err := t.service.AddTasks(ctx, name, tasks); err != nil {
			return &ToolResult{Title: "Error", Output: err.Error()}, err
		}
	}

	// Delegate mode: restrict the lead to coordination-only tools
	if delegate {
		if err := t.service.RestrictLeadPermissions(ctx, toolCtx.SessionID); err != nil {
			platform.GetLogger().Warn("Failed to restrict lead permissions for delegate team", "team", name, "sessionId", toolCtx.SessionID, "error", err)
		}
	}

	output := []string{
		fmt.Sprintf("Team %q created. You are the lead.", name),
	}
	if delegate {
		output = append(output, "DELEGATE MODE: You are restricted to coordination tools only (no write/edit/bash).")
	}

	output = append(output,
		"",
		"Next steps:",
		"- Use team_spawn to add teammates",
		"- Use team_tasks to manage the shared task list",
		"- Use team_message to communicate with teammates",
		"",
		"Lifecycle:",
		"- When teammates finish, use team_shutdown to shut them down",
		"- Once all teammates are shut down, use team_cleanup to remove team resources",
		"- If all teammates shut down on their own (idle→shutdown), cleanup happens automatically",
	)

	return &ToolResult{
		Title:  fmt.Sprintf("Created team: %s", name),
		Output: strings.Join(output, "\n"),
		Metadata: map[string]any{
			"teamName": name,
			"delegate": delegate,
		},
	}, nil
}

// TeamSpawnTool
func (t *TeamTools) Spawn(ctx context.Context, toolCtx ToolContext, name, agent, model, prompt, claimTask string, requirePlanApproval bool) (*ToolResult, error) {
	if name == "lead" {
		return &ToolResult{Title: "Error", Output: "Name 'lead' is reserved."}, nil
	}

	teamInfo, role, _, err := t.service.FindBySession(ctx, toolCtx.SessionID)
	if err != nil {
		return &ToolResult{Title: "Error", Output: err.Error()}, err
	}
	if teamInfo == nil {
		return &ToolResult{Title: "Error", Output: "You are not the lead of any team. Create a team first."}, nil
	}
	if role != "lead" {
		return &ToolResult{Title: "Error", Output: "Only the lead can spawn teammates."}, nil
	}

	resolvedModel, runnerDeps, err := t.resolveSpawnModel(ctx, model, toolCtx.SessionID)
	if err != nil {
		return &ToolResult{Title: "Error", Output: err.Error()}, err
	}

	input := team.SpawnInput{
		TeamName:        teamInfo.Name,
		Name:            name,
		ParentSessionID: toolCtx.SessionID,
		Prompt:          prompt,
		ClaimTask:       claimTask,
		PlanApproval:    requirePlanApproval,
	}
	input.Agent.Name = agent
	input.Model.ProviderID = resolvedModel.ProviderID
	input.Model.ModelID = resolvedModel.ModelID

	sessionID, label, err := t.service.SpawnMember(withTeamRunnerDeps(ctx, runnerDeps), input)
	if err != nil {
		return &ToolResult{Title: "Error", Output: err.Error()}, err
	}

	return &ToolResult{
		Title:  fmt.Sprintf("Spawned teammate: %s", name),
		Output: fmt.Sprintf("Teammate %q spawned using model %s.\nSession ID: %s", name, label, sessionID),
		Metadata: map[string]any{
			"teamName":     teamInfo.Name,
			"memberName":   name,
			"sessionID":    sessionID,
			"model":        label,
			"planApproval": requirePlanApproval,
		},
	}, nil
}

func (t *TeamTools) resolveSpawnModel(ctx context.Context, requestedModel, parentSessionID string) (team.ModelInfo, *TeamRunnerDeps, error) {
	if t.runnerDeps == nil {
		resolved, err := t.service.ResolveModel(ctx, requestedModel, nil, parentSessionID)
		return resolved, nil, err
	}

	deps := cloneTeamRunnerDeps(t.runnerDeps)
	selectedID := strings.TrimSpace(requestedModel)
	if len(deps.Config.Models.Options) > 0 {
		selection, err := ResolveModelSelection(deps.Config, selectedID)
		if err != nil {
			return team.ModelInfo{}, nil, err
		}
		deps.Config = selection.Config
		selectedID = selection.SelectedModel.ID
	} else {
		configuredID := strings.TrimSpace(deps.Config.Gateway.Model)
		if selectedID == "" {
			selectedID = configuredID
		}
		if selectedID == "" {
			return team.ModelInfo{}, nil, ErrNoModelsConfigured
		}
		deps.Config.Gateway.Model = selectedID
	}

	providerID, modelID, found := strings.Cut(selectedID, "/")
	if !found || providerID == "" || modelID == "" {
		return team.ModelInfo{}, nil, fmt.Errorf("invalid model %q: expected provider/model", selectedID)
	}
	return team.ModelInfo{ProviderID: providerID, ModelID: modelID}, deps, nil
}

// TeamMessageTool
func (t *TeamTools) Message(ctx context.Context, toolCtx ToolContext, to, text string) (*ToolResult, error) {
	teamInfo, role, memberName, err := t.service.FindBySession(ctx, toolCtx.SessionID)
	if err != nil {
		return &ToolResult{Title: "Error", Output: err.Error()}, err
	}
	if teamInfo == nil {
		return &ToolResult{Title: "Error", Output: "You are not part of any team."}, nil
	}

	from := teamMemberIdentity(role, memberName)
	err = t.service.Send(ctx, teamInfo.Name, from, to, text)
	if err != nil {
		return &ToolResult{Title: "Error", Output: err.Error()}, err
	}

	return &ToolResult{
		Title:  fmt.Sprintf("Message sent to %s", to),
		Output: fmt.Sprintf("Message delivered to %q.", to),
		Metadata: map[string]any{
			"to": to,
		},
	}, nil
}

// TeamBroadcastTool
func (t *TeamTools) Broadcast(ctx context.Context, toolCtx ToolContext, text string) (*ToolResult, error) {
	teamInfo, role, memberName, err := t.service.FindBySession(ctx, toolCtx.SessionID)
	if err != nil {
		return &ToolResult{Title: "Error", Output: err.Error()}, err
	}
	if teamInfo == nil {
		return &ToolResult{Title: "Error", Output: "You are not part of any team."}, nil
	}

	from := teamMemberIdentity(role, memberName)
	err = t.service.Broadcast(ctx, teamInfo.Name, from, text)
	if err != nil {
		return &ToolResult{Title: "Error", Output: err.Error()}, err
	}

	return &ToolResult{
		Title:    "Broadcast sent",
		Output:   "Broadcast sent to all teammates.",
		Metadata: map[string]any{},
	}, nil
}

// TeamTasksTool
func (t *TeamTools) Tasks(ctx context.Context, toolCtx ToolContext, action string, tasks []team.Task, taskID string) (*ToolResult, error) {
	teamInfo, _, _, err := t.service.FindBySession(ctx, toolCtx.SessionID)
	if err != nil {
		return &ToolResult{Title: "Error", Output: err.Error()}, err
	}
	if teamInfo == nil {
		return &ToolResult{Title: "Error", Output: "You are not part of any team."}, nil
	}

	switch action {
	case "list":
		list, err := t.service.ListTasks(ctx, teamInfo.Name)
		if err != nil {
			return &ToolResult{Title: "Error", Output: err.Error()}, err
		}
		if len(list) == 0 {
			return &ToolResult{Title: "Task list", Output: "No tasks found."}, nil
		}
		var out []string
		for _, task := range list {
			out = append(out, fmt.Sprintf("[%s] %s - %s (%s)", task.ID, task.Content, task.Status, task.Priority))
		}
		return &ToolResult{Title: "Task list", Output: strings.Join(out, "\n")}, nil
	case "add":
		if err := t.service.AddTasks(ctx, teamInfo.Name, tasks); err != nil {
			return &ToolResult{Title: "Error", Output: err.Error()}, err
		}
		return &ToolResult{Title: "Tasks added", Output: fmt.Sprintf("Added %d tasks.", len(tasks))}, nil
	case "complete":
		if err := t.service.CompleteTask(ctx, teamInfo.Name, taskID); err != nil {
			return &ToolResult{Title: "Error", Output: err.Error()}, err
		}
		return &ToolResult{Title: "Task completed", Output: fmt.Sprintf("Task %q marked as completed.", taskID)}, nil
	case "update":
		if err := t.service.UpdateTasks(ctx, teamInfo.Name, tasks); err != nil {
			return &ToolResult{Title: "Error", Output: err.Error()}, err
		}
		return &ToolResult{Title: "Tasks updated", Output: "Task list replaced."}, nil
	default:
		return &ToolResult{Title: "Error", Output: "Unknown action"}, nil
	}
}

// TeamClaimTool
func (t *TeamTools) Claim(ctx context.Context, toolCtx ToolContext, taskID string) (*ToolResult, error) {
	teamInfo, role, memberName, err := t.service.FindBySession(ctx, toolCtx.SessionID)
	if err != nil {
		return &ToolResult{Title: "Error", Output: err.Error()}, err
	}
	if teamInfo == nil {
		return &ToolResult{Title: "Error", Output: "You are not part of any team."}, nil
	}

	name := teamMemberIdentity(role, memberName)
	claimed, err := t.service.ClaimTask(ctx, teamInfo.Name, taskID, name)
	if err != nil {
		return &ToolResult{Title: "Error", Output: err.Error()}, err
	}

	if claimed {
		return &ToolResult{Title: "Task claimed", Output: fmt.Sprintf("You claimed task %q.", taskID)}, nil
	}
	return &ToolResult{Title: "Claim failed", Output: "Task is blocked or already taken."}, nil
}

// TeamApprovePlanTool
func (t *TeamTools) ApprovePlan(ctx context.Context, toolCtx ToolContext, name string, approved bool, feedback string) (*ToolResult, error) {
	teamInfo, role, _, err := t.service.FindBySession(ctx, toolCtx.SessionID)
	if err != nil {
		return &ToolResult{Title: "Error", Output: err.Error()}, err
	}
	if teamInfo == nil {
		return &ToolResult{Title: "Error", Output: "You are not leading a team."}, nil
	}
	if role != "lead" {
		return &ToolResult{Title: "Error", Output: "Only the lead can approve plans."}, nil
	}

	err = t.service.ApprovePlan(ctx, teamInfo.Name, name, approved, feedback)
	if err != nil {
		return &ToolResult{Title: "Error", Output: err.Error()}, err
	}

	res := "approved"
	if !approved {
		res = "rejected"
	}
	return &ToolResult{Title: "Plan " + res, Output: fmt.Sprintf("Plan for %q has been %s.", name, res)}, nil
}

// TeamShutdownTool
func (t *TeamTools) Shutdown(ctx context.Context, toolCtx ToolContext, name, reason string) (*ToolResult, error) {
	teamInfo, role, _, err := t.service.FindBySession(ctx, toolCtx.SessionID)
	if err != nil {
		return &ToolResult{Title: "Error", Output: err.Error()}, err
	}
	if teamInfo == nil || role != "lead" {
		return &ToolResult{Title: "Error", Output: "Only the team lead can shut down teammates."}, nil
	}

	var member *team.Member
	for _, m := range teamInfo.Members {
		if m.Name == name {
			member = &m
			break
		}
	}
	if member == nil {
		return &ToolResult{Title: "Error", Output: fmt.Sprintf("Teammate %q not found.", name)}, nil
	}
	if member.Status == team.MemberStatusShutdown {
		return &ToolResult{Title: "Already shutdown", Output: fmt.Sprintf("Teammate %q is already shut down.", name)}, nil
	}

	if reason == "" {
		reason = "The lead has requested you shut down."
	}

	if err := t.service.RequestMemberShutdown(ctx, teamInfo.Name, name, reason); err != nil {
		return &ToolResult{Title: "Error", Output: err.Error()}, err
	}

	return &ToolResult{
		Title:    fmt.Sprintf("Shutdown requested: %s", name),
		Output:   fmt.Sprintf("Shutdown request sent to %q. They will wrap up current work and stop.", name),
		Metadata: map[string]any{},
	}, nil
}

// TeamCleanupTool
func (t *TeamTools) Cleanup(ctx context.Context, toolCtx ToolContext, name string) (*ToolResult, error) {
	teamInfo, role, _, err := t.service.FindBySession(ctx, toolCtx.SessionID)
	if err != nil {
		return &ToolResult{Title: "Error", Output: err.Error()}, err
	}
	if teamInfo == nil || role != "lead" || teamInfo.Name != name {
		return &ToolResult{Title: "Error", Output: "Only the lead can clean up the team."}, nil
	}

	err = t.service.Cleanup(ctx, name)
	if err != nil {
		return &ToolResult{Title: "Error", Output: err.Error()}, err
	}
	return &ToolResult{Title: "Team cleaned up", Output: fmt.Sprintf("Team %q has been cleaned up.", name)}, nil
}
