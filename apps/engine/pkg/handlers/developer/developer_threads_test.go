package developer

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/core/pkg/conversations"
	runhandlers "github.com/TaskForceAI/go-engine/pkg/handlers/run"
	runp "github.com/TaskForceAI/go-engine/pkg/run"
)

func TestGetThread_NotFound(t *testing.T) {
	conv := fakeConversationService{
		getFn: func(ctx context.Context, userID string, orgID *int, conversationID int) (*conversations.ConversationApiView, error) {
			return nil, errors.New("missing")
		},
	}

	user := &auth.AuthenticatedUser{ID: 3, Email: "test@example.com"}
	router := setupDeveloperRouter(nil, conv, nil, user, 0)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/threads/404", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNotFound, resp.Code)
}

func TestGetThreadMessages_DBError(t *testing.T) {
	conv := fakeConversationService{
		getFn: func(ctx context.Context, userID string, orgID *int, conversationID int) (*conversations.ConversationApiView, error) {
			assert.Equal(t, "3", userID)
			assert.Equal(t, 5, conversationID)
			return &conversations.ConversationApiView{ID: 5}, nil
		},
	}

	q := new(mockDeveloperQueries)
	q.On("GetMessagesByConversation", mock.Anything, int32(5)).Return(nil, errors.New("db error"))

	user := &auth.AuthenticatedUser{ID: 3, Email: "test@example.com"}
	router := setupDeveloperRouter(q, conv, nil, user, 0)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/threads/5/messages", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestGetThreadMessages_Success(t *testing.T) {
	conv := fakeConversationService{
		getFn: func(ctx context.Context, userID string, orgID *int, conversationID int) (*conversations.ConversationApiView, error) {
			assert.Equal(t, "3", userID)
			assert.Equal(t, 5, conversationID)
			return &conversations.ConversationApiView{ID: 5}, nil
		},
	}

	q := new(mockDeveloperQueries)
	q.On("GetMessagesByConversation", mock.Anything, int32(5)).Return([]ThreadMessage{{
		ID:             1,
		MessageID:      "msg_1",
		ConversationID: 5,
		Role:           "assistant",
		Content:        "hello",
		IsStreaming:    true,
		IsAgentStatus:  true,
		CreatedAt:      pgtype.Timestamp{Time: time.Date(2026, 7, 3, 12, 0, 0, 0, time.UTC), Valid: true},
		Sources:        []byte(`[{"title":"Docs","url":"https://taskforceai.chat"}]`),
		ToolEvents:     []byte(`[{"toolName":"search","success":true}]`),
		AgentStatuses:  []byte(`[{"status":"completed"}]`),
		VectorClock:    []byte(`{"device":1}`),
		SyncVersion:    7,
		DeviceID:       stringPtr("device-1"),
		IsDeleted:      true,
		UpdatedAt:      pgtype.Timestamp{Time: time.Date(2026, 7, 3, 12, 1, 0, 0, time.UTC), Valid: true},
		Rating:         1,
		Trace:          []byte(`{"span":"secret"}`),
	}}, nil)

	ing := new(mockInngest)
	user := &auth.AuthenticatedUser{ID: 3, Email: "test@example.com"}
	router := setupDeveloperRouter(q, conv, ing, user, 0)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/threads/5/messages", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	var body map[string]any
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &body))
	messages, ok := body["messages"].([]any)
	require.True(t, ok)
	require.Len(t, messages, 1)
	message, ok := messages[0].(map[string]any)
	require.True(t, ok)

	assert.Equal(t, float64(1), message["id"])
	assert.Equal(t, "msg_1", message["message_id"])
	assert.Equal(t, float64(5), message["thread_id"])
	assert.Equal(t, "assistant", message["role"])
	assert.Equal(t, "hello", message["content"])
	assert.Equal(t, true, message["is_agent_status"])
	assert.Equal(t, float64(1), message["rating"])
	assert.Contains(t, message, "sources")
	assert.NotContains(t, message, "is_streaming")
	assert.NotContains(t, message, "vector_clock")
	assert.NotContains(t, message, "sync_version")
	assert.NotContains(t, message, "device_id")
	assert.NotContains(t, message, "is_deleted")
	assert.NotContains(t, message, "trace")
}

