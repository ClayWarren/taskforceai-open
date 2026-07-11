package orchestrator

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/TaskForceAI/core/pkg/platform"
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
	service *TeamService
}

func NewTeamTools(service *TeamService) *TeamTools {
	return &TeamTools{service: service}
}

func (t *TeamTools) Register(registry *tools.ToolRegistry) {
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
		// sessionID needs to be injected via context or captured in closure
		sessionID, ok := ctx.Value(sessionIDKey).(string)
		if !ok || sessionID == "" {
			return tools.ToolResult{"content": "session ID not found in context", "title": "Error"}, nil
		}
		res, err := t.Message(ctx, ToolContext{SessionID: sessionID}, input.To, input.Text)
		if err != nil {
			return nil, err
		}
		return tools.ToolResult{"content": res.Output, "title": res.Title}, nil
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
		sessionID, ok := ctx.Value(sessionIDKey).(string)
		if !ok || sessionID == "" {
			return tools.ToolResult{"content": "session ID not found in context", "title": "Error"}, nil
		}
		res, err := t.Broadcast(ctx, ToolContext{SessionID: sessionID}, input.Text)
		if err != nil {
			return nil, err
		}
		return tools.ToolResult{"content": res.Output, "title": res.Title}, nil
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
			Action string     `json:"action"`
			TaskID string     `json:"taskID"`
			Tasks  []TeamTask `json:"tasks"`
		}
		if err := json.Unmarshal([]byte(args), &input); err != nil {
			return nil, err
		}
		sessionID, ok := ctx.Value(sessionIDKey).(string)
		if !ok || sessionID == "" {
			return tools.ToolResult{"content": "session ID not found in context", "title": "Error"}, nil
		}
		res, err := t.Tasks(ctx, ToolContext{SessionID: sessionID}, input.Action, input.Tasks, input.TaskID)
		if err != nil {
			return nil, err
		}
		return tools.ToolResult{"content": res.Output, "title": res.Title}, nil
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
		sessionID, ok := ctx.Value(sessionIDKey).(string)
		if !ok || sessionID == "" {
			return tools.ToolResult{"content": "session ID not found in context", "title": "Error"}, nil
		}
		res, err := t.Claim(ctx, ToolContext{SessionID: sessionID}, input.TaskID)
		if err != nil {
			return nil, err
		}
		return tools.ToolResult{"content": res.Output, "title": res.Title}, nil
	}))
}

// TeamCreateTool
func (t *TeamTools) Create(ctx context.Context, toolCtx ToolContext, name string, tasks []TeamTask, delegate bool) (*ToolResult, error) {
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
		if err := t.service.sessions.UpdatePermissions(ctx, toolCtx.SessionID, ""); err != nil {
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

	input := SpawnInput{
		TeamName:        teamInfo.Name,
		Name:            name,
		ParentSessionID: toolCtx.SessionID,
		Prompt:          prompt,
		ClaimTask:       claimTask,
		PlanApproval:    requirePlanApproval,
	}
	input.Agent.Name = agent
	if model != "" {
		parts := strings.SplitN(model, "/", 2)
		if len(parts) == 2 {
			input.Model.ProviderID = parts[0]
			input.Model.ModelID = parts[1]
		}
	}

	sessionID, label, err := t.service.SpawnMember(ctx, input)
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

// TeamMessageTool
func (t *TeamTools) Message(ctx context.Context, toolCtx ToolContext, to, text string) (*ToolResult, error) {
	teamInfo, role, memberName, err := t.service.FindBySession(ctx, toolCtx.SessionID)
	if err != nil {
		return &ToolResult{Title: "Error", Output: err.Error()}, err
	}
	if teamInfo == nil {
		return &ToolResult{Title: "Error", Output: "You are not part of any team."}, nil
	}

	from := role
	if role == "member" {
		from = memberName
	}

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

	from := role
	if role == "member" {
		from = memberName
	}

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
func (t *TeamTools) Tasks(ctx context.Context, toolCtx ToolContext, action string, tasks []TeamTask, taskID string) (*ToolResult, error) {
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

	name := role
	if role == "member" {
		name = memberName
	}

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

	var member *TeamMember
	for _, m := range teamInfo.Members {
		if m.Name == name {
			member = &m
			break
		}
	}
	if member == nil {
		return &ToolResult{Title: "Error", Output: fmt.Sprintf("Teammate %q not found.", name)}, nil
	}
	if member.Status == MemberStatusShutdown {
		return &ToolResult{Title: "Already shutdown", Output: fmt.Sprintf("Teammate %q is already shut down.", name)}, nil
	}

	if reason == "" {
		reason = "The lead has requested you shut down."
	}

	// Transition to shutdown_requested BEFORE sending message
	if _, err := t.service.TransitionMemberStatus(ctx, teamInfo.Name, name, MemberStatusShutdownRequested, true); err != nil {
		platform.GetLogger().Warn("Failed to mark teammate shutdown requested", "team", teamInfo.Name, "member", name, "error", err)
	}

	if err := t.service.bus.Publish(ctx, "team.shutdown.request", map[string]any{
		"teamName":   teamInfo.Name,
		"memberName": name,
	}); err != nil {
		platform.GetLogger().Warn("Failed to publish team shutdown request", "team", teamInfo.Name, "member", name, "error", err)
	}

	text := strings.Join([]string{
		"SHUTDOWN REQUEST: " + reason,
		"",
		"Please wrap up your current work:",
		"1. Summarize your findings and send them to the lead.",
		"2. Stop working after sending your summary.",
	}, "\n")

	if err := t.service.Send(ctx, teamInfo.Name, "lead", name, text); err != nil {
		// Fallback to direct shutdown if message fails
		if _, transitionErr := t.service.TransitionMemberStatus(ctx, teamInfo.Name, name, MemberStatusShutdown, true); transitionErr != nil {
			platform.GetLogger().Warn("Failed to force teammate shutdown after shutdown message failed", "team", teamInfo.Name, "member", name, "sendError", err, "error", transitionErr)
		}
	}

	if member.Status == MemberStatusBusy {
		if _, err := t.service.CancelMember(ctx, teamInfo.Name, name); err != nil {
			platform.GetLogger().Warn("Failed to cancel busy teammate after shutdown request", "team", teamInfo.Name, "member", name, "error", err)
		}
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
