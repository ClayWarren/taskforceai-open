package team

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/core/pkg/orchestrator"
	coreteam "github.com/TaskForceAI/core/pkg/team"
	"github.com/TaskForceAI/go-engine/pkg/run"
	"github.com/TaskForceAI/go-engine/pkg/teaminbox"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type failingCancelSessionManager struct{}

func (f failingCancelSessionManager) InjectMessage(ctx context.Context, sessionID, fromName, text, inboxMessageID string) error {
	return nil
}

func (f failingCancelSessionManager) AutoWake(ctx context.Context, sessionID string) error {
	return nil
}

func (f failingCancelSessionManager) GetSessionInfo(ctx context.Context, sessionID string) (string, string, string, error) {
	return "", "", "", nil
}

func (f failingCancelSessionManager) UpdatePermissions(ctx context.Context, sessionID string, removePattern string) error {
	return nil
}

func (f failingCancelSessionManager) RestoreLeadPermissions(ctx context.Context, sessionID string, writeTools []string) error {
	return nil
}

func (f failingCancelSessionManager) CancelPrompt(ctx context.Context, sessionID string) error {
	return errors.New("cancel prompt failed")
}

func (f failingCancelSessionManager) RemoveSession(ctx context.Context, sessionID string) error {
	return nil
}

func (f failingCancelSessionManager) CreateSession(ctx context.Context, parentID, agentName, title string, permissions []coreteam.PermissionRule) (string, error) {
	return "", nil
}

func (f failingCancelSessionManager) StartPromptLoop(ctx context.Context, sessionID string) error {
	return nil
}

func (f failingCancelSessionManager) GetLastUserMessageModel(ctx context.Context, sessionID string) (*coreteam.ModelInfo, error) {
	return nil, nil
}

type successfulCancelSessionManager struct {
	failingCancelSessionManager
}

func (s successfulCancelSessionManager) CancelPrompt(ctx context.Context, sessionID string) error {
	return nil
}

type teamHandlerStore struct {
	team       *coreteam.Team
	tasks      []coreteam.Task
	findErr    error
	getErr     error
	tasksErr   error
	saveErr    error
	listErr    error
	deleteErr  error
	findRole   string
	findMember string
}

func (s *teamHandlerStore) GetTeam(ctx context.Context, name string) (*coreteam.Team, error) {
	if s.getErr != nil {
		return nil, s.getErr
	}
	if s.team == nil || s.team.Name != name {
		return nil, coreteam.ErrTeamNotFound
	}
	team := *s.team
	if len(s.team.Members) > 0 {
		team.Members = append([]coreteam.Member(nil), s.team.Members...)
	}
	return &team, nil
}

func (s *teamHandlerStore) SaveTeam(ctx context.Context, team *coreteam.Team) error {
	if s.saveErr != nil {
		return s.saveErr
	}
	if team != nil {
		teamCopy := *team
		s.team = &teamCopy
	}
	return nil
}

func (s *teamHandlerStore) ListTeams(ctx context.Context) ([]coreteam.Team, error) {
	if s.listErr != nil {
		return nil, s.listErr
	}
	if s.team == nil {
		return []coreteam.Team{}, nil
	}
	return []coreteam.Team{*s.team}, nil
}

func (s *teamHandlerStore) GetTasks(ctx context.Context, teamName string) ([]coreteam.Task, error) {
	if s.tasksErr != nil {
		return nil, s.tasksErr
	}
	return append([]coreteam.Task(nil), s.tasks...), nil
}

func (s *teamHandlerStore) SaveTasks(ctx context.Context, teamName string, tasks []coreteam.Task) error {
	s.tasks = append([]coreteam.Task(nil), tasks...)
	return nil
}

func (s *teamHandlerStore) DeleteTeam(ctx context.Context, name string) error {
	return s.deleteErr
}

func (s *teamHandlerStore) FindBySession(ctx context.Context, sessionID string) (*coreteam.Team, string, string, error) {
	if s.findErr != nil {
		return nil, "", "", s.findErr
	}
	if s.team == nil || sessionID == "" {
		return nil, "", "", nil
	}
	role := s.findRole
	if role == "" {
		role = "lead"
	}
	return s.team, role, s.findMember, nil
}

