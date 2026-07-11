package developer

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/TaskForceAI/adapters/pkg/auth"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/core/pkg/conversations"
	runhandlers "github.com/TaskForceAI/go-engine/pkg/handlers/run"
	runp "github.com/TaskForceAI/go-engine/pkg/run"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
)

type mockInngest struct {
	mock.Mock
}

func TestMarshalValidatedJSONUsesNullForEmptyValues(t *testing.T) {
	encoded, err := marshalValidatedJSON(nil)

	require.NoError(t, err)
	assert.JSONEq(t, "null", string(encoded))
}

type mockDeveloperQueries struct {
	mock.Mock
}

type mockTaskRegistry struct {
	mock.Mock
}

type fakeConversationService struct {
	listFn   func(context.Context, string, *int, int, int) (*conversations.ConversationsPage, error)
	createFn func(context.Context, conversations.ConversationCreateInput) (*conversations.ConversationApiView, error)
	getFn    func(context.Context, string, *int, int) (*conversations.ConversationApiView, error)
}

func (m *mockInngest) Send(ctx context.Context, event any) (string, error) {
	args := m.Called(ctx, event)
	return args.String(0), args.Error(1)
}

func (m *mockDeveloperQueries) GetMessagesByConversation(ctx context.Context, conversationID int32) ([]ThreadMessage, error) {
	args := m.Called(ctx, conversationID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	messages, ok := args.Get(0).([]ThreadMessage)
	if !ok {
		return nil, args.Error(1)
	}
	return messages, args.Error(1)
}

func (m *mockDeveloperQueries) GetOrganizationByID(ctx context.Context, id int32) (runhandlers.OrganizationRow, error) {
	args := m.Called(ctx, id)
	if args.Get(0) == nil {
		return runhandlers.OrganizationRow{}, args.Error(1)
	}
	org, ok := args.Get(0).(runhandlers.OrganizationRow)
	if !ok {
		return runhandlers.OrganizationRow{}, args.Error(1)
	}
	return org, args.Error(1)
}

func (m *mockDeveloperQueries) GetMembership(ctx context.Context, arg runhandlers.MembershipLookupInput) (runhandlers.MembershipRow, error) {
	args := m.Called(ctx, arg)
	if args.Get(0) == nil {
		return runhandlers.MembershipRow{}, args.Error(1)
	}
	membership, ok := args.Get(0).(runhandlers.MembershipRow)
	if !ok {
		return runhandlers.MembershipRow{}, args.Error(1)
	}
	return membership, args.Error(1)
}

func (m *mockTaskRegistry) Register(taskID string, userID int, prompt, modelID string, opts runp.OrchestrateTaskOptions) error {
	args := m.Called(taskID, userID, prompt, modelID, opts)
	return args.Error(0)
}

func (m *mockTaskRegistry) Get(taskID string) *runp.TaskState {
	args := m.Called(taskID)
	if args.Get(0) == nil {
		return nil
	}
	state, ok := args.Get(0).(*runp.TaskState)
	if !ok {
		return nil
	}
	return state
}

func (f fakeConversationService) ListConversations(ctx context.Context, userID string, orgID *int, limit, offset int) (*conversations.ConversationsPage, error) {
	if f.listFn == nil {
		return &conversations.ConversationsPage{}, nil
	}
	return f.listFn(ctx, userID, orgID, limit, offset)
}

func (f fakeConversationService) GetConversation(ctx context.Context, userID string, orgID *int, conversationID int) (*conversations.ConversationApiView, error) {
	if f.getFn == nil {
		return nil, errors.New("conversation not found")
	}
	return f.getFn(ctx, userID, orgID, conversationID)
}

func (f fakeConversationService) CreateConversation(ctx context.Context, input conversations.ConversationCreateInput) (*conversations.ConversationApiView, error) {
	if f.createFn == nil {
		return &conversations.ConversationApiView{ID: 1}, nil
	}
	return f.createFn(ctx, input)
}

func (f fakeConversationService) UpdateConversation(ctx context.Context, userID string, orgID *int, conversationID int, input conversations.ConversationUpdateInput) (bool, error) {
	return false, errors.New("not implemented")
}

func (f fakeConversationService) DeleteConversation(ctx context.Context, userID string, orgID *int, conversationID int) (bool, error) {
	return false, errors.New("not implemented")
}

func setupDeveloperRouter(q DeveloperQueries, conv conversations.Service, inngest runp.InngestSender, user *auth.AuthenticatedUser, orgID int) *chi.Mux {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if user != nil {
				ctx := context.WithValue(r.Context(), adapterhandler.UserContextKey, user)
				if orgID != 0 {
					ctx = context.WithValue(ctx, adapterhandler.OrgIDContextKey, orgID)
				}
				r = r.WithContext(ctx)
			}
			next.ServeHTTP(w, r)
		})
	})
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	RegisterHandlers(api, q, conv, inngest)
	return r
}

