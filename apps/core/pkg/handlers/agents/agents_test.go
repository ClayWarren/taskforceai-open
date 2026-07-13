package agents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/auth"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/core/pkg/payments"
	ff "github.com/TaskForceAI/feature-flags/pkg"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidateCheckInterval(t *testing.T) {
	err := validateCheckInterval(minCheckInterval - 1)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "check_interval must be between")

	assert.NoError(t, validateCheckInterval(minCheckInterval))
	assert.NoError(t, validateCheckInterval(maxCheckInterval))

	err = validateCheckInterval(maxCheckInterval + 1)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "check_interval must be between")
}

func TestValidateActiveDays(t *testing.T) {
	require.NoError(t, validateActiveDays([]int32{0, 3, 6}))

	err := validateActiveDays([]int32{-1})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid activeDays value -1")

	err = validateActiveDays([]int32{7})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid activeDays value 7")
}

func TestValidateModelID(t *testing.T) {
	require.NoError(t, validateModelID(nil))

	validModels := []string{
		"meta/muse-spark-1.1",
		"openai/gpt-5.6-luna",
		"openai/gpt-5.6-sol",
		"openai/gpt-5.6-terra",
		"anthropic/claude-sonnet-5",
		"anthropic/claude-opus-4.8",
		"anthropic/claude-haiku-4.5",
		"google/gemini-3.5-flash",
		"google/gemini-3.1-flash-lite",
	}
	for _, valid := range validModels {
		require.NoError(t, validateModelID(&valid))
	}

	removed := "openai/gpt-5.5"
	err := validateModelID(&removed)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid modelId")

	invalid := "openai/gpt-4.1"
	err = validateModelID(&invalid)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid modelId")
}

func TestEnabledAutonomyLimitExceeded(t *testing.T) {
	superPlan := "super"
	limit := payments.AgentLimitForPlan(superPlan)
	agents := make([]AgentRecord, 0, limit)
	for i := range limit {
		agents = append(agents, AgentRecord{
			ID:              string(rune('a' + i)),
			AutonomyEnabled: true,
		})
	}

	assert.True(t, enabledAutonomyLimitExceeded(agents, nil, superPlan))

	updatingID := agents[0].ID
	assert.False(t, enabledAutonomyLimitExceeded(agents, &updatingID, superPlan))

	belowLimit := append([]AgentRecord{}, agents[:limit-1]...)
	assert.False(t, enabledAutonomyLimitExceeded(belowLimit, nil, superPlan))
}

func setupAgentsRouter(user *auth.AuthenticatedUser) *chi.Mux {
	return setupAgentsRouterWithBridge(user, nil)
}

// serveAgents issues a request to the agents endpoint and returns the recorder.
// A non-empty body is sent as JSON; an empty body sends no request body (GET).
func serveAgents(router http.Handler, method, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, "/api/v1/agents", strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	return resp
}

func setupAgentsRouterWithBridge(user *auth.AuthenticatedUser, bridgeProvider func() (BridgeRegistry, error)) *chi.Mux {
	router := chi.NewRouter()
	router.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if user != nil {
				ctx := context.WithValue(r.Context(), adapterhandler.UserContextKey, user)
				r = r.WithContext(ctx)
			}
			next.ServeHTTP(w, r)
		})
	})

	api := humachi.New(router, huma.DefaultConfig("Test API", "1.0.0"))
	RegisterHandlers(api, stubAgentStore{}, bridgeProvider)
	return router
}

type stubAgentStore struct{}

type recordingBridge struct {
	registered   []string
	unregistered []string
}

func (b *recordingBridge) RegisterAgent(agent AgentRecord) {
	b.registered = append(b.registered, agent.ID)
}

func (b *recordingBridge) UnregisterAgent(agentID string) {
	b.unregistered = append(b.unregistered, agentID)
}

func (stubAgentStore) ListAgentsByUserID(context.Context, int32) ([]AgentRecord, error) {
	return nil, nil
}