func setupTeamRouter() *chi.Mux {
	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	RegisterHandlers(api)
	return r
}

func setupTeamService(t *testing.T) *coreteam.Service {
	t.Helper()
	store := coreteam.NewInMemoryStore()
	inbox := teaminbox.NewFilesystemTeamInbox(t.TempDir())
	svc := coreteam.NewService(
		store,
		inbox,
		&orchestrator.TeamSessionManager{},
		&orchestrator.TeamModelProvider{},
		coreteam.NewInMemoryBus(),
	)
	run.SetTeamService(svc)
	return svc
}

func TestTeamRoutes_DelegateCancelAndSessionDetails(t *testing.T) {
	svc := setupTeamService(t)
	teamName := "team-ops"
	sessionID := "lead-ops"
	_, err := svc.Create(context.Background(), teamName, sessionID, false)
	require.NoError(t, err)

	router := setupAuthenticatedTeamRouter()

	delegateReq := httptest.NewRequest(http.MethodPost, "/api/v1/team/"+teamName+"/delegate", strings.NewReader(`{"enabled":true}`))
	delegateReq.Header.Set("Content-Type", "application/json")
	delegateReq.Header.Set("x-session-id", sessionID)
	delegateResp := httptest.NewRecorder()
	router.ServeHTTP(delegateResp, delegateReq)
	assert.Equal(t, http.StatusOK, delegateResp.Code)

	cancelReq := httptest.NewRequest(http.MethodPost, "/api/v1/team/"+teamName+"/cancel", strings.NewReader(`{"member":"worker"}`))
	cancelReq.Header.Set("Content-Type", "application/json")
	cancelReq.Header.Set("x-session-id", sessionID)
	cancelResp := httptest.NewRecorder()
	router.ServeHTTP(cancelResp, cancelReq)
	assert.Equal(t, http.StatusOK, cancelResp.Code)

	sessionReq := httptest.NewRequest(http.MethodGet, "/api/v1/team/by-session/"+sessionID, nil)
	sessionReq.Header.Set("x-session-id", sessionID)
	sessionResp := httptest.NewRecorder()
	router.ServeHTTP(sessionResp, sessionReq)
	assert.Equal(t, http.StatusOK, sessionResp.Code)
	assert.Contains(t, sessionResp.Body.String(), "team-ops")

	cancelAllReq := httptest.NewRequest(http.MethodPost, "/api/v1/team/"+teamName+"/cancel", strings.NewReader(`{"member":""}`))
	cancelAllReq.Header.Set("Content-Type", "application/json")
	cancelAllReq.Header.Set("x-session-id", sessionID)
	cancelAllResp := httptest.NewRecorder()
	router.ServeHTTP(cancelAllResp, cancelAllReq)
	assert.Equal(t, http.StatusOK, cancelAllResp.Code)
}

func TestTeamRoutes_CancelMemberReturnsServiceError(t *testing.T) {
	store := coreteam.NewInMemoryStore()
	inbox := teaminbox.NewFilesystemTeamInbox(t.TempDir())
	svc := coreteam.NewService(
		store,
		inbox,
		failingCancelSessionManager{},
		&orchestrator.TeamModelProvider{},
		coreteam.NewInMemoryBus(),
	)
	run.SetTeamService(svc)

	teamName := "team-cancel-error"
	sessionID := "lead-cancel-error"
	_, err := svc.Create(context.Background(), teamName, sessionID, false)
	require.NoError(t, err)
	err = svc.AddMember(context.Background(), teamName, coreteam.Member{
		Name:            "worker",
		SessionID:       "worker-cancel-error",
		Status:          coreteam.MemberStatusBusy,
		ExecutionStatus: coreteam.ExecutionStatusRunning,
	})
	require.NoError(t, err)

	router := setupAuthenticatedTeamRouter()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/team/"+teamName+"/cancel", strings.NewReader(`{"member":"worker"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-session-id", sessionID)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
	assert.Contains(t, resp.Body.String(), "Failed to cancel team member")
	assert.NotContains(t, resp.Body.String(), "cancel prompt failed")
}

