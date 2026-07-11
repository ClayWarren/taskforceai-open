package admin

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

	"github.com/TaskForceAI/adapters/pkg/auth"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/adapters/pkg/server"
)

type mockTracesQueries struct {
	getMessagesWithTracesFunc func(ctx context.Context, arg GetMessagesWithTracesInput) ([]TraceMessage, error)
}

func (m *mockTracesQueries) GetMessagesWithTraces(ctx context.Context, arg GetMessagesWithTracesInput) ([]TraceMessage, error) {
	return m.getMessagesWithTracesFunc(ctx, arg)
}

func setupTracesRouter(q TracesQueries, user *auth.AuthenticatedUser) *chi.Mux {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			if user != nil {
				ctx := context.WithValue(req.Context(), adapterhandler.UserContextKey, user)
				req = req.WithContext(ctx)
			}
			next.ServeHTTP(w, req)
		})
	})
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	RegisterTracesHandler(api, q)
	return r
}

func TestTracesHandler_ClampsLimit(t *testing.T) {
	q := &mockTracesQueries{
		getMessagesWithTracesFunc: func(_ context.Context, arg GetMessagesWithTracesInput) ([]TraceMessage, error) {
			return []TraceMessage{}, nil
		},
	}

	router := setupTracesRouter(q, &auth.AuthenticatedUser{ID: 1, IsAdmin: true})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/traces?limit=9999", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", resp.Code)
	}
}

func TestTracesHandler_RequiresAdmin(t *testing.T) {
	q := &mockTracesQueries{
		getMessagesWithTracesFunc: func(_ context.Context, _ GetMessagesWithTracesInput) ([]TraceMessage, error) {
			t.Fatal("query should not be called for non-admin user")
			return nil, nil
		},
	}

	router := setupTracesRouter(q, &auth.AuthenticatedUser{ID: 1, IsAdmin: false})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/traces", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", resp.Code)
	}
}

func TestTracesHandler_ReturnsMessages(t *testing.T) {
	q := &mockTracesQueries{
		getMessagesWithTracesFunc: func(_ context.Context, arg GetMessagesWithTracesInput) ([]TraceMessage, error) {
			if arg.Rating != 2 || arg.Limit != 25 {
				t.Fatalf("unexpected query input: %+v", arg)
			}
			return []TraceMessage{{ID: 1, Role: "assistant", Content: "hello", Rating: 2, Trace: []byte(`{"ok":true}`)}}, nil
		},
	}

	router := setupTracesRouter(q, &auth.AuthenticatedUser{ID: 1, IsAdmin: true})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/traces?min_rating=2&limit=25", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}
}

func TestTracesHandler_TrimsOversizedResponse(t *testing.T) {
	originalBudget := tracesListPayloadBudgetBytes
	tracesListPayloadBudgetBytes = 180
	t.Cleanup(func() { tracesListPayloadBudgetBytes = originalBudget })

	q := &mockTracesQueries{
		getMessagesWithTracesFunc: func(_ context.Context, _ GetMessagesWithTracesInput) ([]TraceMessage, error) {
			return []TraceMessage{
				{ID: 1, Role: "assistant", Content: "small", Rating: 1},
				{ID: 2, Role: "assistant", Content: strings.Repeat("x", 140), Rating: 1},
			}, nil
		},
	}

	router := setupTracesRouter(q, &auth.AuthenticatedUser{ID: 1, IsAdmin: true})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/traces", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}
	var body TracesListResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if !body.Truncated {
		t.Fatal("expected response to be marked truncated")
	}
	if len(body.Messages) != 1 {
		t.Fatalf("expected one message after trimming, got %d", len(body.Messages))
	}
}

func TestTracesHandler_QueryError(t *testing.T) {
	q := &mockTracesQueries{
		getMessagesWithTracesFunc: func(_ context.Context, _ GetMessagesWithTracesInput) ([]TraceMessage, error) {
			return nil, errors.New("db failed")
		},
	}

	router := setupTracesRouter(q, &auth.AuthenticatedUser{ID: 1, IsAdmin: true})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/traces", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", resp.Code)
	}
}

func TestTracesHandler_TrimPayloadTooLarge(t *testing.T) {
	originalTrim := trimTraceMessagesForBudget
	trimTraceMessagesForBudget = func(messages []TraceMessage, budgetBytes int) ([]TraceMessage, bool, int, error) {
		return nil, true, 0, server.ErrPayloadBudgetExceeded
	}
	t.Cleanup(func() { trimTraceMessagesForBudget = originalTrim })

	q := &mockTracesQueries{
		getMessagesWithTracesFunc: func(_ context.Context, _ GetMessagesWithTracesInput) ([]TraceMessage, error) {
			return []TraceMessage{{ID: 1, Role: "assistant", Content: "hello", Rating: 1}}, nil
		},
	}

	router := setupTracesRouter(q, &auth.AuthenticatedUser{ID: 1, IsAdmin: true})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/traces", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d", resp.Code)
	}
}

func TestTracesHandler_TrimGenericError(t *testing.T) {
	originalTrim := trimTraceMessagesForBudget
	trimTraceMessagesForBudget = func(messages []TraceMessage, budgetBytes int) ([]TraceMessage, bool, int, error) {
		return nil, false, 0, errors.New("trim failed")
	}
	t.Cleanup(func() { trimTraceMessagesForBudget = originalTrim })

	q := &mockTracesQueries{
		getMessagesWithTracesFunc: func(_ context.Context, _ GetMessagesWithTracesInput) ([]TraceMessage, error) {
			return []TraceMessage{{ID: 1, Role: "assistant", Content: "hello", Rating: 1}}, nil
		},
	}

	router := setupTracesRouter(q, &auth.AuthenticatedUser{ID: 1, IsAdmin: true})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/traces", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", resp.Code)
	}
}
