package run

import (
	"bytes"
	"context"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/auth"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/go-engine/pkg/handlers/taskruntime"
	runp "github.com/TaskForceAI/go-engine/pkg/run"
	redispkg "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/inngest/inngestgo"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func setupRunRouter(q RunQueries, inngest runp.InngestSender, user *auth.AuthenticatedUser, orgID int) *chi.Mux {
	return setupRunRouterWithAuthMethod(q, inngest, user, orgID, "")
}

func setupRunRouterWithAuthMethod(q RunQueries, inngest runp.InngestSender, user *auth.AuthenticatedUser, orgID int, authMethod string) *chi.Mux {
	_ = os.Setenv("TASKFORCE_ASYNC_QUICK_MODE", "1")
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if user != nil {
				ctx := context.WithValue(r.Context(), adapterhandler.UserContextKey, user)
				if authMethod != "" {
					ctx = context.WithValue(ctx, adapterhandler.AuthMethodContextKey, authMethod)
				}
				if orgID != 0 {
					ctx = context.WithValue(ctx, adapterhandler.OrgIDContextKey, orgID)
				}
				r = r.WithContext(ctx)
			}
			next.ServeHTTP(w, r)
		})
	})
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	RegisterHandlers(api, q, inngest)
	return r
}

type failingIncrRedisClient struct {
	*redispkg.MockClient
	incrErr error
}

type attachmentTestFile struct {
	*strings.Reader
}

func (attachmentTestFile) Close() error {
	return nil
}

func (c *failingIncrRedisClient) Incr(ctx context.Context, key string) (int, error) {
	return 0, c.incrErr
}

func (c *failingIncrRedisClient) CheckRateLimit(context.Context, string, int, time.Duration) (bool, int, time.Time, error) {
	return false, 0, time.Now(), c.incrErr
}

type nonListingTaskRegistrar struct{}

func (nonListingTaskRegistrar) Register(string, int, string, string, runp.OrchestrateTaskOptions) error {
	return nil
}

func (nonListingTaskRegistrar) Get(string) *runp.TaskState { return nil }

func (nonListingTaskRegistrar) MarkStarted(string) bool { return false }

func (nonListingTaskRegistrar) MarkStartedWithError(string) (bool, error) { return false, nil }

func (nonListingTaskRegistrar) Heartbeat(context.Context, string) error { return nil }

func (nonListingTaskRegistrar) Update(context.Context, string, runp.TaskStatus, string, string) error {
	return nil
}

func (nonListingTaskRegistrar) UpdateWithConversation(context.Context, string, runp.TaskStatus, string, string, int32, string) error {
	return nil
}

func (nonListingTaskRegistrar) UpdateWithApproval(context.Context, string, *runp.PendingApproval) error {
	return nil
}

func (nonListingTaskRegistrar) ClearApproval(context.Context, string) error { return nil }

func (nonListingTaskRegistrar) UpdateProgress(string, any, any, *runp.BudgetUsage) error {
	return nil
}

func performRunRequest(router http.Handler) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/run", strings.NewReader(`{"prompt":"do it","modelId":"gpt"}`))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)
	return resp
}

func TestRunTaskRejectsInvalidReasoningConfiguration(t *testing.T) {
	t.Setenv("NODE_ENV", "development")
	swap(t, &runp.RedisClientGetter, func() (redispkg.Cmdable, error) {
		return nil, errors.New("redis unavailable")
	})
	router := setupRunRouter(nil, nil, &auth.AuthenticatedUser{ID: 44, Email: "reasoning@example.com"}, 0)

	missingModel := postRunJSON(router, `{"prompt":"do it","reasoningEffort":"high"}`)
	assert.Equal(t, http.StatusBadRequest, missingModel.Code)
	assert.Contains(t, missingModel.Body.String(), "modelId is required")

	invalidEffort := postRunJSON(router, `{"prompt":"do it","modelId":"gpt-4","reasoningEffort":"extreme"}`)
	assert.Equal(t, http.StatusBadRequest, invalidEffort.Code)
}

type readAllFailTempFile struct {
	*os.File
}

func (f *readAllFailTempFile) Read(p []byte) (int, error) {
	return 0, errors.New("read all failed")
}

type boundaryOverflowReader struct {
	data   []byte
	offset int
}

func (r *boundaryOverflowReader) Read(p []byte) (int, error) {
	if r.offset >= len(r.data) {
		return 0, io.EOF
	}
	n := copy(p, r.data[r.offset:])
	r.offset += n
	return n, nil
}

