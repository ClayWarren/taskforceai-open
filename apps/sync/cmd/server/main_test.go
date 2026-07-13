package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/server/topology"
	"github.com/stretchr/testify/require"
)

func TestMain_OpenAPI(t *testing.T) {
	_ = t // satisfy linter
	origArgs := os.Args
	defer func() { os.Args = origArgs }()

	os.Args = []string{"sync", "--openapi"}
	main()
}

func TestBuildServerConfig(t *testing.T) {
	config := buildServerConfig()

	require.Equal(t, topology.Get(topology.Sync).ServiceName, config.ServiceName)
	require.Equal(t, topology.Get(topology.Sync).DefaultPort, config.DefaultPort)
	require.NotNil(t, config.Router)
	require.NotNil(t, config.HumaAPI)
	require.NotNil(t, config.InitTracer)
	require.NotNil(t, config.InitMeter)
	require.Len(t, config.StartupChecks, 2)
	require.Equal(t, "database", config.StartupChecks[0].Name)
	require.Equal(t, "redis", config.StartupChecks[1].Name)
	require.NotNil(t, config.StartupChecks[0].Check)
	require.NotNil(t, config.StartupChecks[1].Check)
	require.NotNil(t, config.ShutdownGroup)

	require.Error(t, config.StartupChecks[0].Check(context.Background()))
	require.Error(t, config.StartupChecks[1].Check(context.Background()))
}

func TestBuildServerConfig_EnforcesCSRFForCookieAuthenticatedWrites(t *testing.T) {
	config := buildServerConfig()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/push", strings.NewReader(`{}`))
	req.AddCookie(&http.Cookie{Name: "session_token", Value: "token"})
	w := httptest.NewRecorder()

	config.Router.ServeHTTP(w, req)

	require.Equal(t, http.StatusForbidden, w.Code)
}
