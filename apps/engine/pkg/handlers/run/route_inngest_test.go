package run

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/auth"
	runp "github.com/TaskForceAI/go-engine/pkg/run"
	redispkg "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/inngest/inngestgo"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestRegisterPulseHandler_ForbiddenUser(t *testing.T) {
	q := &runQueriesMock{}
	q.On("GetAgent", mock.Anything, "agent-pulse").Return(AgentRow{ID: "agent-pulse", UserID: 99}, nil)
	resp := postPulseJSON(setupRunRouter(q, new(inngestSenderMock), defaultTestRunUser(), 0), `{"agentId":"agent-pulse","reason":"scheduled","ts":1710000000}`)
	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestRegisterPulseHandler_Success(t *testing.T) {
	q := &runQueriesMock{}
	q.On("GetAgent", mock.Anything, "agent-pulse").Return(AgentRow{ID: "agent-pulse", UserID: 44}, nil)
	inngest := new(inngestSenderMock)
	inngest.On("Send", mock.Anything, mock.Anything).Return("evt-pulse", nil)
	resp := postPulseJSON(setupRunRouter(q, inngest, defaultTestRunUser(), 0), `{"agentId":"agent-pulse","reason":"scheduled","ts":1710000000}`)
	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), "pulse queued")
}

func TestRegisterPulseHandler_RateLimited(t *testing.T) {
	swap(t, &runp.RedisClientGetter, func() (redispkg.Cmdable, error) {
		return nil, errors.New("redis unavailable")
	})

	user := &auth.AuthenticatedUser{ID: 88, Email: "pulse-limited@example.com"}
	for range 10 {
		require.NoError(t, enforcePulseRateLimit(context.Background(), user.Email, user.ID, 0))
	}

	q := &runQueriesMock{}
	q.On("GetAgent", mock.Anything, "agent-pulse").Return(AgentRow{ID: "agent-pulse", UserID: 88}, nil)
	inngest := new(inngestSenderMock)
	resp := postPulseJSON(setupRunRouter(q, inngest, user, 0), `{"agentId":"agent-pulse","reason":"scheduled","ts":1710000000}`)

	assert.Equal(t, http.StatusTooManyRequests, resp.Code)
	assert.Contains(t, resp.Body.String(), "Pulse rate limit exceeded")
	inngest.AssertNotCalled(t, "Send", mock.Anything, mock.Anything)
}