func TestTeamRoutes_CancelMemberSuccess(t *testing.T) {
	store := coreteam.NewInMemoryStore()
	svc := coreteam.NewService(
		store,
		teaminbox.NewFilesystemTeamInbox(t.TempDir()),
		successfulCancelSessionManager{},
		&orchestrator.TeamModelProvider{},
		coreteam.NewInMemoryBus(),
	)
	run.SetTeamService(svc)
	teamName := "team-cancel-success"
	sessionID := "lead-cancel-success"
	_, err := svc.Create(context.Background(), teamName, sessionID, false)
	require.NoError(t, err)
	require.NoError(t, svc.AddMember(context.Background(), teamName, coreteam.Member{
		Name:            "worker",
		SessionID:       "worker-cancel-success",
		Status:          coreteam.MemberStatusBusy,
		ExecutionStatus: coreteam.ExecutionStatusRunning,
	}))

	router := setupAuthenticatedTeamRouter()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/team/"+teamName+"/cancel", strings.NewReader(`{"member":"worker"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-session-id", sessionID)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), `"ok":true`)
	assert.Contains(t, resp.Body.String(), `"cancelled":1`)
}

func TestTeamRoutes_ServiceFindBySessionError(t *testing.T) {
	store := &teamHandlerStore{
		team:    &coreteam.Team{Name: "team-find-error"},
		findErr: errors.New("session lookup failed"),
	}
	svc := coreteam.NewService(
		store,
		teaminbox.NewFilesystemTeamInbox(t.TempDir()),
		&orchestrator.TeamSessionManager{},
		&orchestrator.TeamModelProvider{},
		coreteam.NewInMemoryBus(),
	)
	run.SetTeamService(svc)
	router := setupAuthenticatedTeamRouter()

	getReq := httptest.NewRequest(http.MethodGet, "/api/v1/team/team-find-error", nil)
	getReq.Header.Set("x-session-id", "lead-find-error")
	getResp := httptest.NewRecorder()
	router.ServeHTTP(getResp, getReq)
	assert.Equal(t, http.StatusInternalServerError, getResp.Code)
	assert.NotContains(t, getResp.Body.String(), "session lookup failed")

	sessionReq := httptest.NewRequest(http.MethodGet, "/api/v1/team/by-session/lead-find-error", nil)
	sessionReq.Header.Set("x-session-id", "lead-find-error")
	sessionResp := httptest.NewRecorder()
	router.ServeHTTP(sessionResp, sessionReq)
	assert.Equal(t, http.StatusInternalServerError, sessionResp.Code)
	assert.NotContains(t, sessionResp.Body.String(), "session lookup failed")
}

