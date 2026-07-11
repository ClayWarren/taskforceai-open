package team

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/core/pkg/orchestrator"
	"github.com/TaskForceAI/go-engine/pkg/run"
	"github.com/danielgtaylor/huma/v2"
)

func teamInternalError(message string, err error, attrs ...any) error {
	args := append([]any{}, attrs...)
	args = append(args, "error", err)
	slog.Error("[TeamHandler] "+message, args...)
	return huma.Error500InternalServerError(message)
}

func verifyTeamSessionAccess(ctx context.Context, svc *orchestrator.TeamService, teamName string, sessionID string) error {
	if sessionID == "" {
		return huma.Error401Unauthorized("Unauthorized")
	}

	team, _, _, err := svc.FindBySession(ctx, sessionID)
	if err != nil {
		return teamInternalError("Failed to verify team session", err, "teamName", teamName)
	}
	if team == nil || team.Name != teamName {
		return huma.Error403Forbidden("Forbidden")
	}

	return nil
}

// RegisterHandlers registers the team handlers.
func RegisterHandlers(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-teams",
		Method:      http.MethodGet,
		Path:        "/api/v1/team",
		Summary:     "List teams",
		Tags:        []string{"Teams"},
	}, func(ctx context.Context, input *struct {
		handler.SessionAuthContext
		SessionID string `header:"x-session-id"`
	}) (*struct{ Body []orchestrator.TeamInfo }, error) {
		svc := run.GetTeamService()
		team, _, _, err := svc.FindBySession(ctx, input.SessionID)
		if err != nil {
			return nil, teamInternalError("Failed to list teams", err)
		}
		if team == nil {
			return &struct{ Body []orchestrator.TeamInfo }{Body: []orchestrator.TeamInfo{}}, nil
		}

		teams := []orchestrator.TeamInfo{*team}
		return &struct{ Body []orchestrator.TeamInfo }{Body: teams}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "get-team",
		Method:      http.MethodGet,
		Path:        "/api/v1/team/{name}",
		Summary:     "Get team details",
		Tags:        []string{"Teams"},
	}, func(ctx context.Context, input *struct {
		Name      string `path:"name"`
		SessionID string `header:"x-session-id"`
		handler.SessionAuthContext
	}) (*struct{ Body *orchestrator.TeamInfo }, error) {
		svc := run.GetTeamService()
		if err := verifyTeamSessionAccess(ctx, svc, input.Name, input.SessionID); err != nil {
			return nil, err
		}

		team, err := svc.Get(ctx, input.Name)
		if err != nil {
			return nil, huma.Error404NotFound("Team not found")
		}
		return &struct{ Body *orchestrator.TeamInfo }{Body: team}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "list-team-tasks",
		Method:      http.MethodGet,
		Path:        "/api/v1/team/{name}/tasks",
		Summary:     "List team tasks",
		Tags:        []string{"Teams"},
	}, func(ctx context.Context, input *struct {
		Name      string `path:"name"`
		SessionID string `header:"x-session-id"`
		handler.SessionAuthContext
	}) (*struct{ Body []orchestrator.TeamTask }, error) {
		svc := run.GetTeamService()
		if err := verifyTeamSessionAccess(ctx, svc, input.Name, input.SessionID); err != nil {
			return nil, err
		}

		tasks, err := svc.ListTasks(ctx, input.Name)
		if err != nil {
			return nil, teamInternalError("Failed to list team tasks", err, "teamName", input.Name)
		}
		return &struct{ Body []orchestrator.TeamTask }{Body: tasks}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "find-team-by-session",
		Method:      http.MethodGet,
		Path:        "/api/v1/team/by-session/{sessionID}",
		Summary:     "Find team by session ID",
		Tags:        []string{"Teams"},
	}, func(ctx context.Context, input *struct {
		SessionID       string `path:"sessionID"`
		CallerSessionID string `header:"x-session-id"`
		handler.SessionAuthContext
	}) (*struct {
		Body map[string]any
	}, error) {
		if input.CallerSessionID == "" {
			return nil, huma.Error401Unauthorized("Unauthorized")
		}
		if input.SessionID != input.CallerSessionID {
			return nil, huma.Error403Forbidden("Forbidden")
		}

		svc := run.GetTeamService()
		team, role, memberName, err := svc.FindBySession(ctx, input.SessionID)
		if err != nil {
			return nil, teamInternalError("Failed to find team session", err)
		}
		if team == nil {
			return &struct{ Body map[string]any }{Body: nil}, nil
		}

		tasks, _ := svc.ListTasks(ctx, team.Name)

		return &struct{ Body map[string]any }{
			Body: map[string]any{
				"team":       team,
				"tasks":      tasks,
				"role":       role,
				"memberName": memberName,
			},
		}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "set-team-delegate",
		Method:      http.MethodPost,
		Path:        "/api/v1/team/{name}/delegate",
		Summary:     "Set team delegate mode",
		Tags:        []string{"Teams"},
	}, func(ctx context.Context, input *struct {
		Name      string `path:"name"`
		SessionID string `header:"x-session-id"`
		handler.SessionAuthContext
		Body struct {
			Enabled bool `json:"enabled"`
		}
	}) (*struct{ Body map[string]any }, error) {
		svc := run.GetTeamService()
		if err := verifyTeamSessionAccess(ctx, svc, input.Name, input.SessionID); err != nil {
			return nil, err
		}

		err := svc.SetDelegate(ctx, input.Name, input.Body.Enabled)
		if err != nil {
			return nil, teamInternalError("Failed to set team delegate mode", err, "teamName", input.Name)
		}
		return &struct{ Body map[string]any }{
			Body: map[string]any{"ok": true, "delegate": input.Body.Enabled},
		}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "cancel-teammates",
		Method:      http.MethodPost,
		Path:        "/api/v1/team/{name}/cancel",
		Summary:     "Cancel teammates",
		Tags:        []string{"Teams"},
	}, func(ctx context.Context, input *struct {
		Name      string `path:"name"`
		SessionID string `header:"x-session-id"`
		handler.SessionAuthContext
		Body struct {
			Member string `json:"member"`
		}
	}) (*struct{ Body map[string]any }, error) {
		svc := run.GetTeamService()
		if err := verifyTeamSessionAccess(ctx, svc, input.Name, input.SessionID); err != nil {
			return nil, err
		}

		if input.Body.Member != "" {
			ok, err := svc.CancelMember(ctx, input.Name, input.Body.Member)
			if err != nil {
				if errors.Is(err, orchestrator.ErrMemberNotFound) {
					return &struct{ Body map[string]any }{
						Body: map[string]any{"ok": false, "cancelled": 0},
					}, nil
				}
				return nil, teamInternalError("Failed to cancel team member", err, "teamName", input.Name)
			}
			cancelled := 0
			if ok {
				cancelled = 1
			}
			return &struct{ Body map[string]any }{
				Body: map[string]any{"ok": ok, "cancelled": cancelled},
			}, nil
		}

		cancelled, err := svc.CancelAll(ctx, input.Name)
		if err != nil {
			return nil, teamInternalError("Failed to cancel team members", err, "teamName", input.Name)
		}
		return &struct{ Body map[string]any }{
			Body: map[string]any{"ok": true, "cancelled": cancelled},
		}, nil
	})
}