func TestRunTask_AttachmentOwnershipEnforced(t *testing.T) {
	swap(t, &runp.GetAttachment, func(ctx context.Context, id string) ([]byte, error) {
		t.Fatalf("GetAttachment should not be called for unauthorized attachment IDs")
		return nil, errors.New("unexpected call")
	})

	user := &auth.AuthenticatedUser{ID: 44, Email: "attachment-ownership@example.com"}
	router := setupRunRouter(nil, nil, user, 0)

	body := `{"prompt":"do it","modelId":"gpt","attachment_ids":["u:999:secret"]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/run", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusForbidden, resp.Code)
	assert.Contains(t, resp.Body.String(), "not accessible")
}

func TestRunTask_AttachmentStorageFailure(t *testing.T) {
	mockRedis := redispkg.NewMockClient()
	redispkg.SetClient(mockRedis)
	defer redispkg.ResetClient()

	swap(t, &runp.RedisClientGetter, func() (redispkg.Cmdable, error) { return mockRedis, nil })
	swap(t, &storeAttachmentsFn, func(_ context.Context, _ runp.Attachments, _ string) error {
		return errors.New("redis unavailable")
	})

	q := new(runQueriesMock)
	reg := new(taskRegistryMock)
	defer withHandlerRegistry(t, reg)()

	ing := new(inngestSenderMock)

	user := defaultTestRunUser()
	router := setupRunRouter(q, ing, user, 0)

	// Seed Redis with an image
	imgID := "u:44:img-fail"
	// Standard PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
	_ = mockRedis.Set(context.Background(), runp.AttachmentMetaKeyPrefix+imgID, []byte("\x89PNG\r\n\x1a\n"), time.Minute)

	body := `{"prompt":"do it","modelId":"gpt","attachment_ids":["u:44:img-fail"]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/run", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
	ing.AssertNotCalled(t, "Send", mock.Anything, mock.Anything)
	reg.AssertNotCalled(t, "Register", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func TestRunTask_ForbiddenWhenUserNotInOrg(t *testing.T) {
	q := new(runQueriesMock)
	q.On("GetMembership", mock.Anything, MembershipLookupInput{
		OrganizationID: 12,
		UserID:         44,
	}).Return(MembershipRow{}, pgx.ErrNoRows)

	reg := new(taskRegistryMock)
	defer withHandlerRegistry(t, reg)()

	ing := new(inngestSenderMock)
	user := defaultTestRunUser()
	router := setupRunRouter(q, ing, user, 12)

	body := `{"prompt":"do it","modelId":"gpt"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/run", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusForbidden, resp.Code)
	q.AssertExpectations(t)
}

func TestRunTask_MembershipLookupFailure(t *testing.T) {
	q := new(runQueriesMock)
	q.On("GetMembership", mock.Anything, MembershipLookupInput{OrganizationID: 12, UserID: 44}).
		Return(MembershipRow{}, errors.New("db unavailable"))

	router := setupRunRouter(q, new(inngestSenderMock), defaultTestRunUser(), 12)
	resp := performRunRequest(router)
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestRunTask_OrganizationPolicyLookupFailsClosed(t *testing.T) {
	q := new(runQueriesMock)
	q.On("GetMembership", mock.Anything, MembershipLookupInput{OrganizationID: 12, UserID: 44}).
		Return(MembershipRow{OrganizationID: 12, UserID: 44}, nil)
	q.On("GetOrganizationByID", mock.Anything, int32(12)).
		Return(OrganizationRow{}, errors.New("policy store unavailable"))

	reg := new(taskRegistryMock)
	defer withHandlerRegistry(t, reg)()
	router := setupRunRouter(q, new(inngestSenderMock), defaultTestRunUser(), 12)
	resp := performRunRequest(router)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
	reg.AssertNotCalled(t, "Register", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func TestRunTask_OrgNoTrainingApplied(t *testing.T) {
	reg := new(taskRegistryMock)
	reg.On("Register", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.MatchedBy(func(opts runp.OrchestrateTaskOptions) bool {
		return opts.NoTraining
	})).Return(nil)
	defer withHandlerRegistry(t, reg)()

	q := new(runQueriesMock)
	q.On("GetMembership", mock.Anything, MembershipLookupInput{OrganizationID: 12, UserID: 44}).Return(MembershipRow{}, nil)
	q.On("GetOrganizationByID", mock.Anything, int32(12)).Return(OrganizationRow{NoTraining: true}, nil)

	ing := new(inngestSenderMock)
	ing.On("Send", mock.Anything, mock.Anything).Return("evt-org", nil)
	router := setupRunRouter(q, ing, defaultTestRunUser(), 12)

	resp := performRunRequest(router)
	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestRunTask_PrivateChatNoTrainingApplied(t *testing.T) {
	reg := new(taskRegistryMock)
	reg.On("Register", mock.Anything, 46, "do it", "gpt", mock.MatchedBy(func(opts runp.OrchestrateTaskOptions) bool {
		return opts.NoTraining
	})).Return(nil)
	defer withHandlerRegistry(t, reg)()

	ing := new(inngestSenderMock)
	ing.On("Send", mock.Anything, mock.Anything).Return("evt-private", nil)
	router := setupRunRouter(new(runQueriesMock), ing, &auth.AuthenticatedUser{ID: 46, Email: "private-chat@example.com"}, 0)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/run", strings.NewReader(`{"prompt":"do it","modelId":"gpt","private_chat":true}`))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestRunTask_PassesEmptyModelIDWhenMissing(t *testing.T) {
	q := new(runQueriesMock)
	reg := new(taskRegistryMock)
	reg.On("Register", mock.Anything, 44, "do it", "", mock.Anything).Return(nil)

	defer withHandlerRegistry(t, reg)()

	ing := new(inngestSenderMock)
	ing.On("Send", mock.Anything, mock.Anything).Return("id", nil)

	user := defaultTestRunUser()
	router := setupRunRouter(q, ing, user, 0)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/run", strings.NewReader(`{"prompt":"do it"}`))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	reg.AssertExpectations(t)
	ing.AssertExpectations(t)
}

func TestRunTask_ProjectIDOutOfBounds(t *testing.T) {
	q := new(runQueriesMock)
	ing := new(inngestSenderMock)
	user := defaultTestRunUser()
	router := setupRunRouter(q, ing, user, 0)

	body := `{"prompt":"do it","modelId":"gpt","projectId":2147483648}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/run", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
	var parsed map[string]any
	_ = json.Unmarshal(resp.Body.Bytes(), &parsed)
	assert.Contains(t, parsed["detail"], "Invalid project ID")
}

func TestRunTask_QueuesInngest(t *testing.T) {
	q := new(runQueriesMock)
	reg := new(taskRegistryMock)
	reg.On("Register", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(nil)

	defer withHandlerRegistry(t, reg)()

	ing := new(inngestSenderMock)
	ing.On("Send", mock.Anything, mock.Anything).Return("id", nil)

	user := defaultTestRunUser()
	router := setupRunRouter(q, ing, user, 0)

	body := `{"prompt":"do it","modelId":"gpt"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/run", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	ing.AssertExpectations(t)

	var parsed map[string]any
	_ = json.Unmarshal(resp.Body.Bytes(), &parsed)
	assert.Equal(t, "processing", parsed["status"])
}

func TestRunResponseFromSubmissionIncludesInlineResult(t *testing.T) {
	reg := new(taskRegistryMock)
	reg.On("Get", "task-inline").Return(&runp.TaskState{
		TaskID:         "task-inline",
		Status:         runp.StatusCompleted,
		Result:         "done",
		ConversationID: 42,
		TraceID:        "trace-task-inline",
	}).Once()
	defer withHandlerRegistry(t, reg)()

	response := runResponseFromSubmission(runp.TaskSubmissionResult{
		TaskID: "task-inline",
		Status: runp.StatusCompleted,
	})

	if assert.NotNil(t, response.Result) {
		assert.Equal(t, "done", *response.Result)
	}
	if assert.NotNil(t, response.ConversationID) {
		assert.Equal(t, int32(42), *response.ConversationID)
	}
	assert.Equal(t, "trace-task-inline", response.TraceID)
	reg.AssertExpectations(t)
}

func TestRunResponseFromSubmissionCompletedTaskMissing(t *testing.T) {
	reg := new(taskRegistryMock)
	reg.On("Get", "task-missing").Return(nil).Once()
	defer withHandlerRegistry(t, reg)()

	response := runResponseFromSubmission(runp.TaskSubmissionResult{
		TaskID: "task-missing",
		Status: runp.StatusCompleted,
	})

	assert.Equal(t, "task-missing", response.TaskID)
	assert.Equal(t, string(runp.StatusCompleted), response.Status)
	assert.Nil(t, response.Result)
	assert.Nil(t, response.ConversationID)
	reg.AssertExpectations(t)
}

func TestRunTask_InvalidUserID(t *testing.T) {
	router := setupRunRouter(nil, nil, &auth.AuthenticatedUser{ID: 1 << 40, Email: "invalid-run@example.com"}, 0)

	resp := postRunJSON(router, `{"prompt":"do it","modelId":"gpt"}`)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
}

func TestRunTask_QuickModeOverride(t *testing.T) {
	q := new(runQueriesMock)
	reg := new(taskRegistryMock)
	defer withHandlerRegistry(t, reg)()

	reg.On("Register", mock.Anything, 44, "do it", "gpt", mock.MatchedBy(func(opts runp.OrchestrateTaskOptions) bool {
		return opts.QuickModeEnabled
	})).Return(nil)

	ing := new(inngestSenderMock)
	ing.On("Send", mock.Anything, mock.MatchedBy(func(evt inngestgo.GenericEvent[map[string]any]) bool {
		if evt.Name != "task.execute" {
			return false
		}
		rawOpts, ok := evt.Data["options"]
		if !ok {
			return false
		}
		opts, ok := rawOpts.(runp.OrchestrateTaskOptions)
		return ok && opts.QuickModeEnabled
	})).Return("id", nil)

	user := &auth.AuthenticatedUser{ID: 44, Email: "test@example.com", QuickModeEnabled: false}
	router := setupRunRouter(q, ing, user, 0)

	resp := postRunJSON(router, `{"prompt":"do it","modelId":"gpt","options":{"quickModeEnabled":true}}`)
	assert.Equal(t, http.StatusOK, resp.Code)
	reg.AssertExpectations(t)
	ing.AssertExpectations(t)
}

func TestRunTask_DesktopComputerUseBindsHeaderAndAgentCount(t *testing.T) {
	q := new(runQueriesMock)
	reg := new(taskRegistryMock)
	defer withHandlerRegistry(t, reg)()

	reg.On("Register", mock.Anything, 44, "look around", "gpt", mock.MatchedBy(func(opts runp.OrchestrateTaskOptions) bool {
		return opts.Source == "desktop" &&
			!opts.ComputerUseEnabled &&
			!opts.QuickModeEnabled &&
			opts.AgentCount == 1
	})).Return(nil)

	ing := new(inngestSenderMock)
	ing.On("Send", mock.Anything, mock.MatchedBy(func(evt inngestgo.GenericEvent[map[string]any]) bool {
		rawOpts, ok := evt.Data["options"]
		if !ok {
			return false
		}
		opts, ok := rawOpts.(runp.OrchestrateTaskOptions)
		return ok && opts.Source == "desktop" && !opts.ComputerUseEnabled && opts.AgentCount == 1
	})).Return("id", nil)

	user := &auth.AuthenticatedUser{ID: 44, Email: "desktop@example.com", QuickModeEnabled: true, IsAdmin: true}
	router := setupRunRouter(q, ing, user, 0)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/run", strings.NewReader(`{"prompt":"look around","modelId":"gpt","options":{"quickModeEnabled":false,"computerUseEnabled":true,"agentCount":1}}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "TaskForceAI-Desktop/0.11.1")
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	reg.AssertExpectations(t)
	ing.AssertExpectations(t)
}

func TestRunTask_RedisLimiterFailure_UsesFallbackLimiter(t *testing.T) {
	reg := new(taskRegistryMock)
	reg.On("Register", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(nil)
	defer withHandlerRegistry(t, reg)()

	ing := new(inngestSenderMock)
	ing.On("Send", mock.Anything, mock.Anything).Return("id", nil)

	swap(t, &fallbackRunLimiter, newInMemoryWindowCounter())

	redispkg.SetClient(&failingIncrRedisClient{
		MockClient: redispkg.NewMockClient(),
		incrErr:    errors.New("redis incr failed"),
	})
	t.Cleanup(redispkg.ResetClient)

	q := new(runQueriesMock)
	user := &auth.AuthenticatedUser{ID: 45, Email: "fallback-limiter-error@example.com"}
	router := setupRunRouter(q, ing, user, 0)

	for range 10 {
		resp := performRunRequest(router)
		assert.Equal(t, http.StatusOK, resp.Code)
	}

	limited := performRunRequest(router)
	assert.Equal(t, http.StatusTooManyRequests, limited.Code)
	reg.AssertNumberOfCalls(t, "Register", 10)
	ing.AssertNumberOfCalls(t, "Send", 10)
}

func TestRunTask_RedisUnavailable_UsesFallbackLimiter(t *testing.T) {
	reg := new(taskRegistryMock)
	reg.On("Register", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(nil)
	defer withHandlerRegistry(t, reg)()

	ing := new(inngestSenderMock)
	ing.On("Send", mock.Anything, mock.Anything).Return("id", nil)

	swap(t, &fallbackRunLimiter, newInMemoryWindowCounter())

	redispkg.ResetClient()
	t.Cleanup(redispkg.ResetClient)
	t.Setenv("REDIS_URL", "")
	t.Setenv("REDIS_KV_URL", "")

	q := new(runQueriesMock)
	user := &auth.AuthenticatedUser{ID: 44, Email: "fallback-unavailable@example.com"}
	router := setupRunRouter(q, ing, user, 0)

	for range 10 {
		resp := performRunRequest(router)
		assert.Equal(t, http.StatusOK, resp.Code)
	}

	limited := performRunRequest(router)
	assert.Equal(t, http.StatusTooManyRequests, limited.Code)
	reg.AssertNumberOfCalls(t, "Register", 10)
	ing.AssertNumberOfCalls(t, "Send", 10)
}

func TestRunTask_Success(t *testing.T) {
	q := new(runQueriesMock)
	q.On("GetMembership", mock.Anything, MembershipLookupInput{
		OrganizationID: 12,
		UserID:         44,
	}).Return(MembershipRow{OrganizationID: 12, UserID: 44}, nil)
	q.On("GetOrganizationByID", mock.Anything, int32(12)).Return(OrganizationRow{ID: 12, NoTraining: true}, nil)

	reg := new(taskRegistryMock)
	defer withHandlerRegistry(t, reg)()

	reg.On("Register", mock.Anything, 44, "do it", "gpt", mock.MatchedBy(func(opts runp.OrchestrateTaskOptions) bool {
		return opts.NoTraining && *opts.ProjectID == 7
	})).Return(nil)

	ing := new(inngestSenderMock)
	ing.On("Send", mock.Anything, mock.MatchedBy(func(evt any) bool {
		return true // Simple for now
	})).Return("id", nil)

	user := defaultTestRunUser()
	router := setupRunRouter(q, ing, user, 12)

	body := `{"prompt":"do it","modelId":"gpt","projectId":7}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/run", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	q.AssertExpectations(t)
	reg.AssertExpectations(t)
	ing.AssertExpectations(t)
}

func TestRunTask_Unauthorized(t *testing.T) {
	q := new(runQueriesMock)
	ing := new(inngestSenderMock)
	router := setupRunRouter(q, ing, nil, 0)

	body := `{"prompt":"do it","modelId":"gpt"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/run", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusUnauthorized, resp.Code)
}

func TestRunTask_UnauthorizedAttachmentForbidden(t *testing.T) {
	swap(t, &runp.GetAttachment, func(ctx context.Context, id string) ([]byte, error) {
		return []byte("data"), nil
	})
	swap(t, &runp.GetAttachmentInfo, func(ctx context.Context, fileID string) (*runp.AttachmentInfo, bool, error) {
		return &runp.AttachmentInfo{MimeType: "text/plain", Name: "note.txt", Size: 4}, true, nil
	})

	router := setupRunRouter(new(runQueriesMock), new(inngestSenderMock), &auth.AuthenticatedUser{ID: 44, Email: "test@example.com"}, 0)
	body := `{"prompt":"do it","modelId":"gpt","attachment_ids":["u:99:foreign"]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/run", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)
	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestRunTask_UnresolvedAttachmentsRejected(t *testing.T) {
	swap(t, &fallbackRunLimiter, newInMemoryWindowCounter())
	router := setupRunRouter(new(runQueriesMock), new(inngestSenderMock), &auth.AuthenticatedUser{ID: 44, Email: "test@example.com"}, 0)

	body := `{"prompt":"do it","modelId":"gpt","attachment_ids":["u:44:missing"]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/run", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)
	assert.Equal(t, http.StatusBadRequest, resp.Code)
}

func TestRunTask_VideoAllowedForGeminiModel(t *testing.T) {
	swap(t, &fallbackRunLimiter, newInMemoryWindowCounter())

	mockRedis := redispkg.NewMockClient()
	redispkg.SetClient(mockRedis)
	defer redispkg.ResetClient()

	swap(t, &runp.RedisClientGetter, func() (redispkg.Cmdable, error) { return mockRedis, nil })
	swap(t, &storeAttachmentsFn, func(_ context.Context, _ runp.Attachments, _ string) error {
		return nil
	})

	q := new(runQueriesMock)
	reg := new(taskRegistryMock)
	defer withHandlerRegistry(t, reg)()
	reg.On("Register", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(nil)

	ing := new(inngestSenderMock)
	ing.On("Send", mock.Anything, mock.Anything).Return("id", nil)

	user := defaultTestRunUser()
	router := setupRunRouter(q, ing, user, 0)

	// Seed Redis with a video attachment
	videoID := "u:44:vid-gemini"
	videoData := make([]byte, 512)
	copy(videoData, []byte("\x00\x00\x00\x18ftypmp42"))
	_ = mockRedis.Set(context.Background(), runp.AttachmentMetaKeyPrefix+videoID, videoData, time.Minute)
	videoInfo, marshalErr := json.Marshal(runp.AttachmentInfo{
		MimeType: "video/mp4",
		Name:     "clip.mp4",
		Size:     int64(len(videoData)),
	})
	require.NoError(t, marshalErr)
	_ = mockRedis.Set(context.Background(), runp.AttachmentInfoKeyPrefix+videoID, videoInfo, time.Minute)

	body := `{"prompt":"describe this video","modelId":"google/gemini-2.5-flash","attachment_ids":["u:44:vid-gemini"]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/run", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestRunTask_VideoRejectedForNonGeminiModel(t *testing.T) {
	swap(t, &fallbackRunLimiter, newInMemoryWindowCounter())

	mockRedis := redispkg.NewMockClient()
	redispkg.SetClient(mockRedis)
	defer redispkg.ResetClient()

	swap(t, &runp.RedisClientGetter, func() (redispkg.Cmdable, error) { return mockRedis, nil })

	q := new(runQueriesMock)
	ing := new(inngestSenderMock)
	// Allow Send to be called or not, we don't care about the event here since we expect validation failure
	ing.On("Send", mock.Anything, mock.Anything).Return("id", nil).Maybe()

	user := defaultTestRunUser()
	router := setupRunRouter(q, ing, user, 0)

	// Seed Redis with a video attachment
	videoID := "u:44:vid-123"
	// Standard MP4 bytes at start: 00 00 00 18 66 74 79 70 6d 70 34 32 (ftypmp42)
	// We pad to 512 bytes to ensure http.DetectContentType has enough data
	videoData := make([]byte, 512)
	copy(videoData, []byte("\x00\x00\x00\x18ftypmp42"))
	_ = mockRedis.Set(context.Background(), runp.AttachmentMetaKeyPrefix+videoID, videoData, time.Minute)
	videoInfo, marshalErr := json.Marshal(runp.AttachmentInfo{
		MimeType: "video/mp4",
		Name:     "clip.mp4",
		Size:     int64(len(videoData)),
	})
	require.NoError(t, marshalErr)
	_ = mockRedis.Set(context.Background(), runp.AttachmentInfoKeyPrefix+videoID, videoInfo, time.Minute)

	body := `{"prompt":"describe this video","modelId":"openai/gpt-4","attachment_ids":["u:44:vid-123"]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/run", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusUnprocessableEntity, resp.Code)

	var parsed map[string]any
	_ = json.Unmarshal(resp.Body.Bytes(), &parsed)
	assert.Contains(t, parsed["detail"], "video attachments are only supported with video-capable models")
}

func TestStoreAttachmentsWrapper(t *testing.T) {
	swap(t, &runp.RedisClientGetter, func() (redispkg.Cmdable, error) {
		return redispkg.NewMockClient(), nil
	})
	err := storeAttachments(context.Background(), runp.Attachments{
		Files: []runp.FileAttachment{{ID: "file-1", Name: "file.txt", MimeType: "text/plain", Data: []byte("hello")}},
	}, "task-store")
	require.NoError(t, err)
}

type runQueriesMock struct {
	mock.Mock
}

type inngestSenderMock struct {
	mock.Mock
}

func (m *inngestSenderMock) Send(ctx context.Context, event any) (string, error) {
	ret := m.Called(ctx, event)
	return ret.String(0), ret.Error(1)
}

func (m *runQueriesMock) GetOrganizationByID(ctx context.Context, id int32) (OrganizationRow, error) {
	ret := m.Called(ctx, id)
	value := ret.Get(0)
	if value == nil {
		return OrganizationRow{}, ret.Error(1)
	}
	organization, ok := value.(OrganizationRow)
	if !ok {
		return OrganizationRow{}, errors.New("unexpected organization mock type")
	}
	return organization, ret.Error(1)
}

func (m *runQueriesMock) GetMembership(ctx context.Context, arg MembershipLookupInput) (MembershipRow, error) {
	ret := m.Called(ctx, arg)
	value := ret.Get(0)
	if value == nil {
		return MembershipRow{}, ret.Error(1)
	}
	membership, ok := value.(MembershipRow)
	if !ok {
		return MembershipRow{}, errors.New("unexpected membership mock type")
	}
	return membership, ret.Error(1)
}

func (m *runQueriesMock) GetExecutionTrace(ctx context.Context, taskID string) (ExecutionTraceRow, error) {
	ret := m.Called(ctx, taskID)
	value := ret.Get(0)
	if value == nil {
		return ExecutionTraceRow{}, ret.Error(1)
	}
	trace, ok := value.(ExecutionTraceRow)
	if !ok {
		return ExecutionTraceRow{}, errors.New("unexpected execution trace mock type")
	}
	return trace, ret.Error(1)
}

func (m *runQueriesMock) GetAgent(ctx context.Context, id string) (AgentRow, error) {
	ret := m.Called(ctx, id)
	value := ret.Get(0)
	if value == nil {
		return AgentRow{}, ret.Error(1)
	}
	agent, ok := value.(AgentRow)
	if !ok {
		return AgentRow{}, errors.New("unexpected agent mock type")
	}
	return agent, ret.Error(1)
}

type taskRegistryMock struct {
	mock.Mock
}

func (m *taskRegistryMock) Register(taskID string, userID int, prompt, modelID string, opts runp.OrchestrateTaskOptions) error {
	ret := m.Called(taskID, userID, prompt, modelID, opts)
	return ret.Error(0)
}

func (m *taskRegistryMock) Get(taskID string) *runp.TaskState {
	ret := m.Called(taskID)
	value := ret.Get(0)
	if value == nil {
		return nil
	}
	state, ok := value.(*runp.TaskState)
	if !ok {
		return nil
	}
	return state
}

func (m *taskRegistryMock) MarkStarted(taskID string) bool {
	ret := m.Called(taskID)
	return ret.Bool(0)
}

func (m *taskRegistryMock) MarkStartedWithError(taskID string) (bool, error) {
	ret := m.Called(taskID)
	return ret.Bool(0), ret.Error(1)
}

func (m *taskRegistryMock) Heartbeat(ctx context.Context, taskID string) error {
	ret := m.Called(ctx, taskID)
	return ret.Error(0)
}

func (m *taskRegistryMock) Update(ctx context.Context, taskID string, status runp.TaskStatus, result, errStr string) error {
	ret := m.Called(ctx, taskID, status, result, errStr)
	return ret.Error(0)
}

func (m *taskRegistryMock) UpdateWithConversation(
	ctx context.Context,
	taskID string,
	status runp.TaskStatus,
	result, errStr string,
	conversationID int32,
	traceID string,
) error {
	ret := m.Called(ctx, taskID, status, result, errStr, conversationID, traceID)
	return ret.Error(0)
}

func (m *taskRegistryMock) UpdateWithApproval(ctx context.Context, taskID string, approval *runp.PendingApproval) error {
	ret := m.Called(ctx, taskID, approval)
	return ret.Error(0)
}

func (m *taskRegistryMock) ClearApproval(ctx context.Context, taskID string) error {
	ret := m.Called(ctx, taskID)
	return ret.Error(0)
}

func (m *taskRegistryMock) UpdateProgress(taskID string, agentStatuses, toolEvents any, budgetUsage *runp.BudgetUsage) error {
	ret := m.Called(taskID, agentStatuses, toolEvents, budgetUsage)
	return ret.Error(0)
}

func (m *taskRegistryMock) ListByUser(ctx context.Context, userID int, opts runp.TaskListOptions) ([]runp.TaskState, error) {
	ret := m.Called(ctx, userID, opts)
	value := ret.Get(0)
	if value == nil {
		return nil, ret.Error(1)
	}
	tasks, ok := value.([]runp.TaskState)
	if !ok {
		return nil, errors.New("unexpected task list mock type")
	}
	return tasks, ret.Error(1)
}