func withDeveloperRateLimitFallback(t *testing.T) {
	t.Helper()
	orig := runp.RedisClientGetter
	runp.RedisClientGetter = func() (redis.Cmdable, error) {
		return nil, errors.New("redis unavailable")
	}
	t.Cleanup(func() { runp.RedisClientGetter = orig })
}

func exhaustDeveloperRunRateLimit(t *testing.T, email string, userID int, orgID int) {
	t.Helper()
	for range 10 {
		require.NoError(t, runhandlers.EnforceRunRateLimit(context.Background(), email, userID, orgID))
	}
}

func stringPtr(value string) *string {
	return &value
}

func TestDefaultRegistryGetter(t *testing.T) {
	require.NotNil(t, registryGetter())
}

func TestRunTask_Success(t *testing.T) {
	reg := new(mockTaskRegistry)
	reg.On("Register", mock.Anything, 1, "hi", "gpt", mock.Anything).Return(nil)

	ing := new(mockInngest)
	ing.On("Send", mock.Anything, mock.Anything).Return("id", nil)

	origReg := registryGetter
	registryGetter = func() TaskRegistry { return reg }
	t.Cleanup(func() {
		registryGetter = origReg
	})

	conv := fakeConversationService{}
	q := new(mockDeveloperQueries)
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupDeveloperRouter(q, conv, ing, user, 0)

	body := `{"prompt":"hi","modelId":"gpt","stream":false}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/run", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestRunTask_InvalidUserID(t *testing.T) {
	user := &auth.AuthenticatedUser{ID: 1 << 40, Email: "invalid-user@example.com"}
	router := setupDeveloperRouter(nil, fakeConversationService{}, nil, user, 0)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/run", strings.NewReader(`{"prompt":"hi","modelId":"gpt","stream":false}`))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
}

func TestRunTask_RateLimited(t *testing.T) {
	withDeveloperRateLimitFallback(t)
	email := "developer-run-limited@example.com"
	exhaustDeveloperRunRateLimit(t, email, 44, 0)

	user := &auth.AuthenticatedUser{ID: 44, Email: email}
	router := setupDeveloperRouter(nil, fakeConversationService{}, nil, user, 0)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/run", strings.NewReader(`{"prompt":"hi","modelId":"gpt","stream":false}`))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusTooManyRequests, resp.Code)
}

func TestRunTask_AppliesOrgNoTrainingPolicy(t *testing.T) {
	reg := new(mockTaskRegistry)
	reg.On("Register", mock.Anything, 1, "hi", "gpt", mock.MatchedBy(func(opts runp.OrchestrateTaskOptions) bool {
		return opts.OrgID != nil && *opts.OrgID == 12 && opts.NoTraining && !opts.IsEval
	})).Return(nil)

	ing := new(mockInngest)
	ing.On("Send", mock.Anything, mock.Anything).Return("id", nil)

	origReg := registryGetter
	registryGetter = func() TaskRegistry { return reg }
	t.Cleanup(func() { registryGetter = origReg })

	q := new(mockDeveloperQueries)
	q.On("GetMembership", mock.Anything, runhandlers.MembershipLookupInput{OrganizationID: 12, UserID: 1}).
		Return(runhandlers.MembershipRow{OrganizationID: 12, UserID: 1}, nil)
	q.On("GetOrganizationByID", mock.Anything, int32(12)).
		Return(runhandlers.OrganizationRow{ID: 12, NoTraining: true}, nil)

	user := &auth.AuthenticatedUser{ID: 1, Email: "org-policy@example.com"}
	router := setupDeveloperRouter(q, fakeConversationService{}, ing, user, 12)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/run", strings.NewReader(`{"prompt":"hi","modelId":"gpt","stream":false,"options":{"eval":true}}`))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	q.AssertExpectations(t)
}

func TestRunTask_PreservesEvalWithoutNoTrainingPolicy(t *testing.T) {
	reg := new(mockTaskRegistry)
	reg.On("Register", mock.Anything, 1, "hi", "gpt", mock.MatchedBy(func(opts runp.OrchestrateTaskOptions) bool {
		return opts.IsEval && !opts.NoTraining
	})).Return(nil)

	ing := new(mockInngest)
	ing.On("Send", mock.Anything, mock.Anything).Return("id", nil)

	origReg := registryGetter
	registryGetter = func() TaskRegistry { return reg }
	t.Cleanup(func() { registryGetter = origReg })

	user := &auth.AuthenticatedUser{ID: 1, Email: "eval@example.com"}
	router := setupDeveloperRouter(nil, fakeConversationService{}, ing, user, 0)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/run", strings.NewReader(`{"prompt":"hi","modelId":"gpt","stream":false,"options":{"eval":true}}`))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestRunTask_RejectsUnauthorizedOrg(t *testing.T) {
	q := new(mockDeveloperQueries)
	q.On("GetMembership", mock.Anything, runhandlers.MembershipLookupInput{OrganizationID: 12, UserID: 1}).
		Return(runhandlers.MembershipRow{}, pgx.ErrNoRows)

	user := &auth.AuthenticatedUser{ID: 1, Email: "org-denied@example.com"}
	router := setupDeveloperRouter(q, fakeConversationService{}, nil, user, 12)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/run", strings.NewReader(`{"prompt":"hi","modelId":"gpt","stream":false}`))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusForbidden, resp.Code)
	q.AssertExpectations(t)
}

func TestRunTask_OrgPolicyFailureBranches(t *testing.T) {
	tests := []struct {
		name  string
		query DeveloperQueries
		want  int
	}{
		{
			name:  "missing queries with org context",
			query: nil,
			want:  http.StatusInternalServerError,
		},
		{
			name: "membership lookup error",
			query: func() DeveloperQueries {
				q := new(mockDeveloperQueries)
				q.On("GetMembership", mock.Anything, runhandlers.MembershipLookupInput{OrganizationID: 12, UserID: 1}).
					Return(runhandlers.MembershipRow{}, errors.New("membership lookup failed"))
				return q
			}(),
			want: http.StatusInternalServerError,
		},
		{
			name: "organization load error",
			query: func() DeveloperQueries {
				q := new(mockDeveloperQueries)
				q.On("GetMembership", mock.Anything, runhandlers.MembershipLookupInput{OrganizationID: 12, UserID: 1}).
					Return(runhandlers.MembershipRow{OrganizationID: 12, UserID: 1}, nil)
				q.On("GetOrganizationByID", mock.Anything, int32(12)).
					Return(runhandlers.OrganizationRow{}, errors.New("org lookup failed"))
				return q
			}(),
			want: http.StatusInternalServerError,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			user := &auth.AuthenticatedUser{ID: 1, Email: "org-policy-error@example.com"}
			router := setupDeveloperRouter(tt.query, fakeConversationService{}, nil, user, 12)

			req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/run", strings.NewReader(`{"prompt":"hi","modelId":"gpt","stream":false}`))
			req.Header.Set("Content-Type", "application/json")
			resp := httptest.NewRecorder()
			router.ServeHTTP(resp, req)

			assert.Equal(t, tt.want, resp.Code)
		})
	}
}

func TestRunTask_SubmissionFailureMapsToServerError(t *testing.T) {
	reg := new(mockTaskRegistry)
	reg.On("Register", mock.Anything, 1, "hi", "gpt", mock.Anything).Return(errors.New("registry unavailable"))

	origReg := registryGetter
	registryGetter = func() TaskRegistry { return reg }
	t.Cleanup(func() { registryGetter = origReg })

	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupDeveloperRouter(nil, fakeConversationService{}, new(mockInngest), user, 0)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/run", strings.NewReader(`{"prompt":"hi","modelId":"gpt","stream":false}`))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestGetTaskStatus_NotFound(t *testing.T) {
	origReg := registryGetter
	registryGetter = func() TaskRegistry {
		reg := new(mockTaskRegistry)
		reg.On("Get", "task_1").Return(nil)
		return reg
	}
	t.Cleanup(func() { registryGetter = origReg })

	conv := fakeConversationService{}
	q := new(mockDeveloperQueries)
	ing := new(mockInngest)
	user := &auth.AuthenticatedUser{ID: 2, Email: "test@example.com"}
	router := setupDeveloperRouter(q, conv, ing, user, 0)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/status/task_1", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNotFound, resp.Code)
}

func TestGetTaskStatus_Success(t *testing.T) {
	reg := new(mockTaskRegistry)
	reg.On("Get", "task_1").Return(&runp.TaskState{
		TaskID: "task_1",
		Status: runp.StatusProcessing,
		UserID: 2,
		Result: "partial result",
	})

	origReg := registryGetter
	registryGetter = func() TaskRegistry { return reg }
	t.Cleanup(func() { registryGetter = origReg })

	user := &auth.AuthenticatedUser{ID: 2, Email: "test@example.com"}
	router := setupDeveloperRouter(nil, nil, nil, user, 0)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/status/task_1", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	var body runp.TaskState
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &body))
	assert.Equal(t, "task_1", body.TaskID)
	assert.Equal(t, runp.StatusProcessing, body.Status)
	assert.Equal(t, "partial result", body.Result)
}

func TestGetTaskStatus_TrimsOversizedResponse(t *testing.T) {
	originalBudget := developerResponsePayloadBudgetBytes
	developerResponsePayloadBudgetBytes = 700
	t.Cleanup(func() { developerResponsePayloadBudgetBytes = originalBudget })

	state := &runp.TaskState{
		TaskID:        "task_1",
		Status:        runp.StatusAwaiting,
		UserID:        2,
		Result:        strings.Repeat("r", 1000),
		AgentStatuses: []map[string]any{{"status": strings.Repeat("s", 1000)}},
		ToolEvents:    []map[string]any{{"content": strings.Repeat("t", 1000)}},
		PendingApproval: &runp.PendingApproval{
			ApprovalID: "approval_1",
			Permission: "write",
			AgentName:  "agent",
			Patterns:   []string{"*.go"},
			Metadata:   map[string]any{"payload": strings.Repeat("m", 1000)},
		},
	}
	reg := new(mockTaskRegistry)
	reg.On("Get", "task_1").Return(state)

	origReg := registryGetter
	registryGetter = func() TaskRegistry { return reg }
	t.Cleanup(func() { registryGetter = origReg })

	user := &auth.AuthenticatedUser{ID: 2, Email: "test@example.com"}
	router := setupDeveloperRouter(nil, nil, nil, user, 0)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/status/task_1", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	var body runp.TaskState
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &body))
	assert.Equal(t, "task_1", body.TaskID)
	assert.Equal(t, runp.StatusAwaiting, body.Status)
	assert.Empty(t, body.Result)
	assert.Nil(t, body.AgentStatuses)
	assert.Nil(t, body.ToolEvents)
	require.NotNil(t, body.PendingApproval)
	assert.Equal(t, "approval_1", body.PendingApproval.ApprovalID)
	assert.Equal(t, "write", body.PendingApproval.Permission)
	assert.Nil(t, body.PendingApproval.Metadata)

	assert.NotEmpty(t, state.Result)
	assert.NotNil(t, state.AgentStatuses)
	require.NotNil(t, state.PendingApproval)
	assert.NotNil(t, state.PendingApproval.Metadata)
}

func TestGetTaskStatus_HidesOtherUsersTask(t *testing.T) {
	reg := new(mockTaskRegistry)
	reg.On("Get", "task_1").Return(&runp.TaskState{TaskID: "task_1", Status: runp.StatusProcessing, UserID: 1})

	origReg := registryGetter
	registryGetter = func() TaskRegistry { return reg }
	t.Cleanup(func() { registryGetter = origReg })

	user := &auth.AuthenticatedUser{ID: 2, Email: "attacker@example.com"}
	router := setupDeveloperRouter(nil, nil, nil, user, 0)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/status/task_1", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNotFound, resp.Code)
}

func TestGetTaskStatus_Returns500WhenStatusCannotMarshal(t *testing.T) {
	reg := new(mockTaskRegistry)
	reg.On("Get", "task_1").Return(&runp.TaskState{
		TaskID:     "task_1",
		Status:     runp.StatusProcessing,
		UserID:     2,
		ToolEvents: make(chan int),
	})

	origReg := registryGetter
	registryGetter = func() TaskRegistry { return reg }
	t.Cleanup(func() { registryGetter = origReg })

	user := &auth.AuthenticatedUser{ID: 2, Email: "test@example.com"}
	router := setupDeveloperRouter(nil, nil, nil, user, 0)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/status/task_1", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestGetTaskStatus_Returns413WhenTrimmedStatusStillTooLarge(t *testing.T) {
	originalBudget := developerResponsePayloadBudgetBytes
	developerResponsePayloadBudgetBytes = 1
	t.Cleanup(func() { developerResponsePayloadBudgetBytes = originalBudget })

	reg := new(mockTaskRegistry)
	reg.On("Get", "task_1").Return(&runp.TaskState{
		TaskID: "task_1",
		Status: runp.StatusAwaiting,
		UserID: 2,
		Result: strings.Repeat("r", 100),
	})

	origReg := registryGetter
	registryGetter = func() TaskRegistry { return reg }
	t.Cleanup(func() { registryGetter = origReg })

	user := &auth.AuthenticatedUser{ID: 2, Email: "test@example.com"}
	router := setupDeveloperRouter(nil, nil, nil, user, 0)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/status/task_1", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusRequestEntityTooLarge, resp.Code)
}

func TestGetTaskResults_Completed(t *testing.T) {
	reg := new(mockTaskRegistry)
	reg.On("Get", "task_1").Return(&runp.TaskState{TaskID: "task_1", Status: runp.StatusCompleted, UserID: 2, Result: "done"})

	origReg := registryGetter
	registryGetter = func() TaskRegistry { return reg }
	t.Cleanup(func() { registryGetter = origReg })

	conv := fakeConversationService{}
	q := new(mockDeveloperQueries)
	ing := new(mockInngest)
	user := &auth.AuthenticatedUser{ID: 2, Email: "test@example.com"}
	router := setupDeveloperRouter(q, conv, ing, user, 0)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/results/task_1", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), "done")
}

func TestGetTaskResults_Returns413WhenPayloadTooLarge(t *testing.T) {
	originalBudget := developerResponsePayloadBudgetBytes
	developerResponsePayloadBudgetBytes = 96
	t.Cleanup(func() { developerResponsePayloadBudgetBytes = originalBudget })

	reg := new(mockTaskRegistry)
	reg.On("Get", "task_1").Return(&runp.TaskState{
		TaskID: "task_1",
		Status: runp.StatusCompleted,
		UserID: 2,
		Result: strings.Repeat("x", 200),
	})

	origReg := registryGetter
	registryGetter = func() TaskRegistry { return reg }
	t.Cleanup(func() { registryGetter = origReg })

	user := &auth.AuthenticatedUser{ID: 2, Email: "test@example.com"}
	router := setupDeveloperRouter(nil, nil, nil, user, 0)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/results/task_1", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusRequestEntityTooLarge, resp.Code)
}

func TestGetTaskResults_NotCompleted(t *testing.T) {
	reg := new(mockTaskRegistry)
	reg.On("Get", "task_1").Return(&runp.TaskState{TaskID: "task_1", Status: runp.StatusProcessing, UserID: 2})

	origReg := registryGetter
	registryGetter = func() TaskRegistry { return reg }
	t.Cleanup(func() { registryGetter = origReg })

	user := &auth.AuthenticatedUser{ID: 2, Email: "test@example.com"}
	router := setupDeveloperRouter(nil, nil, nil, user, 0)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/results/task_1", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), "processing")
}

func TestRunTask_WithAttachments(t *testing.T) {
	// Mock registry
	reg := new(mockTaskRegistry)
	reg.On("Register", mock.Anything, 1, "hi", "gpt", mock.Anything).Return(nil)
	origReg := registryGetter
	registryGetter = func() TaskRegistry { return reg }
	t.Cleanup(func() { registryGetter = origReg })

	// Mock StoreAttachments & GetAttachment
	oldStore := runp.StoreAttachments
	runp.StoreAttachments = func(ctx context.Context, attachments runp.Attachments, taskID string) error {
		return nil
	}
	defer func() { runp.StoreAttachments = oldStore }()

	oldGet := runp.GetAttachment
	runp.GetAttachment = func(ctx context.Context, id string) ([]byte, error) {
		if id == "u:1:att-1" {
			return []byte("fake image data"), nil
		}
		return nil, errors.New("not found")
	}
	defer func() { runp.GetAttachment = oldGet }()

	ing := new(mockInngest)
	ing.On("Send", mock.Anything, mock.Anything).Return("id", nil)

	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupDeveloperRouter(nil, nil, ing, user, 0)

	body := `{"prompt":"hi","modelId":"gpt","stream":false,"attachment_ids":["u:1:att-1","u:1:att-missing"]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/run", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Logf("Response: %s", resp.Body.String())
	}
	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestRunTask_RejectsUnauthorizedAttachmentIDs(t *testing.T) {
	oldGet := runp.GetAttachment
	runp.GetAttachment = func(ctx context.Context, id string) ([]byte, error) {
		t.Fatalf("GetAttachment should not be called for unauthorized attachment IDs")
		return nil, errors.New("unexpected call")
	}
	defer func() { runp.GetAttachment = oldGet }()

	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupDeveloperRouter(nil, nil, nil, user, 0)

	body := `{"prompt":"hi","modelId":"gpt","stream":false,"attachment_ids":["u:2:secret"]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/run", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusForbidden, resp.Code)
	assert.Contains(t, resp.Body.String(), "not accessible")
}

func TestRunTask_RejectsOnlyMissingAttachmentIDs(t *testing.T) {
	oldGet := runp.GetAttachment
	runp.GetAttachment = func(ctx context.Context, id string) ([]byte, error) {
		return nil, errors.New("not found")
	}
	defer func() { runp.GetAttachment = oldGet }()

	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupDeveloperRouter(nil, nil, nil, user, 0)

	body := `{"prompt":"hi","modelId":"gpt","stream":false,"attachment_ids":["u:1:att-missing"]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/run", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
	assert.Contains(t, resp.Body.String(), "None of the provided attachments could be resolved")
}

func TestGetTaskResults_Unauthorized(t *testing.T) {
	reg := new(mockTaskRegistry)
	reg.On("Get", "task_1").Return(&runp.TaskState{TaskID: "task_1", Status: runp.StatusCompleted, UserID: 1})

	origReg := registryGetter
	registryGetter = func() TaskRegistry { return reg }
	t.Cleanup(func() { registryGetter = origReg })

	user := &auth.AuthenticatedUser{ID: 2, Email: "attacker@example.com"}
	router := setupDeveloperRouter(nil, nil, nil, user, 0)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/results/task_1", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNotFound, resp.Code)
}

func TestListThreads_Error(t *testing.T) {
	conv := fakeConversationService{
		listFn: func(ctx context.Context, userID string, orgID *int, limit, offset int) (*conversations.ConversationsPage, error) {
			assert.Equal(t, "3", userID)
			assert.Nil(t, orgID)
			assert.Equal(t, 20, limit)
			assert.Equal(t, 0, offset)
			return nil, errors.New("fail")
		},
	}

	q := new(mockDeveloperQueries)
	ing := new(mockInngest)
	user := &auth.AuthenticatedUser{ID: 3, Email: "test@example.com"}
	router := setupDeveloperRouter(q, conv, ing, user, 0)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/threads", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestListThreads_Success(t *testing.T) {
	conv := fakeConversationService{
		listFn: func(ctx context.Context, userID string, orgID *int, limit, offset int) (*conversations.ConversationsPage, error) {
			assert.Equal(t, "3", userID)
			assert.NotNil(t, orgID)
			assert.Equal(t, 10, *orgID)
			assert.Equal(t, 20, limit)
			assert.Equal(t, 0, offset)
			return &conversations.ConversationsPage{Conversations: []conversations.ConversationApiView{}}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 3, Email: "test@example.com"}
	router := setupDeveloperRouter(nil, conv, nil, user, 10) // With Org

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/threads", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestCreateThread_Success(t *testing.T) {
	conv := fakeConversationService{
		createFn: func(ctx context.Context, input conversations.ConversationCreateInput) (*conversations.ConversationApiView, error) {
			assert.Equal(t, "thread", input.UserInput)
			return &conversations.ConversationApiView{ID: 9}, nil
		},
	}

	q := new(mockDeveloperQueries)
	ing := new(mockInngest)
	user := &auth.AuthenticatedUser{ID: 3, Email: "test@example.com"}
	router := setupDeveloperRouter(q, conv, ing, user, 0)

	body := `{"title":"thread"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/threads", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestCreateThread_Error(t *testing.T) {
	conv := fakeConversationService{
		createFn: func(ctx context.Context, input conversations.ConversationCreateInput) (*conversations.ConversationApiView, error) {
			return nil, errors.New("create failed")
		},
	}

	user := &auth.AuthenticatedUser{ID: 3, Email: "test@example.com"}
	router := setupDeveloperRouter(nil, conv, nil, user, 0)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/threads", strings.NewReader(`{"title":"thread"}`))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestCreateThread_Org(t *testing.T) {
	conv := fakeConversationService{
		createFn: func(ctx context.Context, input conversations.ConversationCreateInput) (*conversations.ConversationApiView, error) {
			assert.NotNil(t, input.OrganizationID)
			assert.Equal(t, 10, *input.OrganizationID)
			return &conversations.ConversationApiView{ID: 10}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 3, Email: "test@example.com"}
	router := setupDeveloperRouter(nil, conv, nil, user, 10)

	body := `{"title":"org-thread"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/threads", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestGetThread_Success(t *testing.T) {
	conv := fakeConversationService{
		getFn: func(ctx context.Context, userID string, orgID *int, conversationID int) (*conversations.ConversationApiView, error) {
			assert.Equal(t, "3", userID)
			assert.NotNil(t, orgID)
			assert.Equal(t, 10, *orgID)
			assert.Equal(t, 7, conversationID)
			return &conversations.ConversationApiView{ID: 7, UserInput: "thread"}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 3, Email: "test@example.com"}
	router := setupDeveloperRouter(nil, conv, nil, user, 10)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/threads/7", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), `"id":7`)
	assert.Contains(t, resp.Body.String(), `"user_input":"thread"`)
}
