package run

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/auth"
	runp "github.com/TaskForceAI/go-engine/pkg/run"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

func TestTraceHandler_DecodeError(t *testing.T) {
	q := new(runQueriesMock)
	q.On("GetExecutionTrace", mock.Anything, "task-1").Return(ExecutionTraceRow{
		TaskID: "task-1",
		UserID: new(int32(44)),
		Plan:   []byte(`invalid-json`),
	}, nil)

	user := &auth.AuthenticatedUser{ID: 44}
	router := setupRunRouter(q, nil, user, 0)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/task-1/trace", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestTraceHandler_FetchFailure(t *testing.T) {
	q := new(runQueriesMock)
	q.On("GetExecutionTrace", mock.Anything, "task-1").Return(ExecutionTraceRow{}, errors.New("db unavailable"))

	user := &auth.AuthenticatedUser{ID: 44}
	router := setupRunRouter(q, nil, user, 0)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/task-1/trace", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestTraceHandler_NotFound(t *testing.T) {
	q := new(runQueriesMock)
	q.On("GetExecutionTrace", mock.Anything, "ghost").Return(ExecutionTraceRow{}, pgx.ErrNoRows)

	user := &auth.AuthenticatedUser{ID: 44}
	router := setupRunRouter(q, nil, user, 0)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/ghost/trace", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusNotFound, resp.Code)
}

func TestTraceHandler_Success(t *testing.T) {
	q := new(runQueriesMock)
	now := time.Now()
	q.On("GetExecutionTrace", mock.Anything, "task-1").Return(ExecutionTraceRow{
		ID:        "trace-1",
		TaskID:    "task-1",
		UserID:    new(int32(44)),
		Goal:      "test goal",
		CreatedAt: pgtype.Timestamp{Time: now, Valid: true},
		Plan:      []byte(`{"steps":[]}`),
	}, nil)

	user := &auth.AuthenticatedUser{ID: 44}
	router := setupRunRouter(q, nil, user, 0)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/task-1/trace", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), "trace-1")
	q.AssertExpectations(t)
}

func TestTraceHandler_Returns413WhenPayloadTooLarge(t *testing.T) {
	originalBudget := executionTracePayloadBudgetBytes
	executionTracePayloadBudgetBytes = 180
	t.Cleanup(func() { executionTracePayloadBudgetBytes = originalBudget })

	q := new(runQueriesMock)
	now := time.Now()
	q.On("GetExecutionTrace", mock.Anything, "task-1").Return(ExecutionTraceRow{
		ID:        "trace-1",
		TaskID:    "task-1",
		UserID:    new(int32(44)),
		Goal:      "test goal",
		CreatedAt: pgtype.Timestamp{Time: now, Valid: true},
		Plan:      []byte(`{"note":"` + strings.Repeat("x", 220) + `"}`),
	}, nil)

	user := &auth.AuthenticatedUser{ID: 44}
	router := setupRunRouter(q, nil, user, 0)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/task-1/trace", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusRequestEntityTooLarge, resp.Code)
}

func TestTraceHandler_Unauthorized(t *testing.T) {
	q := new(runQueriesMock)
	q.On("GetExecutionTrace", mock.Anything, "task-1").Return(ExecutionTraceRow{
		TaskID: "task-1",
		UserID: new(int32(99)),
	}, nil)

	user := &auth.AuthenticatedUser{ID: 44}
	router := setupRunRouter(q, nil, user, 0)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/task-1/trace", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestTraceHandler_UnauthorizedWhenTraceUserMissing(t *testing.T) {
	q := new(runQueriesMock)
	q.On("GetExecutionTrace", mock.Anything, "task-1").Return(ExecutionTraceRow{
		TaskID: "task-1",
		UserID: nil,
	}, nil)

	user := &auth.AuthenticatedUser{ID: 44}
	router := setupRunRouter(q, nil, user, 0)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/task-1/trace", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestCancelHandler_CancelsOwnedActiveTask(t *testing.T) {
	reg := new(taskRegistryMock)
	restore := withRunRegistry(t, reg)
	defer restore()

	active := &runp.TaskState{
		TaskID: "task-cancel",
		UserID: 44,
		Status: runp.StatusProcessing,
	}
	canceled := &runp.TaskState{
		TaskID: "task-cancel",
		UserID: 44,
		Status: runp.StatusCanceled,
		Error:  "Run canceled",
	}
	reg.On("Get", "task-cancel").Return(active).Once()
	reg.On("Update", mock.Anything, "task-cancel", runp.StatusCanceled, "", "Run canceled").Return(nil).Once()
	reg.On("Get", "task-cancel").Return(canceled).Once()

	router := setupRunRouter(new(runQueriesMock), nil, &auth.AuthenticatedUser{ID: 44}, 0)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tasks/task-cancel/cancel", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), `"status":"canceled"`)
	reg.AssertExpectations(t)
}