func TestTeamRoutes_GetTeamForbiddenForMismatchedName(t *testing.T) {
	svc := setupTeamService(t)
	_, err := svc.Create(context.Background(), "team-missing-get", "lead-missing-get", false)
	require.NoError(t, err)

	router := setupAuthenticatedTeamRouter()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/team/does-not-exist", nil)
	req.Header.Set("x-session-id", "lead-missing-get")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestTeamRoutes_ListGetAndTasksSuccess(t *testing.T) {
	svc := setupTeamService(t)
	_, err := svc.Create(context.Background(), "team-success", "lead-success", false)
	require.NoError(t, err)

	router := setupAuthenticatedTeamRouter()

	listReq := httptest.NewRequest(http.MethodGet, "/api/v1/team", nil)
	listReq.Header.Set("x-session-id", "lead-success")
	listResp := httptest.NewRecorder()
	router.ServeHTTP(listResp, listReq)
	assert.Equal(t, http.StatusOK, listResp.Code)
	assert.Contains(t, listResp.Body.String(), "team-success")

	getReq := httptest.NewRequest(http.MethodGet, "/api/v1/team/team-success", nil)
	getReq.Header.Set("x-session-id", "lead-success")
	getResp := httptest.NewRecorder()
	router.ServeHTTP(getResp, getReq)
	assert.Equal(t, http.StatusOK, getResp.Code)

	tasksReq := httptest.NewRequest(http.MethodGet, "/api/v1/team/team-success/tasks", nil)
	tasksReq.Header.Set("x-session-id", "lead-success")
	tasksResp := httptest.NewRecorder()
	router.ServeHTTP(tasksResp, tasksReq)
	assert.Equal(t, http.StatusOK, tasksResp.Code)
}

func TestTeamRoutes_SessionEdgeCases(t *testing.T) {
	svc := setupTeamService(t)
	_, err := svc.Create(context.Background(), "session-team", "lead-session", false)
	require.NoError(t, err)

	t.Run("list teams empty session returns empty list", func(t *testing.T) {
		router := setupAuthenticatedTeamRouter()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/team", nil)
		resp := httptest.NewRecorder()
		router.ServeHTTP(resp, req)
		assert.Equal(t, http.StatusOK, resp.Code)
		assert.Equal(t, "[]", strings.TrimSpace(resp.Body.String()))
	})

	t.Run("find by session unauthorized caller", func(t *testing.T) {
		router := setupAuthenticatedTeamRouter()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/team/by-session/other-session", nil)
		resp := httptest.NewRecorder()
		router.ServeHTTP(resp, req)
		assert.Equal(t, http.StatusUnauthorized, resp.Code)
	})

	t.Run("find by session forbidden mismatch", func(t *testing.T) {
		router := setupAuthenticatedTeamRouter()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/team/by-session/other-session", nil)
		req.Header.Set("x-session-id", "lead-session")
		resp := httptest.NewRecorder()
		router.ServeHTTP(resp, req)
		assert.Equal(t, http.StatusForbidden, resp.Code)
	})

	t.Run("find by session missing team", func(t *testing.T) {
		router := setupAuthenticatedTeamRouter()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/team/by-session/unknown-session", nil)
		req.Header.Set("x-session-id", "unknown-session")
		resp := httptest.NewRecorder()
		router.ServeHTTP(resp, req)
		assert.Equal(t, http.StatusOK, resp.Code)
		assert.Equal(t, "null", strings.TrimSpace(resp.Body.String()))
	})
}

func TestTeamRoutes_ServiceErrorBranches(t *testing.T) {
	teamInfo := &coreteam.Team{Name: "team-errors", LeadSessionID: "lead-errors"}

	tests := []struct {
		name   string
		store  *teamHandlerStore
		method string
		path   string
		body   string
		want   int
		rawErr string
	}{
		{
			name:   "list teams find by session error",
			store:  &teamHandlerStore{findErr: errors.New("session lookup failed")},
			method: http.MethodGet,
			path:   "/api/v1/team",
			want:   http.StatusInternalServerError,
			rawErr: "session lookup failed",
		},
		{
			name:   "get team missing after access check",
			store:  &teamHandlerStore{team: teamInfo, getErr: coreteam.ErrTeamNotFound},
			method: http.MethodGet,
			path:   "/api/v1/team/team-errors",
			want:   http.StatusNotFound,
		},
		{
			name:   "list team tasks error",
			store:  &teamHandlerStore{team: teamInfo, tasksErr: errors.New("tasks unavailable")},
			method: http.MethodGet,
			path:   "/api/v1/team/team-errors/tasks",
			want:   http.StatusInternalServerError,
			rawErr: "tasks unavailable",
		},
		{
			name:   "set delegate save error",
			store:  &teamHandlerStore{team: teamInfo, saveErr: errors.New("save failed")},
			method: http.MethodPost,
			path:   "/api/v1/team/team-errors/delegate",
			body:   `{"enabled":true}`,
			want:   http.StatusInternalServerError,
			rawErr: "save failed",
		},
		{
			name:   "cancel all get error",
			store:  &teamHandlerStore{team: teamInfo, getErr: errors.New("get failed")},
			method: http.MethodPost,
			path:   "/api/v1/team/team-errors/cancel",
			body:   `{"member":""}`,
			want:   http.StatusInternalServerError,
			rawErr: "get failed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc := coreteam.NewService(
				tt.store,
				teaminbox.NewFilesystemTeamInbox(t.TempDir()),
				&orchestrator.TeamSessionManager{},
				&orchestrator.TeamModelProvider{},
				coreteam.NewInMemoryBus(),
			)
			run.SetTeamService(svc)
			router := setupAuthenticatedTeamRouter()
			req := httptest.NewRequest(tt.method, tt.path, strings.NewReader(tt.body))
			if tt.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}
			req.Header.Set("x-session-id", "lead-errors")
			resp := httptest.NewRecorder()
			router.ServeHTTP(resp, req)

			assert.Equal(t, tt.want, resp.Code)
			if tt.rawErr != "" {
				assert.NotContains(t, resp.Body.String(), tt.rawErr)
			}
		})
	}
}

