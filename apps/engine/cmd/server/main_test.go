package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"

	adapterserver "github.com/TaskForceAI/adapters/pkg/server"
	redispkg "github.com/TaskForceAI/infrastructure/redis/pkg"
)

func TestBuildServerConfig(t *testing.T) {
	shutdownGroup := &sync.WaitGroup{}
	cfg := buildServerConfig(shutdownGroup)

	if cfg.ServiceName == "" {
		t.Fatal("expected service name")
	}
	if cfg.DefaultPort == "" {
		t.Fatal("expected default port")
	}
	if cfg.Router == nil || cfg.HumaAPI == nil {
		t.Fatal("expected router and Huma API")
	}
	if cfg.ShutdownGroup != shutdownGroup {
		t.Fatal("expected shutdown group to be preserved")
	}
	if cfg.StartupWaitTimeout == 0 || cfg.StartupRetryDelay == 0 || cfg.ShutdownTimeout == 0 {
		t.Fatal("expected startup and shutdown timeouts")
	}
	if cfg.WriteTimeout < adapterserver.VercelFunctionMaxDuration {
		t.Fatalf("expected write timeout to support Vercel max-duration agent streams, got %s", cfg.WriteTimeout)
	}

	checks := make(map[string]func(context.Context) error)
	for _, check := range cfg.StartupChecks {
		checks[check.Name] = check.Check
	}
	for _, name := range []string{"database", "redis", "inngest", "ai-gateway", "brave-search", "statsig"} {
		if checks[name] == nil {
			t.Fatalf("missing startup check %q", name)
		}
	}
}

func TestVercelStreamMaxDurationMatchesPlatformLimit(t *testing.T) {
	raw, err := os.ReadFile("../../vercel.json")
	if err != nil {
		t.Fatalf("read vercel config: %v", err)
	}

	var config struct {
		Builds []struct {
			Src    string `json:"src"`
			Config struct {
				MaxDuration int `json:"maxDuration"`
			} `json:"config"`
		} `json:"builds"`
	}
	if err := json.Unmarshal(raw, &config); err != nil {
		t.Fatalf("parse vercel config: %v", err)
	}

	for _, build := range config.Builds {
		if build.Src == "apps/engine/api/v1/stream.go" {
			if build.Config.MaxDuration != adapterserver.VercelFunctionMaxDurationSeconds {
				t.Fatalf("expected stream maxDuration 800, got %d", build.Config.MaxDuration)
			}
			return
		}
	}

	t.Fatal("expected stream build config")
}

func TestBuildServerConfig_EnforcesCSRFForCookieAuthenticatedWrites(t *testing.T) {
	cfg := buildServerConfig(&sync.WaitGroup{})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/run", bytes.NewBufferString(`{}`))
	req.AddCookie(&http.Cookie{Name: "session_token", Value: "token"})
	w := httptest.NewRecorder()

	cfg.Router.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected CSRF rejection before engine routing, got %d", w.Code)
	}
}

func TestMainOpenAPIOutput(t *testing.T) {
	oldArgs := os.Args
	oldStdout := os.Stdout
	defer func() {
		os.Args = oldArgs
		os.Stdout = oldStdout
	}()

	os.Args = []string{"server", "--openapi"}

	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatalf("pipe error: %v", err)
	}
	os.Stdout = writer

	bufCh := make(chan []byte, 1)
	copyErrCh := make(chan error, 1)
	go func() {
		var buf bytes.Buffer
		_, copyErr := io.Copy(&buf, reader)
		_ = reader.Close()
		bufCh <- buf.Bytes()
		copyErrCh <- copyErr
	}()

	main()

	_ = writer.Close()
	if copyErr := <-copyErrCh; copyErr != nil {
		t.Fatalf("copy error: %v", copyErr)
	}
	output := <-bufCh

	if len(output) == 0 {
		t.Fatal("expected openapi output")
	}

	var payload map[string]any
	if err := json.Unmarshal(output, &payload); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if _, ok := payload["openapi"]; !ok {
		t.Fatal("expected openapi field in output")
	}
}

func TestStartupChecks_AIGatewayDefaultURL(t *testing.T) {
	cfg := buildServerConfig(&sync.WaitGroup{})
	checks := make(map[string]func(context.Context) error)
	for _, check := range cfg.StartupChecks {
		checks[check.Name] = check.Check
	}

	t.Setenv("VERCEL_AI_GATEWAY_URL", "")
	if err := checks["ai-gateway"](context.Background()); err != nil {
		t.Fatalf("expected default ai-gateway URL to pass: %v", err)
	}
}

func TestStartupChecks_AIGatewayInvalidURL(t *testing.T) {
	cfg := buildServerConfig(&sync.WaitGroup{})
	checks := make(map[string]func(context.Context) error)
	for _, check := range cfg.StartupChecks {
		checks[check.Name] = check.Check
	}

	t.Setenv("VERCEL_AI_GATEWAY_URL", "not-a-url")
	if err := checks["ai-gateway"](context.Background()); err == nil {
		t.Fatal("expected ai-gateway startup check to fail for invalid URL")
	}
}