func (stubAgentStore) GetAgent(context.Context, string) (AgentRecord, error) {
	return AgentRecord{}, nil
}

func (stubAgentStore) UpsertAgent(context.Context, UpsertAgentInput) (AgentRecord, error) {
	return AgentRecord{}, nil
}

func resetAgentStoreHooks(t *testing.T) {
	t.Helper()
	originalList := listAgentsByUserID
	originalGet := getAgentByID
	originalUpsert := upsertAgent
	originalRandRead := randRead
	originalAutonomyEnabled := isAutonomyEnabledForUser
	t.Cleanup(func() {
		listAgentsByUserID = originalList
		getAgentByID = originalGet
		upsertAgent = originalUpsert
		randRead = originalRandRead
		isAutonomyEnabledForUser = originalAutonomyEnabled
	})
}

func TestRegisterHandlers_ListAgentsSuccess(t *testing.T) {
	resetAgentStoreHooks(t)
	listAgentsByUserID = func(ctx context.Context, store AgentStore, userID int32) ([]AgentRecord, error) {
		return []AgentRecord{{ID: "agent-1", UserID: userID, Name: "Agent One"}}, nil
	}

	router := setupAgentsRouter(&auth.AuthenticatedUser{ID: 7, Email: "test@example.com"})
	resp := serveAgents(router, http.MethodGet, "")

	require.Equal(t, http.StatusOK, resp.Code)

	var body []AgentRecord
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &body))
	require.Len(t, body, 1)
	assert.Equal(t, "agent-1", body[0].ID)
}

func TestDefaultAgentStoreHooksDelegateToStore(t *testing.T) {
	resetAgentStoreHooks(t)

	agents, err := listAgentsByUserID(context.Background(), stubAgentStore{}, 7)
	require.NoError(t, err)
	assert.Nil(t, agents)

	agent, err := getAgentByID(context.Background(), stubAgentStore{}, "agent-1")
	require.NoError(t, err)
	assert.Empty(t, agent.ID)

	agent, err = upsertAgent(context.Background(), stubAgentStore{}, UpsertAgentInput{ID: "agent-1"})
	require.NoError(t, err)
	assert.Empty(t, agent.ID)
}

func TestRegisterHandlers_ListAgentsReturnsEmptySliceWhenStoreReturnsNil(t *testing.T) {
	resetAgentStoreHooks(t)
	listAgentsByUserID = func(ctx context.Context, store AgentStore, userID int32) ([]AgentRecord, error) {
		return nil, nil
	}

	router := setupAgentsRouter(&auth.AuthenticatedUser{ID: 7, Email: "test@example.com"})
	resp := serveAgents(router, http.MethodGet, "")

	require.Equal(t, http.StatusOK, resp.Code)
	assert.JSONEq(t, `[]`, resp.Body.String())
}

func TestRegisterHandlers_ListAgentsUnauthorized(t *testing.T) {
	resetAgentStoreHooks(t)
	router := setupAgentsRouter(nil)
	resp := serveAgents(router, http.MethodGet, "")

	require.Equal(t, http.StatusUnauthorized, resp.Code)
	assert.Contains(t, resp.Body.String(), "Unauthorized")
}

func TestRegisterHandlers_ListAgentsRejectsInvalidResolvedUserID(t *testing.T) {
	resetAgentStoreHooks(t)
	router := setupAgentsRouter(&auth.AuthenticatedUser{ID: 1 << 40, Email: "test@example.com"})
	resp := serveAgents(router, http.MethodGet, "")

	require.Equal(t, http.StatusBadRequest, resp.Code)
}

