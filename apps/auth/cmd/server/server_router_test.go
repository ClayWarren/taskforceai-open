package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestBuildSecureRouter_ServesPing(t *testing.T) {
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")

	router, _ := buildSecureRouter()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/ping", nil)
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	assert.Equal(t, http.StatusOK, rr.Code)
}
