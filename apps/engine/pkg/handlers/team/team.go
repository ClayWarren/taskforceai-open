package team

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/TaskForceAI/adapters/pkg/handler"
	coreteam "github.com/TaskForceAI/core/pkg/team"
	handlercommon "github.com/TaskForceAI/go-engine/pkg/handlers/common"
	"github.com/TaskForceAI/go-engine/pkg/run"
	"github.com/danielgtaylor/huma/v2"
)

func teamInternalError(message string, err error, attrs ...any) error {
	args := append([]any{}, attrs...)
	args = append(args, "error", err)
	slog.Error("[TeamHandler] "+message, args...)
	return huma.Error500InternalServerError(message)
}

func verifyTeamSessionAccess(ctx context.Context, svc *coreteam.Service, teamName string, sessionID string) error {
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
	huma.Register(api, handlercommon.Operation("Teams", "list-teams", http.MethodGet, "/api/v1/team", "List teams"), func(ctx context.Context, input *struct {
		handler.SessionAuthContext
		SessionID string `header:"x-session-id"`
	}) (*struct{ Body []coreteam.Team }, error) {
		svc := run.GetTeamService()
		team, _, _, err := svc.FindBySession(ctx, input.SessionID)
		if err != nil {
			return nil, teamInternalError("Failed to list teams", err)
		}
		if team == nil {
			return &struct{ Body []coreteam.Team }{Body: []coreteam.Team{}}, nil
		}

		teams := []coreteam.Team{*team}
		return &struct{ Body []coreteam.Team }{Body: teams}, nil
	})

	huma.Register(api, handlercommon.Operation("Teams", "get-team", http.MethodGet, "/api/v1/team/{name}", "Get team details"), func(ctx context.Context, input *struct {
		Name      string `path:"name"`
		SessionID string `header:"x-session-id"`
		handler.SessionAuthContext
	}) (*struct{ Body *coreteam.Team }, error) {
		svc := run.GetTeamService()
		if err := verifyTeamSessionAccess(ctx, svc, input.Name, input.SessionID); err != nil {
			return nil, err
		}

		team, err := svc.Get(ctx, input.Name)
		if err != nil {
			return nil, huma.Error404NotFound("Team not found")
		}
		return &struct{ Body *coreteam.Team }{Body: team}, nil
	})

	huma.Register(api, handlercommon.Operation("Teams", "list-team-tasks", http.MethodGet, "/api/v1/team/{name}/tasks", "List team tasks"), func(ctx context.Context, input *struct {
		Name      string `path:"name"`
		SessionID string `header:"x-session-id"`
		handler.SessionAuthContext
	}) (*struct{ Body []coreteam.Task }, error) {
		svc := run.GetTeamService()
		if err := verifyTeamSessionAccess(ctx, svc, input.Name, input.SessionID); err != nil {
			return nil, err
		}

		tasks, err := svc.ListTasks(ctx, input.Name)
		if err != nil {
			return nil, teamInternalError("Failed to list team tasks", err, "teamName", input.Name)
		}
		return &struct{ Body []coreteam.Task }{Body: tasks}, nil
	})

	huma.Register(api, handlercommon.Operation("Teams", "find-team-by-session", http.MethodGet, "/api/v1/team/by-session/{sessionID}", "Find team by session ID"), func(ctx context.Context, input *struct {
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

	huma.Register(api, handlercommon.Operation("Teams", "set-team-delegate", http.MethodPost, "/api/v1/team/{name}/delegate", "Set team delegate mode"), func(ctx context.Context, input *struct {
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

	huma.Register(api, handlercommon.Operation("Teams", "cancel-teammates", http.MethodPost, "/api/v1/team/{name}/cancel", "Cancel teammates"), func(ctx context.Context, input *struct {
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
				if errors.Is(err, coreteam.ErrMemberNotFound) {
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