func TestTeamRoutes_RejectDeveloperAPIKeyAuth(t *testing.T) {
	svc := setupTeamService(t)
	_, err := svc.Create(context.Background(), "team-api-key", "lead-api-key", false)
	require.NoError(t, err)

	router := setupAuthenticatedTeamRouterWithAuthMethod(handler.AuthMethodAPIKey)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/team/team-api-key", nil)
	req.Header.Set("x-session-id", "lead-api-key")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusForbidden, resp.Code)
	assert.Contains(t, resp.Body.String(), "Session authentication required")
}

func TestTeamRoutes_ProtectedRoutesRequireSessionHeader(t *testing.T) {
	svc := setupTeamService(t)
	_, err := svc.Create(context.Background(), "team-no-session", "lead-no-session", false)
	require.NoError(t, err)
	router := setupAuthenticatedTeamRouter()

	tests := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{name: "get team", method: http.MethodGet, path: "/api/v1/team/team-no-session"},
		{name: "tasks", method: http.MethodGet, path: "/api/v1/team/team-no-session/tasks"},
		{name: "delegate", method: http.MethodPost, path: "/api/v1/team/team-no-session/delegate", body: `{"enabled":true}`},
		{name: "cancel", method: http.MethodPost, path: "/api/v1/team/team-no-session/cancel", body: `{"member":""}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, strings.NewReader(tt.body))
			if tt.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}
			resp := httptest.NewRecorder()
			router.ServeHTTP(resp, req)

			assert.Equal(t, http.StatusUnauthorized, resp.Code)
		})
	}
}

func TestTeamRoutes_Success(t *testing.T) {
	// Setup real service with in-mem store
	store := coreteam.NewInMemoryStore()
	inbox := teaminbox.NewFilesystemTeamInbox(t.TempDir())
	svc := coreteam.NewService(
		store,
		inbox,
		&orchestrator.TeamSessionManager{},
		&orchestrator.TeamModelProvider{},
		coreteam.NewInMemoryBus(),
	)
	run.SetTeamService(svc)

	// Create a team to test with
	teamName := "test-team"
	_, err := svc.Create(context.Background(), teamName, "lead-session", false)
	require.NoError(t, err)

	router := setupAuthenticatedTeamRouter()

	t.Run("list teams", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/team", nil)
		req.Header.Set("x-session-id", "lead-session")
		resp := httptest.NewRecorder()
		router.ServeHTTP(resp, req)
		assert.Equal(t, http.StatusOK, resp.Code)
		assert.Contains(t, resp.Body.String(), teamName)
	})

	t.Run("get team", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/team/"+teamName, nil)
		req.Header.Set("x-session-id", "lead-session")
		resp := httptest.NewRecorder()
		router.ServeHTTP(resp, req)
		assert.Equal(t, http.StatusOK, resp.Code)
		assert.Contains(t, resp.Body.String(), teamName)
	})

	t.Run("get team not found", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/team/nonexistent", nil)
		req.Header.Set("x-session-id", "lead-session")
		resp := httptest.NewRecorder()
		router.ServeHTTP(resp, req)
		assert.Equal(t, http.StatusForbidden, resp.Code)
	})

	t.Run("list team tasks", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/team/"+teamName+"/tasks", nil)
		req.Header.Set("x-session-id", "lead-session")
		resp := httptest.NewRecorder()
		router.ServeHTTP(resp, req)
		assert.Equal(t, http.StatusOK, resp.Code)
	})

	t.Run("set team delegate", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/team/"+teamName+"/delegate", strings.NewReader(`{"enabled":true}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-session-id", "lead-session")
		resp := httptest.NewRecorder()
		router.ServeHTTP(resp, req)
		assert.Equal(t, http.StatusOK, resp.Code)
		assert.Contains(t, resp.Body.String(), `"delegate":true`)

		team, _ := svc.Get(context.Background(), teamName)
		assert.True(t, team.Delegate)
	})

	t.Run("find team by session", func(t *testing.T) {
		// The in-mem store needs to have the session mapping
		// FindBySession(ctx context.Context, sessionID string) (*TeamInfo, string, string, error)
		// We already created the team but the in-mem store might not support FindBySession
		// without some setup.
		// Let's check if we can add a member with a session.
		err := svc.AddMember(context.Background(), teamName, coreteam.Member{
			Name:      "test-member",
			SessionID: "test-session",
			Status:    coreteam.MemberStatusReady,
		})
		require.NoError(t, err)

		req := httptest.NewRequest(http.MethodGet, "/api/v1/team/by-session/test-session", nil)
		req.Header.Set("x-session-id", "test-session")
		resp := httptest.NewRecorder()
		router.ServeHTTP(resp, req)
		assert.Equal(t, http.StatusOK, resp.Code)
		assert.Contains(t, resp.Body.String(), teamName)
		assert.Contains(t, resp.Body.String(), "test-member")
	})

	t.Run("cancel teammates all", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/team/"+teamName+"/cancel", strings.NewReader(`{"member": ""}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-session-id", "lead-session")
		resp := httptest.NewRecorder()
		router.ServeHTTP(resp, req)
		assert.Equal(t, http.StatusOK, resp.Code)
		assert.Contains(t, resp.Body.String(), `"ok":true`)
	})

	t.Run("cancel teammates member not found", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/team/"+teamName+"/cancel", strings.NewReader(`{"member":"ghost"}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-session-id", "lead-session")
		resp := httptest.NewRecorder()
		router.ServeHTTP(resp, req)
		assert.Equal(t, http.StatusOK, resp.Code)
		assert.Contains(t, resp.Body.String(), `"ok":false`)
	})

	t.Run("forbidden with unrelated session", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/team/"+teamName, nil)
		req.Header.Set("x-session-id", "other-session")
		resp := httptest.NewRecorder()
		router.ServeHTTP(resp, req)
		assert.Equal(t, http.StatusForbidden, resp.Code)
	})
}