type writeHeadFailFile struct {
	*os.File
}

func (f *writeHeadFailFile) Write(p []byte) (int, error) {
	return 0, errors.New("write head failed")
}

type seekFailFile struct {
	*os.File
}

func (f *seekFailFile) Seek(offset int64, whence int) (int64, error) {
	return 0, errors.New("seek failed")
}

func TestActiveTasksHandler_ReturnsCurrentUserTasks(t *testing.T) {
	userID := 44
	reg := new(taskRegistryMock)
	reg.On("ListByUser", mock.Anything, userID, runp.TaskListOptions{Limit: 10}).Return([]runp.TaskState{
		{
			TaskID:  "desktop-task",
			UserID:  userID,
			Status:  runp.StatusAwaiting,
			Prompt:  "desktop prompt",
			ModelID: "model-1",
			Options: runp.OrchestrateTaskOptions{
				Source:             "desktop",
				ComputerUseEnabled: true,
				ClientMCPTools: []runp.ClientMCPTool{
					{ServerName: "github", ToolName: "issues", Title: "GitHub Issues"},
				},
			},
			UpdatedAt: 123,
			PendingApproval: &runp.PendingApproval{
				ApprovalID: "approval-123",
				Permission: "command",
				AgentName:  "desktop",
				Patterns:   []string{"bun test"},
				Metadata:   map[string]any{"cwd": "/repo"},
			},
		},
	}, nil)

	defer withRunRegistry(t, reg)()

	router := setupRunRouter(nil, nil, &auth.AuthenticatedUser{ID: userID}, 0)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/active?limit=10", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), `"task_id":"desktop-task"`)
	assert.Contains(t, resp.Body.String(), `"source":"desktop"`)
	assert.Contains(t, resp.Body.String(), `"computer_use":true`)
	assert.Contains(t, resp.Body.String(), `"server_name":"github"`)
	assert.Contains(t, resp.Body.String(), `"pending_approval"`)
	assert.Contains(t, resp.Body.String(), `"approval_id":"approval-123"`)
	reg.AssertExpectations(t)
}

func TestActiveTasksHandler_ListError(t *testing.T) {
	userID := 44
	reg := new(taskRegistryMock)
	reg.On("ListByUser", mock.Anything, userID, runp.TaskListOptions{Limit: 25}).Return(nil, errors.New("registry unavailable"))
	defer withRunRegistry(t, reg)()

	router := setupRunRouter(nil, nil, &auth.AuthenticatedUser{ID: userID}, 0)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/active", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
	reg.AssertExpectations(t)
}

func TestActiveTasksHandler_NonListingRegistryReturnsEmptyList(t *testing.T) {
	defer withRunRegistry(t, nonListingTaskRegistrar{})()

	router := setupRunRouter(nil, nil, &auth.AuthenticatedUser{ID: 44}, 0)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/active", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), `"tasks":[]`)
}

func TestActiveTasksHandlerRejectsAPIKeyAuth(t *testing.T) {
	router := setupRunRouterWithAuthMethod(nil, nil, defaultTestRunUser(), 0, adapterhandler.AuthMethodAPIKey)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/active?limit=10", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestMapClientMCPToolsEmpty(t *testing.T) {
	assert.Nil(t, mapClientMCPTools(nil))
}