func TestGetThreadMessages_TrimsOversizedResponse(t *testing.T) {
	originalBudget := developerResponsePayloadBudgetBytes
	developerResponsePayloadBudgetBytes = 600
	t.Cleanup(func() { developerResponsePayloadBudgetBytes = originalBudget })

	conv := fakeConversationService{
		getFn: func(ctx context.Context, userID string, orgID *int, conversationID int) (*conversations.ConversationApiView, error) {
			return &conversations.ConversationApiView{ID: conversationID}, nil
		},
	}

	q := new(mockDeveloperQueries)
	q.On("GetMessagesByConversation", mock.Anything, int32(5)).Return([]ThreadMessage{
		{ID: 1, Content: "small"},
		{ID: 2, Content: strings.Repeat("x", 1000)},
	}, nil)

	user := &auth.AuthenticatedUser{ID: 3, Email: "test@example.com"}
	router := setupDeveloperRouter(q, conv, nil, user, 0)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/threads/5/messages", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	var body threadMessagesResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &body))
	assert.True(t, body.Truncated)
	assert.Len(t, body.Messages, 1)
}

func TestGetThreadMessages_Returns413WhenEnvelopeCannotFitBudget(t *testing.T) {
	originalBudget := developerResponsePayloadBudgetBytes
	developerResponsePayloadBudgetBytes = 1
	t.Cleanup(func() { developerResponsePayloadBudgetBytes = originalBudget })

	conv := fakeConversationService{
		getFn: func(ctx context.Context, userID string, orgID *int, conversationID int) (*conversations.ConversationApiView, error) {
			return &conversations.ConversationApiView{ID: conversationID}, nil
		},
	}

	q := new(mockDeveloperQueries)
	q.On("GetMessagesByConversation", mock.Anything, int32(5)).Return([]ThreadMessage{{ID: 1, Content: "small"}}, nil)

	user := &auth.AuthenticatedUser{ID: 3, Email: "test@example.com"}
	router := setupDeveloperRouter(q, conv, nil, user, 0)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/threads/5/messages", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusRequestEntityTooLarge, resp.Code)
}

func TestGetThreadMessages_NotFound(t *testing.T) {
	conv := fakeConversationService{
		getFn: func(ctx context.Context, userID string, orgID *int, conversationID int) (*conversations.ConversationApiView, error) {
			assert.Equal(t, "3", userID)
			assert.Equal(t, 5, conversationID)
			return nil, errors.New("missing")
		},
	}

	q := new(mockDeveloperQueries)
	ing := new(mockInngest)
	user := &auth.AuthenticatedUser{ID: 3, Email: "test@example.com"}
	router := setupDeveloperRouter(q, conv, ing, user, 0)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/threads/5/messages", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNotFound, resp.Code)
}

func TestRunThread_InvalidUserID(t *testing.T) {
	user := &auth.AuthenticatedUser{ID: 1 << 40, Email: "invalid-thread-user@example.com"}
	router := setupDeveloperRouter(nil, fakeConversationService{}, nil, user, 0)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/threads/5/runs", strings.NewReader(`{"prompt":"hi","modelId":"gpt","stream":false}`))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
}

func TestRunThread_RateLimited(t *testing.T) {
	withDeveloperRateLimitFallback(t)
	email := "developer-thread-limited@example.com"
	exhaustDeveloperRunRateLimit(t, email, 45, 0)

	user := &auth.AuthenticatedUser{ID: 45, Email: email}
	router := setupDeveloperRouter(nil, fakeConversationService{}, nil, user, 0)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/threads/5/runs", strings.NewReader(`{"prompt":"hi","modelId":"gpt","stream":false}`))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusTooManyRequests, resp.Code)
}

func TestRunThread_OrgPolicyFailure(t *testing.T) {
	user := &auth.AuthenticatedUser{ID: 46, Email: "thread-policy-fail@example.com"}
	router := setupDeveloperRouter(nil, fakeConversationService{}, nil, user, 10)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/threads/5/runs", strings.NewReader(`{"prompt":"hi","modelId":"gpt","stream":false}`))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestRunThread_InvalidID(t *testing.T) {
	conv := fakeConversationService{}
	q := new(mockDeveloperQueries)
	ing := new(mockInngest)
	user := &auth.AuthenticatedUser{ID: 3, Email: "test@example.com"}
	router := setupDeveloperRouter(q, conv, ing, user, 0)

	tooBig := strconv.FormatInt(int64(^uint(0)>>1), 10)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/threads/"+tooBig+"/runs", strings.NewReader(`{"prompt":"hi","modelId":"gpt","stream":false}`))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNotFound, resp.Code)
}

