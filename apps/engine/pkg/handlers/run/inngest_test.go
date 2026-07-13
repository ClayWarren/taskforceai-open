package run

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	runpkg "github.com/TaskForceAI/go-engine/pkg/run"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
)

func TestInngestHandler_InvalidJSON(t *testing.T) {
	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	RegisterInngestHandler(api, nil)

	req := httptest.NewRequest(http.MethodPost, "/api/inngest", strings.NewReader("{"))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	r.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
}

func TestInngestHandler_NoOpEvent(t *testing.T) {
	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	RegisterInngestHandler(api, nil)

	body := `{"name":"noop","data":{}}`
	req := httptest.NewRequest(http.MethodPost, "/api/inngest", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	r.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestLoadMaxConcurrentInngestTasks_DefaultAndInvalid(t *testing.T) {
	t.Setenv("INNGEST_MAX_CONCURRENT_TASKS", "")
	assert.Equal(t, runpkg.DefaultMaxConcurrentTaskExecutions, runpkg.LoadMaxConcurrentTaskExecutions())

	t.Setenv("INNGEST_MAX_CONCURRENT_TASKS", "not-a-number")
	assert.Equal(t, runpkg.DefaultMaxConcurrentTaskExecutions, runpkg.LoadMaxConcurrentTaskExecutions())

	t.Setenv("INNGEST_MAX_CONCURRENT_TASKS", "-3")
	assert.Equal(t, runpkg.DefaultMaxConcurrentTaskExecutions, runpkg.LoadMaxConcurrentTaskExecutions())

	t.Setenv("INNGEST_MAX_CONCURRENT_TASKS", "12")
	assert.Equal(t, 12, runpkg.LoadMaxConcurrentTaskExecutions())
}
