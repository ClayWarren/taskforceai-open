package cron

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"

	"github.com/TaskForceAI/go-core/internal/handlertest"
	"github.com/TaskForceAI/go-core/pkg/pulsebridge"
)

type pulseTestDB struct {
	listDueErr error
}

func (m *pulseTestDB) ListEnabledAgents(ctx context.Context) ([]pulsebridge.AgentRecord, error) {
	return nil, nil
}

func (m *pulseTestDB) ListAgentsDueForPulse(ctx context.Context) ([]pulsebridge.AgentRecord, error) {
	if m.listDueErr != nil {
		return nil, m.listDueErr
	}
	return []pulsebridge.AgentRecord{}, nil
}

func (m *pulseTestDB) ClaimAgentPulse(context.Context, pulsebridge.ClaimAgentPulseInput) (bool, error) {
	return true, nil
}

func (m *pulseTestDB) UpdateAgentPulseState(ctx context.Context, arg pulsebridge.UpdateAgentPulseStateInput) error {
	return nil
}

func (m *pulseTestDB) UpdateAgentStatus(ctx context.Context, arg pulsebridge.UpdateAgentStatusInput) error {
	return nil
}

func setupPulseRouter(provider func() (*pulsebridge.Bridge, error)) *chi.Mux {
	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	RegisterPulseHandler(api, provider)
	return r
}

func TestPulseHandler_Unauthorized(t *testing.T) {
	t.Setenv("INTERNAL_API_TOKEN", "secret-token")
	router := setupPulseRouter(func() (*pulsebridge.Bridge, error) { return nil, nil })

	handlertest.ServeStatus(t, router, http.StatusUnauthorized, http.MethodGet, "/api/v1/cron/pulse")
}

func TestPulseHandler_ReturnsOKWhenBridgeUnavailable(t *testing.T) {
	t.Setenv("INTERNAL_API_TOKEN", "secret-token")
	router := setupPulseRouter(func() (*pulsebridge.Bridge, error) { return nil, nil })

	req := httptest.NewRequest(http.MethodGet, "/api/v1/cron/pulse", nil)
	req.Header.Set("Authorization", "Bearer secret-token")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNoContent, resp.Code)
}

func TestPulseHandler_AcceptsVercelCronSecret(t *testing.T) {
	t.Setenv("CRON_SECRET", "cron-secret-token")
	router := setupPulseRouter(func() (*pulsebridge.Bridge, error) { return nil, nil })

	req := httptest.NewRequest(http.MethodGet, "/api/v1/cron/pulse", nil)
	req.Header.Set("Authorization", "Bearer cron-secret-token")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNoContent, resp.Code)
}

func TestPulseHandler_CronTickSuccess(t *testing.T) {
	t.Setenv("INTERNAL_API_TOKEN", "secret-token")
	bridge := pulsebridge.NewBridgeWithRedis(context.Background(), &pulseTestDB{}, nil, "", "")
	router := setupPulseRouter(func() (*pulsebridge.Bridge, error) { return bridge, nil })

	req := httptest.NewRequest(http.MethodGet, "/api/v1/cron/pulse", nil)
	req.Header.Set("Authorization", "Bearer secret-token")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNoContent, resp.Code)
}

func TestPulseHandler_CronTickFailure(t *testing.T) {
	t.Setenv("INTERNAL_API_TOKEN", "secret-token")
	bridge := pulsebridge.NewBridgeWithRedis(context.Background(), &pulseTestDB{listDueErr: errors.New("db down")}, nil, "", "")
	router := setupPulseRouter(func() (*pulsebridge.Bridge, error) { return bridge, nil })

	req := httptest.NewRequest(http.MethodGet, "/api/v1/cron/pulse", nil)
	req.Header.Set("Authorization", "Bearer secret-token")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestPulseHandler_BridgeProviderError(t *testing.T) {
	t.Setenv("INTERNAL_API_TOKEN", "secret-token")
	router := setupPulseRouter(func() (*pulsebridge.Bridge, error) {
		return nil, errors.New("bridge failed")
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/cron/pulse", nil)
	req.Header.Set("Authorization", "Bearer secret-token")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}