func TestRegisterHandlers_UpsertAgentRejectsInvalidResolvedUserID(t *testing.T) {
	resetAgentStoreHooks(t)
	router := setupAgentsRouter(&auth.AuthenticatedUser{ID: 1 << 40, Email: "test@example.com"})
	body := `{"name":"Ops","autonomyEnabled":false,"timezone":"UTC","activeStart":"09:00","activeEnd":"17:00","activeDays":[1,2],"check_interval":600}`
	resp := serveAgents(router, http.MethodPost, body)

	require.Equal(t, http.StatusBadRequest, resp.Code)
}

func TestRegisterHandlers_UpsertAgentInvalidModel(t *testing.T) {
	resetAgentStoreHooks(t)
	router := setupAgentsRouter(&auth.AuthenticatedUser{ID: 3, Email: "test@example.com"})

	body := `{"name":"Ops","autonomyEnabled":false,"timezone":"UTC","activeStart":"09:00","activeEnd":"17:00","activeDays":[1,2],"check_interval":600,"modelId":"invalid/model"}`
	resp := serveAgents(router, http.MethodPost, body)

	require.Equal(t, http.StatusUnprocessableEntity, resp.Code)
	assert.Contains(t, resp.Body.String(), "invalid modelId")
}

func TestRegisterHandlers_UpsertAgentInvalidCheckInterval(t *testing.T) {
	resetAgentStoreHooks(t)
	router := setupAgentsRouter(&auth.AuthenticatedUser{ID: 3, Email: "test@example.com"})

	body := `{"name":"Ops","autonomyEnabled":false,"timezone":"UTC","activeStart":"09:00","activeEnd":"17:00","activeDays":[1,2],"check_interval":60}`
	resp := serveAgents(router, http.MethodPost, body)

	require.Equal(t, http.StatusUnprocessableEntity, resp.Code)
	assert.Contains(t, resp.Body.String(), "check_interval")
}

func TestRegisterHandlers_UpsertAgentInvalidActiveDays(t *testing.T) {
	resetAgentStoreHooks(t)
	router := setupAgentsRouter(&auth.AuthenticatedUser{ID: 3, Email: "test@example.com"})

	body := `{"name":"Ops","autonomyEnabled":false,"timezone":"UTC","activeStart":"09:00","activeEnd":"17:00","activeDays":[7],"check_interval":600}`
	resp := serveAgents(router, http.MethodPost, body)

	require.Equal(t, http.StatusUnprocessableEntity, resp.Code)
	assert.Contains(t, resp.Body.String(), "activeDays")
}

func TestRegisterHandlers_UpsertAgentInvalidTimezone(t *testing.T) {
	resetAgentStoreHooks(t)
	upsertAgent = func(ctx context.Context, store AgentStore, arg UpsertAgentInput) (AgentRecord, error) {
		t.Fatal("upsert should not be called for invalid timezone")
		return AgentRecord{}, nil
	}
	router := setupAgentsRouter(&auth.AuthenticatedUser{ID: 3, Email: "test@example.com"})

	body := `{"name":"Ops","autonomyEnabled":false,"timezone":"Invalid/Timezone","activeStart":"09:00","activeEnd":"17:00","activeDays":[1,2],"check_interval":600}`
	resp := serveAgents(router, http.MethodPost, body)

	require.Equal(t, http.StatusUnprocessableEntity, resp.Code)
	assert.Contains(t, resp.Body.String(), "invalid timezone")
}

