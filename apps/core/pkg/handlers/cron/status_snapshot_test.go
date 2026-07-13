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

	"github.com/TaskForceAI/core/pkg/platform"
)

type statusSnapshotPublisherStub struct {
	err   error
	calls int
}

func (s *statusSnapshotPublisherStub) PublishStatus(context.Context, platform.StatusResponse) error {
	s.calls++
	return s.err
}

func setupStatusSnapshotRouter(service *platform.StatusService) *chi.Mux {
	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("Test API", "1.0.0"))
	RegisterStatusSnapshotHandler(api, service)
	return router
}

func TestStatusSnapshotHandlerRejectsUnauthorizedRequests(t *testing.T) {
	t.Setenv("CRON_SECRET", "cron-secret")
	request := httptest.NewRequest(http.MethodGet, "/api/v1/cron/status-snapshot", nil)
	response := httptest.NewRecorder()

	setupStatusSnapshotRouter(platform.NewStatusService()).ServeHTTP(response, request)

	assert.Equal(t, http.StatusUnauthorized, response.Code)
}

func TestStatusSnapshotHandlerPublishes(t *testing.T) {
	t.Setenv("CRON_SECRET", "cron-secret")
	publisher := &statusSnapshotPublisherStub{}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/cron/status-snapshot", nil)
	request.Header.Set("Authorization", "Bearer cron-secret")
	response := httptest.NewRecorder()

	setupStatusSnapshotRouter(platform.NewStatusService(publisher)).ServeHTTP(response, request)

	assert.Equal(t, http.StatusNoContent, response.Code)
	assert.Equal(t, 1, publisher.calls)
}

func TestStatusSnapshotHandlerReportsUnavailableServiceAndPublishFailure(t *testing.T) {
	t.Setenv("CRON_SECRET", "cron-secret")
	request := func() *http.Request {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/cron/status-snapshot", nil)
		req.Header.Set("Authorization", "Bearer cron-secret")
		return req
	}

	unavailableResponse := httptest.NewRecorder()
	setupStatusSnapshotRouter(nil).ServeHTTP(unavailableResponse, request())
	assert.Equal(t, http.StatusServiceUnavailable, unavailableResponse.Code)

	publisher := &statusSnapshotPublisherStub{err: errors.New("blob unavailable")}
	failureResponse := httptest.NewRecorder()
	setupStatusSnapshotRouter(platform.NewStatusService(publisher)).ServeHTTP(failureResponse, request())
	assert.Equal(t, http.StatusInternalServerError, failureResponse.Code)
	assert.Equal(t, 1, publisher.calls)
}