func TestCancelHandler_NotFound(t *testing.T) {
	reg := new(taskRegistryMock)
	restore := withRunRegistry(t, reg)
	defer restore()

	reg.On("Get", "task-missing").Return(nil).Once()

	router := setupRunRouter(new(runQueriesMock), nil, &auth.AuthenticatedUser{ID: 44}, 0)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tasks/task-missing/cancel", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusNotFound, resp.Code)
	reg.AssertExpectations(t)
}

func TestCancelHandler_ReturnsTerminalTaskWithoutUpdating(t *testing.T) {
	reg := new(taskRegistryMock)
	restore := withRunRegistry(t, reg)
	defer restore()

	reg.On("Get", "task-complete").Return(&runp.TaskState{
		TaskID:         "task-complete",
		UserID:         44,
		Status:         runp.StatusCompleted,
		Result:         "already done",
		ConversationID: 99,
		TraceID:        "trace-complete",
	}).Once()

	router := setupRunRouter(new(runQueriesMock), nil, &auth.AuthenticatedUser{ID: 44}, 0)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tasks/task-complete/cancel", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), `"status":"completed"`)
	assert.Contains(t, resp.Body.String(), `"result":"already done"`)
	assert.Contains(t, resp.Body.String(), `"conversation_id":99`)
	reg.AssertNotCalled(t, "Update", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
	reg.AssertExpectations(t)
}

func TestCancelHandler_UpdateFailure(t *testing.T) {
	reg := new(taskRegistryMock)
	restore := withRunRegistry(t, reg)
	defer restore()

	reg.On("Get", "task-update-fail").Return(&runp.TaskState{
		TaskID: "task-update-fail",
		UserID: 44,
		Status: runp.StatusProcessing,
	}).Once()
	reg.On("Update", mock.Anything, "task-update-fail", runp.StatusCanceled, "", "Run canceled").Return(errors.New("update failed")).Once()

	router := setupRunRouter(new(runQueriesMock), nil, &auth.AuthenticatedUser{ID: 44}, 0)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tasks/task-update-fail/cancel", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
	reg.AssertExpectations(t)
}

func TestCancelHandler_NotFoundAfterUpdate(t *testing.T) {
	reg := new(taskRegistryMock)
	restore := withRunRegistry(t, reg)
	defer restore()

	reg.On("Get", "task-gone").Return(&runp.TaskState{
		TaskID: "task-gone",
		UserID: 44,
		Status: runp.StatusProcessing,
	}).Once()
	reg.On("Update", mock.Anything, "task-gone", runp.StatusCanceled, "", "Run canceled").Return(nil).Once()
	reg.On("Get", "task-gone").Return(nil).Once()

	router := setupRunRouter(new(runQueriesMock), nil, &auth.AuthenticatedUser{ID: 44}, 0)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tasks/task-gone/cancel", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusNotFound, resp.Code)
	reg.AssertExpectations(t)
}

func TestCancelHandler_RejectsUnownedTask(t *testing.T) {
	reg := new(taskRegistryMock)
	restore := withRunRegistry(t, reg)
	defer restore()

	reg.On("Get", "task-other").Return(&runp.TaskState{
		TaskID: "task-other",
		UserID: 99,
		Status: runp.StatusProcessing,
	}).Once()

	router := setupRunRouter(new(runQueriesMock), nil, &auth.AuthenticatedUser{ID: 44}, 0)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tasks/task-other/cancel", nil)
	resp := serve(router, req)

	assert.Equal(t, http.StatusForbidden, resp.Code)
	reg.AssertExpectations(t)
}