func TestStartupChecks_BraveSearchMissingKey(t *testing.T) {
	cfg := buildServerConfig(&sync.WaitGroup{})
	checks := make(map[string]func(context.Context) error)
	for _, check := range cfg.StartupChecks {
		checks[check.Name] = check.Check
	}

	t.Setenv("BRAVE_SEARCH_API_KEY", "")
	if err := checks["brave-search"](context.Background()); err == nil {
		t.Fatal("expected brave-search startup check to fail without API key")
	}
}

func TestStartupChecks_DatabaseUnavailable(t *testing.T) {
	cfg := buildServerConfig(&sync.WaitGroup{})
	checks := make(map[string]func(context.Context) error)
	for _, check := range cfg.StartupChecks {
		checks[check.Name] = check.Check
	}

	if err := checks["database"](context.Background()); err == nil {
		t.Fatal("expected database startup check to fail without configured pool")
	}
}

func TestStartupChecks_EnvironmentValidation(t *testing.T) {
	cfg := buildServerConfig(&sync.WaitGroup{})
	checks := make(map[string]func(context.Context) error)
	for _, check := range cfg.StartupChecks {
		checks[check.Name] = check.Check
	}

	t.Setenv("INNGEST_EVENT_KEY", "")
	t.Setenv("INNGEST_DEV", "")
	if err := checks["inngest"](context.Background()); err == nil {
		t.Fatal("expected missing Inngest key error")
	}
	t.Setenv("INNGEST_EVENT_KEY", "key")
	if err := checks["inngest"](context.Background()); err != nil {
		t.Fatalf("expected Inngest check success, got %v", err)
	}
	t.Setenv("INNGEST_EVENT_KEY", "")
	t.Setenv("INNGEST_DEV", "1")
	if err := checks["inngest"](context.Background()); err != nil {
		t.Fatalf("expected Inngest dev mode success, got %v", err)
	}

	t.Setenv("VERCEL_AI_GATEWAY_URL", "not-a-url")
	if err := checks["ai-gateway"](context.Background()); err == nil {
		t.Fatal("expected invalid gateway URL error")
	}
	t.Setenv("VERCEL_AI_GATEWAY_URL", "")
	if err := checks["ai-gateway"](context.Background()); err != nil {
		t.Fatalf("expected default gateway URL success, got %v", err)
	}

	t.Setenv("BRAVE_SEARCH_API_KEY", "")
	if err := checks["brave-search"](context.Background()); err == nil {
		t.Fatal("expected missing Brave key error")
	}
	t.Setenv("BRAVE_SEARCH_API_KEY", "key")
	if err := checks["brave-search"](context.Background()); err != nil {
		t.Fatalf("expected Brave check success, got %v", err)
	}

	t.Setenv("STATSIG_SECRET_KEY", "")
	if err := checks["statsig"](context.Background()); err != nil {
		t.Fatalf("expected empty Statsig key to be allowed, got %v", err)
	}
}

func TestStartupChecks_InngestMissingKey(t *testing.T) {
	cfg := buildServerConfig(&sync.WaitGroup{})
	checks := make(map[string]func(context.Context) error)
	for _, check := range cfg.StartupChecks {
		checks[check.Name] = check.Check
	}

	t.Setenv("INNGEST_EVENT_KEY", "")
	t.Setenv("INNGEST_DEV", "")
	if err := checks["inngest"](context.Background()); err == nil {
		t.Fatal("expected inngest startup check to fail without event key")
	}
}

func TestStartupChecks_RedisPingSuccess(t *testing.T) {
	cfg := buildServerConfig(&sync.WaitGroup{})
	checks := make(map[string]func(context.Context) error)
	for _, check := range cfg.StartupChecks {
		checks[check.Name] = check.Check
	}

	redispkg.SetClient(redispkg.NewMockClient())
	t.Cleanup(redispkg.ResetClient)

	if err := checks["redis"](context.Background()); err != nil {
		t.Fatalf("expected redis startup check to succeed: %v", err)
	}
}

func TestStartupChecks_RedisUnavailable(t *testing.T) {
	cfg := buildServerConfig(&sync.WaitGroup{})
	checks := make(map[string]func(context.Context) error)
	for _, check := range cfg.StartupChecks {
		checks[check.Name] = check.Check
	}

	t.Setenv("REDIS_URL", "")
	if err := checks["redis"](context.Background()); err == nil {
		t.Fatal("expected redis startup check to fail without client")
	}
}

func TestStartupChecks_StatsigOptional(t *testing.T) {
	cfg := buildServerConfig(&sync.WaitGroup{})
	checks := make(map[string]func(context.Context) error)
	for _, check := range cfg.StartupChecks {
		checks[check.Name] = check.Check
	}

	t.Setenv("STATSIG_SECRET_KEY", "")
	if err := checks["statsig"](context.Background()); err != nil {
		t.Fatalf("statsig startup check should succeed without key: %v", err)
	}

	t.Setenv("STATSIG_SECRET_KEY", "secret-123")
	if err := checks["statsig"](context.Background()); err != nil {
		t.Fatalf("statsig startup check should succeed with key: %v", err)
	}
}
