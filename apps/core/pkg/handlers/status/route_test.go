package status

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/TaskForceAI/core/pkg/platform"
	"github.com/TaskForceAI/go-core/internal/handlertest"
)

type failingStatusSource struct{}

func (failingStatusSource) ListStatusIncidents(context.Context, int) ([]platform.StatusIncidentRecord, error) {
	return nil, errors.New("database unavailable")
}

func TestStatusHandler_Success(t *testing.T) {
	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	RegisterHandlers(api, platform.NewStatusService())

	resp := handlertest.ServeStatus(t, r, http.StatusOK, http.MethodGet, "/api/v1/status")

	var body platform.StatusResponse
	err := json.Unmarshal(resp.Body.Bytes(), &body)
	require.NoError(t, err)
	assert.Equal(t, platform.ServiceStatusOperational, body.OverallStatus)
	assert.Len(t, body.Services, len(platform.ServiceOrder))
}

func TestStatusHandler_SourceFailureIsNotAllGreen(t *testing.T) {
	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	RegisterHandlers(api, platform.NewStatusServiceWithSource(failingStatusSource{}))

	handlertest.ServeStatus(t, r, http.StatusInternalServerError, http.MethodGet, "/api/v1/status")
}
