package run

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/auth"
	runp "github.com/TaskForceAI/go-engine/pkg/run"
	"github.com/go-chi/chi/v5"
)

const defaultTestRunEmail = "test@example.com"

// swap sets *target to val for the duration of the test and restores the
// previous value on cleanup. It collapses the repeated
// `old := X; X = val; defer func() { X = old }()` idiom into one call.
func swap[T any](t *testing.T, target *T, val T) {
	t.Helper()
	old := *target
	*target = val
	t.Cleanup(func() { *target = old })
}

// restore snapshots *target now and restores it on cleanup, without changing the
// current value. Use it when the test assigns the var later (possibly in several
// steps); use swap when the new value is known up front.
func restore[T any](t *testing.T, target *T) {
	t.Helper()
	old := *target
	t.Cleanup(func() { *target = old })
}

func defaultTestRunUser() *auth.AuthenticatedUser {
	return &auth.AuthenticatedUser{ID: 44, Email: defaultTestRunEmail}
}

func withHandlerRegistry(t *testing.T, reg TaskRegistry) func() {
	t.Helper()
	old := registryGetter
	registryGetter = func() TaskRegistry { return reg }
	return func() { registryGetter = old }
}

func serve(router http.Handler, req *http.Request) *httptest.ResponseRecorder {
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	return resp
}

func postRunJSON(router http.Handler, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/run", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func postPulseJSON(router http.Handler, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/run/pulse", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func withRunRegistry(t *testing.T, reg runp.TaskRegistrar) func() {
	t.Helper()
	old := runp.GetRegistry()
	runp.SetRegistry(reg)
	return func() { runp.SetRegistry(old) }
}

func approveRouterForUser(user *auth.AuthenticatedUser) *chi.Mux {
	return setupRunRouter(nil, nil, user, 0)
}

func approveRouterForUserWithAuthMethod(user *auth.AuthenticatedUser, authMethod string) *chi.Mux {
	return setupRunRouterWithAuthMethod(nil, nil, user, 0, authMethod)
}

func postTaskApprove(router http.Handler, taskID, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tasks/"+taskID+"/approve", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func awaitingApprovalState(taskID string, userID int) *runp.TaskState {
	return &runp.TaskState{
		TaskID: taskID,
		UserID: userID,
		Status: runp.StatusAwaiting,
		PendingApproval: &runp.PendingApproval{
			Permission: "fs.write",
			AgentName:  "agent-1",
		},
	}
}