func TestApproveHandler_DecisionError(t *testing.T) {
	taskID := "task-1"
	userID := 44
	reg := new(taskRegistryMock)
	reg.On("Get", taskID).Return(awaitingApprovalState(taskID, userID))
	defer withRunRegistry(t, reg)()

	swap(t, &runp.SendApprovalDecision, func(ctx context.Context, id string, decision runp.ApprovalDecision) error {
		return errors.New("redis pubsub failed")
	})

	resp := postTaskApprove(approveRouterForUser(defaultTestRunUser()), taskID, `{"approved":true}`)
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestApproveHandler_NotAwaitingApproval(t *testing.T) {
	taskID := "task-not-awaiting"
	userID := 44
	reg := new(taskRegistryMock)
	reg.On("Get", taskID).Return(&runp.TaskState{
		TaskID: taskID,
		UserID: userID,
		Status: runp.StatusProcessing,
	})
	defer withRunRegistry(t, reg)()

	called := false
	swap(t, &runp.SendApprovalDecision, func(ctx context.Context, id string, decision runp.ApprovalDecision) error {
		called = true
		return nil
	})

	resp := postTaskApprove(approveRouterForUser(defaultTestRunUser()), taskID, `{"approved":true}`)
	assert.Equal(t, http.StatusConflict, resp.Code)
	assert.Contains(t, resp.Body.String(), "not awaiting approval")
	assert.False(t, called)
}

func TestApproveHandler_NotFound(t *testing.T) {
	reg := new(taskRegistryMock)
	reg.On("Get", "ghost").Return(nil)
	defer withRunRegistry(t, reg)()

	resp := postTaskApprove(approveRouterForUser(defaultTestRunUser()), "ghost", `{"approved":true}`)
	assert.Equal(t, http.StatusNotFound, resp.Code)
}

func TestApproveHandler_PayloadTooLarge(t *testing.T) {
	taskID := "task-approve-too-large"
	userID := 44

	reg := new(taskRegistryMock)
	reg.On("Get", taskID).Return(awaitingApprovalState(taskID, userID))
	defer withRunRegistry(t, reg)()

	swap(t, &runp.SendApprovalDecision, func(ctx context.Context, id string, decision runp.ApprovalDecision) error {
		return runp.ErrApprovalDecisionPayloadTooLarge
	})

	resp := postTaskApprove(approveRouterForUser(defaultTestRunUser()), taskID, `{"approved":true,"result":{"output":"too-big"}}`)
	assert.Equal(t, http.StatusBadRequest, resp.Code)
	assert.Contains(t, resp.Body.String(), "payload exceeds size limit")
}

func TestApproveHandler_Success(t *testing.T) {
	taskID := "task-to-approve"
	userID := 44
	approvalID := "approval-to-approve"

	// Mock registry
	reg := new(taskRegistryMock)
	state := awaitingApprovalState(taskID, userID)
	state.PendingApproval.ApprovalID = approvalID
	reg.On("Get", taskID).Return(state)
	defer withRunRegistry(t, reg)()

	swap(t, &runp.SendApprovalDecision, func(ctx context.Context, id string, decision runp.ApprovalDecision) error {
		assert.Equal(t, approvalID, id)
		assert.True(t, decision.Approved)
		return nil
	})

	resp := postTaskApprove(approveRouterForUser(defaultTestRunUser()), taskID, `{"approved":true}`)
	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), "Decision sent")
}