func TestRunThread_Success(t *testing.T) {
	reg := new(mockTaskRegistry)
	reg.On("Register", mock.Anything, 3, "hi", "zai/glm-5.2", mock.Anything).Return(nil)

	ing := new(mockInngest)
	ing.On("Send", mock.Anything, mock.Anything).Return("id", nil)

	origReg := registryGetter
	registryGetter = func() TaskRegistry { return reg }
	t.Cleanup(func() {
		registryGetter = origReg
	})

	conv := fakeConversationService{
		getFn: func(ctx context.Context, userID string, orgID *int, conversationID int) (*conversations.ConversationApiView, error) {
			assert.Equal(t, "3", userID)
			assert.Equal(t, 5, conversationID)
			return &conversations.ConversationApiView{ID: 5}, nil
		},
	}

	q := new(mockDeveloperQueries)
	q.On("GetMessagesByConversation", mock.Anything, int32(5)).Return(nil, nil)

	user := &auth.AuthenticatedUser{ID: 3, Email: "test@example.com"}
	router := setupDeveloperRouter(q, conv, ing, user, 0)

	body := `{"prompt":"hi"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/threads/5/runs", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestRunThread_SubmissionFailureMapsToServerError(t *testing.T) {
	reg := new(mockTaskRegistry)
	reg.On("Register", mock.Anything, 3, "hi", "gpt", mock.Anything).Return(errors.New("registry unavailable"))

	origReg := registryGetter
	registryGetter = func() TaskRegistry { return reg }
	t.Cleanup(func() { registryGetter = origReg })

	conv := fakeConversationService{
		getFn: func(ctx context.Context, userID string, orgID *int, conversationID int) (*conversations.ConversationApiView, error) {
			return &conversations.ConversationApiView{ID: conversationID}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 3, Email: "test@example.com"}
	router := setupDeveloperRouter(nil, conv, new(mockInngest), user, 0)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/threads/5/runs", strings.NewReader(`{"prompt":"hi","modelId":"gpt","stream":false}`))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestRunThread_AppliesOrgNoTrainingPolicy(t *testing.T) {
	reg := new(mockTaskRegistry)
	reg.On("Register", mock.Anything, 3, "hi", "gpt", mock.MatchedBy(func(opts runp.OrchestrateTaskOptions) bool {
		return opts.OrgID != nil && *opts.OrgID == 10 && opts.NoTraining
	})).Return(nil)

	ing := new(mockInngest)
	ing.On("Send", mock.Anything, mock.Anything).Return("id", nil)

	origReg := registryGetter
	registryGetter = func() TaskRegistry { return reg }
	t.Cleanup(func() { registryGetter = origReg })

	conv := fakeConversationService{
		getFn: func(ctx context.Context, userID string, orgID *int, conversationID int) (*conversations.ConversationApiView, error) {
			assert.Equal(t, "3", userID)
			require.NotNil(t, orgID)
			assert.Equal(t, 10, *orgID)
			return &conversations.ConversationApiView{ID: conversationID}, nil
		},
	}
	q := new(mockDeveloperQueries)
	q.On("GetMembership", mock.Anything, runhandlers.MembershipLookupInput{OrganizationID: 10, UserID: 3}).
		Return(runhandlers.MembershipRow{OrganizationID: 10, UserID: 3}, nil)
	q.On("GetOrganizationByID", mock.Anything, int32(10)).
		Return(runhandlers.OrganizationRow{ID: 10, NoTraining: true}, nil)

	user := &auth.AuthenticatedUser{ID: 3, Email: "thread-policy@example.com"}
	router := setupDeveloperRouter(q, conv, ing, user, 10)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/threads/5/runs", strings.NewReader(`{"prompt":"hi","modelId":"gpt","stream":false}`))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	q.AssertExpectations(t)
}

func TestDeveloperHandlers_Unauthorized(t *testing.T) {
	conv := fakeConversationService{}
	q := new(mockDeveloperQueries)
	ing := new(mockInngest)
	router := setupDeveloperRouter(q, conv, ing, nil, 0)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/threads", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusUnauthorized, resp.Code)
}