func TestTeamRoutes_UnauthorizedWithoutAuthContext(t *testing.T) {
	router := setupTeamRouter()

	testCases := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{name: "list teams", method: http.MethodGet, path: "/api/v1/team"},
		{name: "get team", method: http.MethodGet, path: "/api/v1/team/example"},
		{name: "list team tasks", method: http.MethodGet, path: "/api/v1/team/example/tasks"},
		{name: "find team by session", method: http.MethodGet, path: "/api/v1/team/by-session/example-session"},
		{
			name:   "set team delegate",
			method: http.MethodPost,
			path:   "/api/v1/team/example/delegate",
			body:   `{"enabled":true}`,
		},
		{
			name:   "cancel teammates",
			method: http.MethodPost,
			path:   "/api/v1/team/example/cancel",
			body:   `{"member":"example"}`,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			if tc.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}
			resp := httptest.NewRecorder()
			router.ServeHTTP(resp, req)

			assert.Equal(t, http.StatusUnauthorized, resp.Code)
		})
	}
}

func withAuthMethod(authMethod string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user := &auth.AuthenticatedUser{
				ID:    1,
				Email: "test@example.com",
			}
			ctx := context.WithValue(r.Context(), handler.UserContextKey, user)
			ctx = context.WithValue(ctx, handler.UserIDContextKey, user.ID)
			if authMethod != "" {
				ctx = context.WithValue(ctx, handler.AuthMethodContextKey, authMethod)
			}
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func setupAuthenticatedTeamRouter() *chi.Mux {
	return setupAuthenticatedTeamRouterWithAuthMethod("")
}

func setupAuthenticatedTeamRouterWithAuthMethod(authMethod string) *chi.Mux {
	r := chi.NewRouter()
	r.Use(withAuthMethod(authMethod))
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	RegisterHandlers(api)
	return r
}

func TestVerifyTeamSessionAccessFindBySessionError(t *testing.T) {
	svc := setupTeamService(t)
	err := verifyTeamSessionAccess(context.Background(), svc, "missing-team", "nonexistent-session")
	require.Error(t, err)
}

func TestVerifyTeamSessionAccessUnauthorized(t *testing.T) {
	svc := setupTeamService(t)
	err := verifyTeamSessionAccess(context.Background(), svc, "team-a", "")
	require.Error(t, err)
}