func TestApproveHandlerRejectsAPIKeyAuth(t *testing.T) {
	taskID := "task-api-key-approve"
	userID := defaultTestRunUser().ID
	reg := new(taskRegistryMock)
	reg.On("Get", taskID).Return(awaitingApprovalState(taskID, userID)).Maybe()
	defer withRunRegistry(t, reg)()

	resp := postTaskApprove(
		approveRouterForUserWithAuthMethod(defaultTestRunUser(), adapterhandler.AuthMethodAPIKey),
		taskID,
		`{"approved":true}`,
	)

	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestApproveHandler_Unauthorized(t *testing.T) {
	taskID := "task-1"
	reg := new(taskRegistryMock)
	reg.On("Get", taskID).Return(&runp.TaskState{TaskID: taskID, UserID: 99})
	defer withRunRegistry(t, reg)()

	resp := postTaskApprove(approveRouterForUser(defaultTestRunUser()), taskID, `{"approved":true}`)
	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestAttachmentUpload_CreateTempFileFailure(t *testing.T) {
	swap(t, &createAttachmentTempFile, func() (attachmentTempFile, error) {
		return nil, errors.New("temp file failed")
	})

	router := approveRouterForUser(defaultTestRunUser())

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	fw, _ := writer.CreateFormFile("file", "note.txt")
	_, _ = fw.Write([]byte("hello"))
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/attachments/upload", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
	assert.Contains(t, resp.Body.String(), "temporary store")
}

func TestAttachmentUpload_RateLimited(t *testing.T) {
	swap(t, &runp.RedisClientGetter, func() (redispkg.Cmdable, error) {
		return nil, errors.New("redis unavailable")
	})
	email := "attachment-limited@example.com"
	for range 30 {
		require.NoError(t, enforceAttachmentUploadRateLimit(context.Background(), email, 44))
	}

	router := approveRouterForUser(&auth.AuthenticatedUser{ID: 44, Email: email})
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	fw, err := writer.CreateFormFile("file", "note.txt")
	require.NoError(t, err)
	_, err = fw.Write([]byte("hello"))
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	req := httptest.NewRequest(http.MethodPost, "/api/v1/attachments/upload", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)

	assert.Equal(t, http.StatusTooManyRequests, resp.Code)
}

func TestAttachmentUpload_ExactLimitPlusOneByte(t *testing.T) {
	payload := make([]byte, 512)
	for i := range payload {
		payload[i] = 'a'
	}
	swap(t, &readAttachmentPreview, func(file io.Reader, head []byte) (int, error) {
		return copy(head, payload), nil
	})
	maxBytes := int64(runp.MaxVideoBytes) - int64(len(payload))
	swap(t, &copyAttachmentToTemp, func(dst io.Writer, src io.Reader, limit int64) (int64, error) {
		assert.Equal(t, maxBytes, limit)
		return limit, nil
	})

	router := approveRouterForUser(defaultTestRunUser())

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	fw, err := writer.CreateFormFile("file", "big.bin")
	require.NoError(t, err)
	reader := &boundaryOverflowReader{data: append(payload, make([]byte, int(maxBytes)+1)...)}
	_, err = io.Copy(fw, reader)
	assert.NoError(t, err)
	assert.NoError(t, writer.Close())

	req := httptest.NewRequest(http.MethodPost, "/api/v1/attachments/upload", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
	assert.Contains(t, resp.Body.String(), "File too large")
}

func TestAttachmentUpload_VideoUsesVideoLimit(t *testing.T) {
	mp4Header := []byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm', 0, 0, 0, 0, 'm', 'p', '4', '2', 'm', 'p', '4', '1'}
	swap(t, &readAttachmentPreview, func(file io.Reader, head []byte) (int, error) {
		return copy(head, mp4Header), nil
	})
	swap(t, &copyAttachmentToTemp, func(dst io.Writer, src io.Reader, limit int64) (int64, error) {
		assert.Equal(t, int64(runp.MaxVideoBytes-len(mp4Header)), limit)
		return 0, nil
	})
	swap(t, &runp.StoreAttachment, func(ctx context.Context, id string, data []byte, ttl time.Duration) error {
		assert.Equal(t, mp4Header, data)
		return nil
	})
	swap(t, &runp.StoreAttachmentInfo, func(ctx context.Context, fileID string, info runp.AttachmentInfo, ttl time.Duration) error {
		assert.Equal(t, "video/mp4", info.MimeType)
		assert.Equal(t, int64(len(mp4Header)), info.Size)
		return nil
	})

	router := approveRouterForUser(defaultTestRunUser())
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	fw, err := writer.CreateFormFile("file", "clip.mp4")
	require.NoError(t, err)
	_, err = fw.Write([]byte("ignored"))
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	req := httptest.NewRequest(http.MethodPost, "/api/v1/attachments/upload", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), "video/mp4")
}

func TestAttachmentUpload_DefaultsWhenMimeLimitIsNonPositive(t *testing.T) {
	swap(t, &attachmentByteLimit, func(string) (int64, bool, string) {
		return 0, true, ""
	})
	swap(t, &runp.StoreAttachment, func(ctx context.Context, id string, data []byte, ttl time.Duration) error {
		assert.Equal(t, []byte("hello"), data)
		return nil
	})
	swap(t, &runp.StoreAttachmentInfo, func(ctx context.Context, fileID string, info runp.AttachmentInfo, ttl time.Duration) error {
		assert.Equal(t, int64(5), info.Size)
		return nil
	})

	router := approveRouterForUser(defaultTestRunUser())
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	fw, err := writer.CreateFormFile("file", "note.txt")
	require.NoError(t, err)
	_, err = fw.Write([]byte("hello"))
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	req := httptest.NewRequest(http.MethodPost, "/api/v1/attachments/upload", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestAttachmentUpload_FileTooLarge(t *testing.T) {
	swap(t, &runp.StoreAttachment, func(ctx context.Context, id string, data []byte, ttl time.Duration) error {
		return nil
	})
	swap(t, &runp.StoreAttachmentInfo, func(ctx context.Context, fileID string, info runp.AttachmentInfo, ttl time.Duration) error {
		return nil
	})

	router := approveRouterForUser(defaultTestRunUser())

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	fw, err := writer.CreateFormFile("file", "huge.bin")
	require.NoError(t, err)
	_, err = fw.Write(bytes.Repeat([]byte("a"), int(runp.MaxAttachmentBytes)+1024))
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	req := httptest.NewRequest(http.MethodPost, "/api/v1/attachments/upload", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
	assert.Contains(t, resp.Body.String(), "exceeds limit")
}

func TestAttachmentUpload_FinalizeReadFailure(t *testing.T) {
	swap(t, &createAttachmentTempFile, func() (attachmentTempFile, error) {
		f, err := os.CreateTemp(t.TempDir(), "attach-*.bin")
		if err != nil {
			return nil, err
		}
		if _, err := f.Write([]byte("hello")); err != nil {
			_ = f.Close()
			return nil, err
		}
		if _, err := f.Seek(0, 0); err != nil {
			_ = f.Close()
			return nil, err
		}
		return &readAllFailTempFile{File: f}, nil
	})

	router := approveRouterForUser(defaultTestRunUser())

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	fw, _ := writer.CreateFormFile("file", "note.txt")
	_, _ = fw.Write([]byte("hello"))
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/attachments/upload", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
	assert.Contains(t, resp.Body.String(), "Failed to finalize attachment")
}

func TestAttachmentUpload_MissingFilePart(t *testing.T) {
	router := approveRouterForUser(defaultTestRunUser())

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	require.NoError(t, writer.WriteField("purpose", "assistants"))
	require.NoError(t, writer.Close())

	req := httptest.NewRequest(http.MethodPost, "/api/v1/attachments/upload", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)

	assert.True(t, resp.Code == http.StatusBadRequest || resp.Code == http.StatusUnprocessableEntity)
}

func TestRequireAttachmentUploadFormData(t *testing.T) {
	_, err := handleAttachmentUploadForm(context.Background(), 1, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Missing file")

	_, err = requireAttachmentUploadFormData(nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Missing file")

	_, err = requireAttachmentUploadFormData(&attachmentUploadFormData{File: huma.FormFile{IsSet: true}})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Missing file")

	file := huma.FormFile{IsSet: true, Filename: "note.txt", File: attachmentTestFile{Reader: strings.NewReader("hello")}}
	got, err := requireAttachmentUploadFormData(&attachmentUploadFormData{File: file})
	require.NoError(t, err)
	assert.Equal(t, "note.txt", got.Filename)
}

func TestAttachmentUpload_NormalizesOfficeMimeAndStoresMetadata(t *testing.T) {
	swap(t, &runp.StoreAttachment, func(ctx context.Context, id string, data []byte, ttl time.Duration) error {
		return nil
	})
	var captured runp.AttachmentInfo
	swap(t, &runp.StoreAttachmentInfo, func(ctx context.Context, fileID string, info runp.AttachmentInfo, ttl time.Duration) error {
		captured = info
		return nil
	})

	router := approveRouterForUser(defaultTestRunUser())

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	fw, _ := writer.CreateFormFile("file", "report.docx")
	_, _ = fw.Write([]byte("PK\x03\x04\x14\x00\x06\x00"))
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/attachments/upload", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)

	const expected = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), expected)
	assert.Equal(t, expected, captured.MimeType)
	assert.Equal(t, "report.docx", captured.Name)
	assert.NotZero(t, captured.Size)
}

func TestAttachmentUpload_ReadPreviewFailure(t *testing.T) {
	swap(t, &readAttachmentPreview, func(file io.Reader, head []byte) (int, error) {
		return 0, errors.New("preview read failed")
	})

	router := approveRouterForUser(defaultTestRunUser())

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	fw, _ := writer.CreateFormFile("file", "note.txt")
	_, _ = fw.Write([]byte("hello"))
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/attachments/upload", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestAttachmentUpload_SeekFailure(t *testing.T) {
	swap(t, &createAttachmentTempFile, func() (attachmentTempFile, error) {
		f, err := os.CreateTemp(t.TempDir(), "attach-*.bin")
		if err != nil {
			return nil, err
		}
		if _, err := f.Write([]byte("hello")); err != nil {
			_ = f.Close()
			return nil, err
		}
		return &seekFailFile{File: f}, nil
	})

	router := approveRouterForUser(defaultTestRunUser())

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	fw, _ := writer.CreateFormFile("file", "note.txt")
	_, _ = fw.Write([]byte("x"))
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/attachments/upload", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
	assert.Contains(t, resp.Body.String(), "temporary store")
}

func TestAttachmentUpload_StoreAttachmentFailure(t *testing.T) {
	swap(t, &runp.StoreAttachment, func(ctx context.Context, id string, data []byte, ttl time.Duration) error {
		return errors.New("redis down")
	})

	router := approveRouterForUser(defaultTestRunUser())

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	fw, _ := writer.CreateFormFile("file", "note.txt")
	_, _ = fw.Write([]byte("hello"))
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/attachments/upload", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
	assert.Contains(t, resp.Body.String(), "Failed to store attachment in Redis")
}

func TestAttachmentUpload_StoreMetadataFailure(t *testing.T) {
	swap(t, &runp.StoreAttachment, func(ctx context.Context, id string, data []byte, ttl time.Duration) error {
		return nil
	})
	swap(t, &runp.StoreAttachmentInfo, func(ctx context.Context, fileID string, info runp.AttachmentInfo, ttl time.Duration) error {
		return errors.New("metadata store failed")
	})

	router := approveRouterForUser(defaultTestRunUser())

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	fw, _ := writer.CreateFormFile("file", "note.txt")
	_, _ = fw.Write([]byte("hello"))
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/attachments/upload", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
	assert.Contains(t, resp.Body.String(), "Failed to store attachment metadata")
}

func TestAttachmentUpload_StreamToDiskFailure(t *testing.T) {
	swap(t, &copyAttachmentToTemp, func(dst io.Writer, src io.Reader, maxBytes int64) (int64, error) {
		return 0, errors.New("copy failed")
	})

	router := approveRouterForUser(defaultTestRunUser())

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	fw, _ := writer.CreateFormFile("file", "note.txt")
	_, _ = fw.Write([]byte("hello world"))
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/attachments/upload", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
	assert.Contains(t, resp.Body.String(), "stream attachment")
}

func TestAttachmentUpload_Success(t *testing.T) {
	// Mock StoreAttachment since we dont have redis
	swap(t, &runp.StoreAttachment, func(ctx context.Context, id string, data []byte, ttl time.Duration) error {
		return nil
	})
	swap(t, &runp.StoreAttachmentInfo, func(ctx context.Context, fileID string, info runp.AttachmentInfo, ttl time.Duration) error {
		return nil
	})

	router := approveRouterForUser(defaultTestRunUser())

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	fw, _ := writer.CreateFormFile("file", "test.png")
	_, _ = fw.Write([]byte("\x89PNG\r\n\x1a\n")) // PNG magic
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/attachments/upload", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), "image/png")
}

func TestAttachmentUpload_VideoExceedsLimit(t *testing.T) {
	swap(t, &readAttachmentPreview, func(file io.Reader, head []byte) (int, error) {
		copy(head, []byte{0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70})
		return 8, nil
	})
	swap(t, &copyAttachmentToTemp, func(dst io.Writer, src io.Reader, maxBytes int64) (int64, error) {
		return int64(runp.MaxVideoBytes), nil
	})

	router := approveRouterForUser(defaultTestRunUser())

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	fw, _ := writer.CreateFormFile("file", "clip.mp4")
	_, _ = fw.Write([]byte("video-bytes"))
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/attachments/upload", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
	assert.Contains(t, resp.Body.String(), "exceeds limit")
}

func TestAttachmentUpload_WriteHeadFailure(t *testing.T) {
	swap(t, &createAttachmentTempFile, func() (attachmentTempFile, error) {
		f, err := os.CreateTemp(t.TempDir(), "attach-*.bin")
		if err != nil {
			return nil, err
		}
		return &writeHeadFailFile{File: f}, nil
	})

	router := approveRouterForUser(defaultTestRunUser())

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	fw, _ := writer.CreateFormFile("file", "note.txt")
	_, _ = fw.Write([]byte("hello"))
	_ = writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/attachments/upload", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp := serve(router, req)
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestDetectTaskSourceVariants(t *testing.T) {
	assert.Equal(t, "cli", detectTaskSource("taskforceai-cli/1.0"))
	assert.Equal(t, "desktop", detectTaskSource("TaskForceAI-Desktop/2.0"))
	assert.Equal(t, "mobile", detectTaskSource("TaskForceAI-Mobile/3.0"))
	assert.Equal(t, "web", detectTaskSource("Mozilla/5.0"))
}

func TestRunResponseFromTaskStateIncludesOptionalFields(t *testing.T) {
	state := &runp.TaskState{
		TaskID:         "task-response",
		Status:         runp.StatusCompleted,
		Result:         "done",
		ConversationID: 42,
		TraceID:        "trace-1",
	}

	resp := runResponseFromTaskState(state)

	require.NotNil(t, resp.Result)
	assert.Equal(t, "done", *resp.Result)
	require.NotNil(t, resp.ConversationID)
	assert.Equal(t, int32(42), *resp.ConversationID)
	assert.Equal(t, "trace-1", resp.TraceID)
}

func TestPulseHandler_InngestError(t *testing.T) {
	q := new(runQueriesMock)
	q.On("GetAgent", mock.Anything, "agent-1").Return(AgentRow{
		ID:     "agent-1",
		UserID: 44,
	}, nil)

	ing := new(inngestSenderMock)
	ing.On("Send", mock.Anything, mock.Anything).Return("", errors.New("inngest down"))

	user := &auth.AuthenticatedUser{ID: 44}
	router := setupRunRouter(q, ing, user, 0)

	body := `{"agentId":"agent-1","reason":"test","ts":12345}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/run/pulse", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
	q.AssertExpectations(t)
}

func TestPulseHandler_Success(t *testing.T) {
	q := new(runQueriesMock)
	q.On("GetAgent", mock.Anything, "agent-1").Return(AgentRow{
		ID:     "agent-1",
		UserID: 44,
	}, nil)

	ing := new(inngestSenderMock)
	ing.On("Send", mock.Anything, mock.MatchedBy(func(evt inngestgo.GenericEvent[map[string]any]) bool {
		return evt.Name == "agent.pulse"
	})).Return("pulse-id", nil)

	user := &auth.AuthenticatedUser{ID: 44}
	router := setupRunRouter(q, ing, user, 0)

	body := `{"agentId":"agent-1","reason":"test","ts":12345}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/run/pulse", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), "pulse queued")
	q.AssertExpectations(t)
	ing.AssertExpectations(t)
}

func TestPulseHandler_UnauthorizedAgent(t *testing.T) {
	q := new(runQueriesMock)
	q.On("GetAgent", mock.Anything, "agent-1").Return(AgentRow{
		ID:     "agent-1",
		UserID: 99,
	}, nil)

	ing := new(inngestSenderMock)
	user := &auth.AuthenticatedUser{ID: 44}
	router := setupRunRouter(q, ing, user, 0)

	body := `{"agentId":"agent-1","reason":"test","ts":12345}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/run/pulse", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusForbidden, resp.Code)
	ing.AssertNotCalled(t, "Send", mock.Anything, mock.Anything)
	q.AssertExpectations(t)
}

func TestReadBoolOption(t *testing.T) {
	v, ok := taskruntime.ReadBoolOption(map[string]any{"k": true}, "k")
	assert.True(t, v)
	assert.True(t, ok)

	v, ok = taskruntime.ReadBoolOption(map[string]any{"k": "notbool"}, "k")
	assert.False(t, v)
	assert.False(t, ok)

	v, ok = taskruntime.ReadBoolOption(nil, "k")
	assert.False(t, v)
	assert.False(t, ok)
}

func TestReadStringOption(t *testing.T) {
	assert.Equal(t, "val", taskruntime.ReadStringOption(map[string]any{"k": "val"}, "k"))
	assert.Empty(t, taskruntime.ReadStringOption(map[string]any{"k": 123}, "k"))
	assert.Empty(t, taskruntime.ReadStringOption(nil, "k"))
}

func TestRegisterPulseHandler_AgentLookupFailure(t *testing.T) {
	q := &runQueriesMock{}
	q.On("GetAgent", mock.Anything, "agent-pulse").Return(AgentRow{}, errors.New("db unavailable"))
	router := setupRunRouter(q, new(inngestSenderMock), &auth.AuthenticatedUser{ID: 44}, 0)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/run/pulse", strings.NewReader(`{"agentId":"agent-pulse","reason":"scheduled","ts":1710000000}`))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestRegisterPulseHandler_AgentNotFound(t *testing.T) {
	q := &runQueriesMock{}
	q.On("GetAgent", mock.Anything, "missing-agent").Return(AgentRow{}, pgx.ErrNoRows)
	router := setupRunRouter(q, new(inngestSenderMock), &auth.AuthenticatedUser{ID: 44}, 0)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/run/pulse", strings.NewReader(`{"agentId":"missing-agent","reason":"scheduled","ts":1710000000}`))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusNotFound, resp.Code)
}