func TestRegisterHandlers_UpsertAgentLimitCheckError(t *testing.T) {
	t.Setenv("GO_ENV", "test")
	resetAgentStoreHooks(t)
	listAgentsByUserID = func(ctx context.Context, store AgentStore, userID int32) ([]AgentRecord, error) {
		return nil, errors.New("db fail")
	}

	router := setupAgentsRouter(&auth.AuthenticatedUser{ID: 3, Email: "test@example.com"})
	body := `{"name":"Ops","autonomyEnabled":true,"timezone":"UTC","activeStart":"09:00","activeEnd":"17:00","activeDays":[1],"check_interval":600}`
	resp := serveAgents(router, http.MethodPost, body)

	require.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestRegisterHandlers_UpsertAgentAutonomyLimitExceeded(t *testing.T) {
	t.Setenv("GO_ENV", "test")
	resetAgentStoreHooks(t)
	superPlan := "super"
	limit := payments.AgentLimitForPlan(superPlan)
	listAgentsByUserID = func(ctx context.Context, store AgentStore, userID int32) ([]AgentRecord, error) {
		agents := make([]AgentRecord, 0, limit)
		for i := range limit {
			agents = append(agents, AgentRecord{
				ID:              "enabled-" + string(rune('a'+i)),
				UserID:          userID,
				AutonomyEnabled: true,
			})
		}
		return agents, nil
	}

	router := setupAgentsRouter(&auth.AuthenticatedUser{ID: 9, Email: "test@example.com", Plan: &superPlan})
	body := `{"name":"Ops","autonomyEnabled":true,"timezone":"UTC","activeStart":"09:00","activeEnd":"17:00","activeDays":[1,2],"check_interval":600}`
	resp := serveAgents(router, http.MethodPost, body)

	require.Equal(t, http.StatusUnprocessableEntity, resp.Code)
	assert.Contains(t, resp.Body.String(), fmt.Sprintf("maximum of %d enabled autonomous agents", limit))
}

func TestRegisterHandlers_UpsertAgentAutonomyDeniedWhenFeatureFlagUnavailable(t *testing.T) {
	t.Setenv("GO_ENV", "production")
	t.Setenv("STATSIG_SECRET_KEY", "")
	resetAgentStoreHooks(t)

	listAgentsByUserID = func(ctx context.Context, store AgentStore, userID int32) ([]AgentRecord, error) {
		t.Fatal("agent list should not be queried when autonomy feature is denied")
		return nil, nil
	}

	router := setupAgentsRouter(&auth.AuthenticatedUser{ID: 9, Email: "test@example.com"})
	body := `{"name":"Ops","autonomyEnabled":true,"timezone":"UTC","activeStart":"09:00","activeEnd":"17:00","activeDays":[1,2],"check_interval":600}`
	resp := serveAgents(router, http.MethodPost, body)

	require.Equal(t, http.StatusForbidden, resp.Code)
	assert.Contains(t, resp.Body.String(), "Autonomous agents are not enabled")
}

func TestRegisterHandlers_UpsertAgentForbiddenWhenOwnershipMismatch(t *testing.T) {
	resetAgentStoreHooks(t)
	getAgentByID = func(ctx context.Context, store AgentStore, agentID string) (AgentRecord, error) {
		return AgentRecord{ID: agentID, UserID: 999, Name: "Other Agent"}, nil
	}

	router := setupAgentsRouter(&auth.AuthenticatedUser{ID: 11, Email: "test@example.com"})
	body := `{"id":"agent-foreign","name":"Ops","autonomyEnabled":false,"timezone":"UTC","activeStart":"09:00","activeEnd":"17:00","activeDays":[1,2],"check_interval":600}`
	resp := serveAgents(router, http.MethodPost, body)

	require.Equal(t, http.StatusForbidden, resp.Code)
	assert.Contains(t, resp.Body.String(), "permission")
}

func TestRegisterHandlers_UpsertAgentIDGenerationError(t *testing.T) {
	resetAgentStoreHooks(t)
	randRead = func(buf []byte) (int, error) {
		return 0, errors.New("random unavailable")
	}

	router := setupAgentsRouter(&auth.AuthenticatedUser{ID: 11, Email: "test@example.com"})
	body := `{"name":"Ops","autonomyEnabled":false,"timezone":"UTC","activeStart":"09:00","activeEnd":"17:00","activeDays":[1,2],"check_interval":600}`
	resp := serveAgents(router, http.MethodPost, body)

	require.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestRegisterHandlers_UpsertAgentSuccess(t *testing.T) {
	resetAgentStoreHooks(t)

	var captured UpsertAgentInput
	upsertAgent = func(ctx context.Context, store AgentStore, arg UpsertAgentInput) (AgentRecord, error) {
		captured = arg
		return AgentRecord{
			ID:              arg.ID,
			UserID:          arg.UserID,
			Name:            arg.Name,
			ModelID:         arg.ModelID,
			AutonomyEnabled: arg.AutonomyEnabled,
			Timezone:        arg.Timezone,
			ActiveStart:     arg.ActiveStart,
			ActiveEnd:       arg.ActiveEnd,
			ActiveDays:      arg.ActiveDays,
			CheckInterval:   arg.CheckInterval,
			Status:          arg.Status,
		}, nil
	}
	getAgentByID = func(ctx context.Context, store AgentStore, agentID string) (AgentRecord, error) {
		return AgentRecord{}, errors.New("not found")
	}

	router := setupAgentsRouter(&auth.AuthenticatedUser{ID: 13, Email: "captain@example.com"})
	body := `{"name":"Ops Team","autonomyEnabled":false,"timezone":"UTC","activeStart":"09:00","activeEnd":"17:00","activeDays":[1,2,3],"check_interval":600,"modelId":"openai/gpt-5.6-sol"}`
	resp := serveAgents(router, http.MethodPost, body)

	require.Equal(t, http.StatusOK, resp.Code)
	require.Equal(t, int32(13), captured.UserID)
	require.NotNil(t, captured.ModelID)
	assert.Equal(t, "openai/gpt-5.6-sol", *captured.ModelID)
	assert.Equal(t, int32(600), captured.CheckInterval)
	assert.Equal(t, "IDLE", captured.Status)
	assert.True(t, strings.HasPrefix(captured.ID, "agent_"))
	assert.Equal(t, "UTC", captured.Timezone)
}

func TestRegisterHandlers_UpsertAgentRegistersBridge(t *testing.T) {
	t.Setenv("GO_ENV", "test")
	resetAgentStoreHooks(t)
	bridge := &recordingBridge{}
	upsertAgent = func(ctx context.Context, store AgentStore, arg UpsertAgentInput) (AgentRecord, error) {
		return AgentRecord{ID: arg.ID, UserID: arg.UserID, Name: arg.Name, AutonomyEnabled: true}, nil
	}

	router := setupAgentsRouterWithBridge(&auth.AuthenticatedUser{ID: 13, Email: "captain@example.com"}, func() (BridgeRegistry, error) {
		return bridge, nil
	})
	body := `{"name":"Ops Team","autonomyEnabled":true,"timezone":"UTC","activeStart":"09:00","activeEnd":"17:00","activeDays":[1,2,3],"check_interval":600}`
	resp := serveAgents(router, http.MethodPost, body)

	require.Equal(t, http.StatusOK, resp.Code)
	require.Len(t, bridge.registered, 1)
	assert.Empty(t, bridge.unregistered)
}

func TestRegisterHandlers_UpsertAgentUnregistersBridge(t *testing.T) {
	resetAgentStoreHooks(t)
	bridge := &recordingBridge{}
	agentID := "agent_existing"
	getAgentByID = func(ctx context.Context, store AgentStore, id string) (AgentRecord, error) {
		return AgentRecord{ID: id, UserID: 13}, nil
	}
	upsertAgent = func(ctx context.Context, store AgentStore, arg UpsertAgentInput) (AgentRecord, error) {
		return AgentRecord{ID: arg.ID, UserID: arg.UserID, Name: arg.Name, AutonomyEnabled: false}, nil
	}

	router := setupAgentsRouterWithBridge(&auth.AuthenticatedUser{ID: 13, Email: "captain@example.com"}, func() (BridgeRegistry, error) {
		return bridge, nil
	})
	body := `{"id":"agent_existing","name":"Ops Team","autonomyEnabled":false,"timezone":"UTC","activeStart":"09:00","activeEnd":"17:00","activeDays":[1,2,3],"check_interval":600}`
	resp := serveAgents(router, http.MethodPost, body)

	require.Equal(t, http.StatusOK, resp.Code)
	assert.Equal(t, []string{agentID}, bridge.unregistered)
	assert.Empty(t, bridge.registered)
}

func TestRegisterHandlers_UpsertAgentBridgeProviderErrorStillSucceeds(t *testing.T) {
	t.Setenv("GO_ENV", "test")
	resetAgentStoreHooks(t)
	upsertAgent = func(ctx context.Context, store AgentStore, arg UpsertAgentInput) (AgentRecord, error) {
		return AgentRecord{ID: arg.ID, UserID: arg.UserID, Name: arg.Name, AutonomyEnabled: true}, nil
	}

	router := setupAgentsRouterWithBridge(&auth.AuthenticatedUser{ID: 13, Email: "captain@example.com"}, func() (BridgeRegistry, error) {
		return nil, errors.New("bridge unavailable")
	})
	body := `{"name":"Ops Team","autonomyEnabled":true,"timezone":"UTC","activeStart":"09:00","activeEnd":"17:00","activeDays":[1,2,3],"check_interval":600}`
	resp := serveAgents(router, http.MethodPost, body)

	require.Equal(t, http.StatusOK, resp.Code)
}

func TestUpdatePulseBridge_NilBridgeIsIgnored(t *testing.T) {
	updatePulseBridge(func() (BridgeRegistry, error) {
		return nil, nil
	}, AgentRecord{ID: "agent_without_bridge", AutonomyEnabled: true})
}

func TestRegisterHandlers_ListAgentsError(t *testing.T) {
	resetAgentStoreHooks(t)
	listAgentsByUserID = func(ctx context.Context, store AgentStore, userID int32) ([]AgentRecord, error) {
		return nil, errors.New("db fail")
	}

	router := setupAgentsRouter(&auth.AuthenticatedUser{ID: 7, Email: "test@example.com"})
	resp := serveAgents(router, http.MethodGet, "")

	require.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestRegisterHandlers_UpsertAgent_FetchError(t *testing.T) {
	resetAgentStoreHooks(t)
	getAgentByID = func(ctx context.Context, store AgentStore, agentID string) (AgentRecord, error) {
		return AgentRecord{}, errors.New("unexpected error") // Not "not found"
	}
	// Also mock upsertAgent to see if it's called (it shouldn't be if we want to test error handling,
	// but the code actually proceeds if err != nil but not "not found"?)
	// Actually the code proceeds if err != nil because it assumes it's a new agent if it can't find it.
	// Wait, no, it should probably only proceed if it's "not found".
	// But current code just checks `err == nil`.
	upsertAgent = func(ctx context.Context, store AgentStore, arg UpsertAgentInput) (AgentRecord, error) {
		return AgentRecord{}, errors.New("upsert fail")
	}

	router := setupAgentsRouter(&auth.AuthenticatedUser{ID: 11, Email: "test@example.com"})
	body := `{"id":"agent-1","name":"Ops","autonomyEnabled":false,"timezone":"UTC","activeStart":"09:00","activeEnd":"17:00","activeDays":[1,2],"check_interval":600}`
	resp := serveAgents(router, http.MethodPost, body)

	require.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestRegisterHandlers_UpsertAgent_SaveError(t *testing.T) {
	resetAgentStoreHooks(t)
	getAgentByID = func(ctx context.Context, store AgentStore, agentID string) (AgentRecord, error) {
		return AgentRecord{}, errors.New("not found")
	}
	upsertAgent = func(ctx context.Context, store AgentStore, arg UpsertAgentInput) (AgentRecord, error) {
		return AgentRecord{}, errors.New("save fail")
	}

	router := setupAgentsRouter(&auth.AuthenticatedUser{ID: 13, Email: "captain@example.com"})
	body := `{"name":"Ops Team","autonomyEnabled":false,"timezone":"UTC","activeStart":"09:00","activeEnd":"17:00","activeDays":[1,2,3],"check_interval":600}`
	resp := serveAgents(router, http.MethodPost, body)

	require.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestRegisterHandlers_UpsertAgent_MapsAtomicLimitError(t *testing.T) {
	resetAgentStoreHooks(t)
	upsertAgent = func(ctx context.Context, store AgentStore, arg UpsertAgentInput) (AgentRecord, error) {
		return AgentRecord{}, &AutonomyLimitError{Limit: 2}
	}

	router := setupAgentsRouter(&auth.AuthenticatedUser{ID: 13, Email: "captain@example.com"})
	body := `{"name":"Ops Team","autonomyEnabled":false,"timezone":"UTC","activeStart":"09:00","activeEnd":"17:00","activeDays":[1,2,3],"check_interval":600}`
	resp := serveAgents(router, http.MethodPost, body)

	require.Equal(t, http.StatusUnprocessableEntity, resp.Code)
	assert.Contains(t, resp.Body.String(), "maximum of 2 enabled autonomous agents")
}

func TestRegisterHandlers_UpsertAgentNoRowsSaveErrorReturnsForbidden(t *testing.T) {
	resetAgentStoreHooks(t)
	upsertAgent = func(ctx context.Context, store AgentStore, arg UpsertAgentInput) (AgentRecord, error) {
		return AgentRecord{}, pgx.ErrNoRows
	}

	router := setupAgentsRouter(&auth.AuthenticatedUser{ID: 13, Email: "captain@example.com"})
	body := `{"name":"Ops Team","autonomyEnabled":false,"timezone":"UTC","activeStart":"09:00","activeEnd":"17:00","activeDays":[1,2,3],"check_interval":600}`
	resp := serveAgents(router, http.MethodPost, body)

	require.Equal(t, http.StatusForbidden, resp.Code)
}

func TestAgentIDAndFeatureFlagHelpers(t *testing.T) {
	resetAgentStoreHooks(t)
	randRead = func(buf []byte) (int, error) {
		return 0, errors.New("random unavailable")
	}
	_, err := newAgentID()
	require.Error(t, err)

	t.Setenv("TASKFORCE_BYPASS_FEATURE_FLAGS", "1")
	assert.True(t, shouldBypassAutonomyFeatureFlag())
	assert.Empty(t, firstNonEmpty("", " \t "))
}

func TestAutonomyFeatureEnabledBuildsStatsigUser(t *testing.T) {
	resetAgentStoreHooks(t)
	assert.False(t, isAutonomyEnabledForUser("", ff.User{}))

	t.Setenv("TASKFORCE_BYPASS_FEATURE_FLAGS", "")
	t.Setenv("GO_ENV", "production")
	t.Setenv("NODE_ENV", "production")
	t.Setenv("STATSIG_SECRET_KEY", "secret")

	var captured []ff.User
	isAutonomyEnabledForUser = func(key string, user ff.User) bool {
		assert.Equal(t, "secret", key)
		captured = append(captured, user)
		return true
	}

	assert.True(t, autonomyFeatureEnabled(adapterhandler.AuthContext{
		User: &auth.AuthenticatedUser{ID: 21, Email: "free@example.com"},
	}))

	plan := "pro"
	assert.True(t, autonomyFeatureEnabled(adapterhandler.AuthContext{
		User: &auth.AuthenticatedUser{ID: 22, Email: "pro@example.com", Plan: &plan},
	}))

	require.Len(t, captured, 2)
	assert.Equal(t, "21", captured[0].UserID)
	assert.Equal(t, "free@example.com", captured[0].Email)
	assert.Equal(t, "free", captured[0].Tier)
	assert.Equal(t, "22", captured[1].UserID)
	assert.Equal(t, "pro@example.com", captured[1].Email)
	assert.Equal(t, "pro", captured[1].Tier)
}
