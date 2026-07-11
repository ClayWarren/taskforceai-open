package observability

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

func TestParseBoolEnv(t *testing.T) {
	// Test true values
	t.Setenv("TEST_BOOL", "true")
	assert.True(t, parseBoolEnv("TEST_BOOL"))
	t.Setenv("TEST_BOOL", "1")
	assert.True(t, parseBoolEnv("TEST_BOOL"))

	// Test false values
	t.Setenv("TEST_BOOL", "false")
	assert.False(t, parseBoolEnv("TEST_BOOL"))
	t.Setenv("TEST_BOOL", "0")
	assert.False(t, parseBoolEnv("TEST_BOOL"))

	// Test default (false)
	_ = os.Unsetenv("TEST_BOOL")
	assert.False(t, parseBoolEnv("TEST_BOOL"))
}

func TestParseBoolEnvCaseAndWhitespace(t *testing.T) {
	t.Setenv("TEST_BOOL", " YES ")
	assert.True(t, parseBoolEnv("TEST_BOOL"))

	t.Setenv("TEST_BOOL", " On ")
	assert.True(t, parseBoolEnv("TEST_BOOL"))

	t.Setenv("TEST_BOOL", " no ")
	assert.False(t, parseBoolEnv("TEST_BOOL"))
}

func TestTelemetryDisabled(t *testing.T) {
	t.Setenv("TELEMETRY_DISABLED", "true")
	assert.True(t, telemetryDisabled())

	t.Setenv("TELEMETRY_DISABLED", "false")
	t.Setenv("OTEL_SDK_DISABLED", "false")
	assert.False(t, telemetryDisabled())
}

func TestResolveOTLPInsecure(t *testing.T) {
	t.Setenv("OTEL_EXPORTER_OTLP_INSECURE", "true")
	assert.True(t, resolveOTLPInsecure(otlpSignalTraces))

	t.Setenv("OTEL_EXPORTER_OTLP_INSECURE", "false")
	assert.False(t, resolveOTLPInsecure(otlpSignalTraces))
}

func TestResolveTraceSampleRatio(t *testing.T) {
	t.Setenv("OTEL_TRACES_SAMPLER_ARG", "0.5")
	assert.Equal(t, 0.5, resolveTraceSampleRatio())

	t.Setenv("OTEL_TRACES_SAMPLER_ARG", "invalid")
	assert.Equal(t, 1.0, resolveTraceSampleRatio())

	_ = os.Unsetenv("OTEL_TRACES_SAMPLER_ARG")
	assert.Equal(t, 1.0, resolveTraceSampleRatio())
}

func TestResolveTraceSampler(t *testing.T) {
	tests := []struct {
		name    string
		sampler string
		ratio   string
		want    sdktrace.SamplingDecision
	}{
		{name: "always off", sampler: "always_off", want: sdktrace.Drop},
		{name: "always on", sampler: "always_on", want: sdktrace.RecordAndSample},
		{name: "default zero ratio drops", ratio: "0", want: sdktrace.Drop},
		{name: "default one ratio samples", ratio: "1", want: sdktrace.RecordAndSample},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("OTEL_TRACES_SAMPLER", tt.sampler)
			t.Setenv("OTEL_TRACES_SAMPLER_ARG", tt.ratio)

			result := resolveTraceSampler().ShouldSample(sdktrace.SamplingParameters{})
			assert.Equal(t, tt.want, result.Decision)
		})
	}
}

func TestSafeHeaderKeys(t *testing.T) {
	keys := safeHeaderKeys(map[string]string{"Authorization": "secret", "X-Trace": "trace"})
	assert.ElementsMatch(t, []string{"Authorization", "X-Trace"}, keys)
	assert.Empty(t, safeHeaderKeys(nil))
}

func TestSafeOTLPTargetRedactsEndpointCredentials(t *testing.T) {
	target := safeOTLPTarget("https://user:password@collector.example/v1/traces?token=abc&project=ok&api_key=secret")

	assert.Contains(t, target, "https://%5BREDACTED%5D@collector.example/v1/traces")
	assert.Contains(t, target, "token=%5BREDACTED%5D")
	assert.Contains(t, target, "api_key=%5BREDACTED%5D")
	assert.Contains(t, target, "project=ok")
	assert.NotContains(t, target, "password")
	assert.NotContains(t, target, "abc")
	assert.NotContains(t, target, "secret")
}

func TestSafeOTLPTargetLeavesHostEndpointUnchanged(t *testing.T) {
	assert.Equal(t, "collector.example:4318", safeOTLPTarget("collector.example:4318"))
}

func TestResolveSignalEndpoint(t *testing.T) {
	// Global endpoint (should append path)
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://example.com/otlp")
	_ = os.Unsetenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
	_ = os.Unsetenv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT")

	cfg := resolveSignalEndpoint(otlpSignalTraces)
	assert.Equal(t, "https://example.com/otlp/v1/traces", cfg.endpointURL)
	assert.True(t, cfg.enabled)

	cfg = resolveSignalEndpoint(otlpSignalMetrics)
	assert.Equal(t, "https://example.com/otlp/v1/metrics", cfg.endpointURL)
	assert.True(t, cfg.enabled)

	// Signal-specific endpoint (should NOT append path)
	t.Setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "https://example.com/custom-traces")
	cfg = resolveSignalEndpoint(otlpSignalTraces)
	assert.Equal(t, "https://example.com/custom-traces", cfg.endpointURL)

	// No endpoints (should return disabled)
	_ = os.Unsetenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	_ = os.Unsetenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
	cfg = resolveSignalEndpoint(otlpSignalTraces)
	assert.False(t, cfg.enabled)
}

func TestResolveSignalEndpointEdgeCases(t *testing.T) {
	t.Run("global host endpoint remains host only", func(t *testing.T) {
		t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "collector.internal:4318")
		_ = os.Unsetenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")

		cfg := resolveSignalEndpoint(otlpSignalTraces)
		assert.True(t, cfg.enabled)
		assert.Equal(t, "collector.internal:4318", cfg.endpoint)
		assert.Empty(t, cfg.endpointURL)
	})

	t.Run("invalid signal-specific endpoint blocks fallback to global", func(t *testing.T) {
		t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://example.com/otlp")
		t.Setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "%22%22")

		cfg := resolveSignalEndpoint(otlpSignalTraces)
		assert.False(t, cfg.enabled)
		assert.Empty(t, cfg.endpoint)
		assert.Empty(t, cfg.endpointURL)
	})
}

func TestResolveOTLPEndpointEdgeCases(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected otlpEndpointConfig
	}{
		{
			name:     "quoted url",
			input:    "\"https://collector.example.com/otlp\"",
			expected: otlpEndpointConfig{endpointURL: "https://collector.example.com/otlp", enabled: true},
		},
		{
			name:     "percent encoded quotes rejected",
			input:    "%22https://collector.example.com/otlp%22",
			expected: otlpEndpointConfig{},
		},
		{
			name:     "embedded quote rejected",
			input:    "https://collector.example.com/'otlp",
			expected: otlpEndpointConfig{},
		},
		{
			name:     "host with path rejected",
			input:    "collector.internal:4318/v1/traces",
			expected: otlpEndpointConfig{},
		},
		{
			name:     "host accepted",
			input:    "collector.internal:4318",
			expected: otlpEndpointConfig{endpoint: "collector.internal:4318", enabled: true},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, resolveOTLPEndpoint(tt.input))
		})
	}
}

func TestParseOTLPHeaders(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected map[string]string
	}{
		{
			name:     "empty input",
			input:    "",
			expected: nil,
		},
		{
			name:     "single header",
			input:    "key=value",
			expected: map[string]string{"key": "value"},
		},
		{
			name:     "multiple headers",
			input:    "key1=value1,key2=value2",
			expected: map[string]string{"key1": "value1", "key2": "value2"},
		},
		{
			name:     "headers with multiple equals",
			input:    "Authorization=Basic dXNlcjpwYXNzd29yZA==,X-Other=value=",
			expected: map[string]string{"Authorization": "Basic dXNlcjpwYXNzd29yZA==", "X-Other": "value="},
		},
		{
			name:     "with spaces",
			input:    " key1 = value1 , key2 = value2 ",
			expected: map[string]string{"key1": "value1", "key2": "value2"},
		},
		{
			name:     "with quotes",
			input:    "\"key1=value1,key2=value2\"",
			expected: map[string]string{"key1": "value1", "key2": "value2"},
		},
		{
			name:     "lone quote",
			input:    "\"",
			expected: nil,
		},
		{
			name:     "with base64 and spaces in value",
			input:    "Authorization=Basic dXNlcjpwYXNzd29yZA==",
			expected: map[string]string{"Authorization": "Basic dXNlcjpwYXNzd29yZA=="},
		},
		{
			name:     "with colon separator",
			input:    "Authorization: Basic dXNlcjpwYXNzd29yZA==",
			expected: map[string]string{"Authorization": "Basic dXNlcjpwYXNzd29yZA=="},
		},
		{
			name:     "with URL encoded space",
			input:    "Authorization=Basic%20dXNlcjpwYXNzd29yZA==",
			expected: map[string]string{"Authorization": "Basic dXNlcjpwYXNzd29yZA=="},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actual := parseOTLPHeaders(tt.input)
			assert.Equal(t, tt.expected, actual)
		})
	}
}

func TestParseOTLPHeadersEdgeCases(t *testing.T) {
	headers := parseOTLPHeaders(`Authorization="Basic abc,def==",X-Trace:trace-id,invalid,empty=,=bad`)
	assert.Equal(t, map[string]string{
		"Authorization": "Basic abc,def==",
		"X-Trace":       "trace-id",
	}, headers)
}

func TestResolveOTLPHeadersSignalOverride(t *testing.T) {
	t.Setenv("OTEL_EXPORTER_OTLP_HEADERS", "shared=global,global_only=present")
	t.Setenv("OTEL_EXPORTER_OTLP_TRACES_HEADERS", "shared=signal,trace_only=present")

	headers := resolveOTLPHeaders(otlpSignalTraces)
	assert.Equal(t, map[string]string{
		"shared":      "signal",
		"global_only": "present",
		"trace_only":  "present",
	}, headers)
}

func TestResolveMetricExportInterval(t *testing.T) {
	t.Setenv("OTEL_METRIC_EXPORT_INTERVAL", "1500")
	assert.Equal(t, 1500*time.Millisecond, resolveMetricExportInterval())

	t.Setenv("OTEL_METRIC_EXPORT_INTERVAL", "2s")
	assert.Equal(t, 2*time.Second, resolveMetricExportInterval())

	t.Setenv("OTEL_METRIC_EXPORT_INTERVAL", "invalid")
	assert.Equal(t, 30*time.Second, resolveMetricExportInterval())

	t.Setenv("OTEL_METRIC_EXPORT_INTERVAL", "-1")
	assert.Equal(t, 30*time.Second, resolveMetricExportInterval())

	t.Setenv("OTEL_METRIC_EXPORT_INTERVAL", "9223372036854775807")
	assert.Equal(t, 30*time.Second, resolveMetricExportInterval())
}

func resetBootstrapOnceState() {
	tracerOnce = sync.Once{}
	meterOnce = sync.Once{}
}

func TestInitTracerBootstrapNoopWhenUnconfigured(t *testing.T) {
	resetBootstrapOnceState()
	t.Setenv("VERCEL", "1")
	t.Setenv("TELEMETRY_DISABLED", "false")
	t.Setenv("OTEL_SDK_DISABLED", "false")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")
	t.Setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "")

	shutdown, err := InitTracer("bootstrap-test")
	require.NoError(t, err)
	assert.NotNil(t, shutdown)
	assert.NotPanics(t, shutdown)
}

func TestInitMeterBootstrapNoopWhenTelemetryDisabled(t *testing.T) {
	resetBootstrapOnceState()
	t.Setenv("VERCEL", "1")
	t.Setenv("TELEMETRY_DISABLED", "true")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://example.com/otlp")

	shutdown, err := InitMeter("bootstrap-meter-test")
	require.NoError(t, err)
	assert.NotNil(t, shutdown)
	assert.NotPanics(t, shutdown)
}

func TestInitTracerConfiguredEndpointInitializesProviderAndRestoresEnv(t *testing.T) {
	resetBootstrapOnceState()
	previous := otel.GetTracerProvider()
	t.Cleanup(func() {
		otel.SetTracerProvider(previous)
		resetBootstrapOnceState()
	})
	collector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(collector.Close)
	t.Setenv("TELEMETRY_DISABLED", "false")
	t.Setenv("OTEL_SDK_DISABLED", "false")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")
	t.Setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", collector.URL+"/v1/traces")
	t.Setenv("OTEL_EXPORTER_OTLP_HEADERS", "Authorization=Bearer%20secret")
	t.Setenv("OTEL_EXPORTER_OTLP_TRACES_HEADERS", "X-Trace=abc")
	t.Setenv("OTEL_EXPORTER_OTLP_TRACES_INSECURE", "true")
	t.Setenv("OTEL_TRACES_SAMPLER", "traceidratio")
	t.Setenv("OTEL_TRACES_SAMPLER_ARG", "0.5")

	shutdown, err := InitTracer("configured-tracer-test")
	require.NoError(t, err)
	assert.NotNil(t, shutdown)
	defer shutdown()

	_, ok := otel.GetTracerProvider().(*sdktrace.TracerProvider)
	assert.True(t, ok)
	assert.Equal(t, collector.URL+"/v1/traces", os.Getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"))
	assert.Equal(t, "Authorization=Bearer%20secret", os.Getenv("OTEL_EXPORTER_OTLP_HEADERS"))
	assert.Equal(t, "X-Trace=abc", os.Getenv("OTEL_EXPORTER_OTLP_TRACES_HEADERS"))
}

func TestInitMeterConfiguredEndpointInitializesProviderAndRestoresEnv(t *testing.T) {
	resetBootstrapOnceState()
	previous := otel.GetMeterProvider()
	t.Cleanup(func() {
		otel.SetMeterProvider(previous)
		resetBootstrapOnceState()
	})
	collector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(collector.Close)
	t.Setenv("TELEMETRY_DISABLED", "false")
	t.Setenv("OTEL_SDK_DISABLED", "false")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")
	t.Setenv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", collector.URL+"/v1/metrics")
	t.Setenv("OTEL_EXPORTER_OTLP_HEADERS", "Authorization=Bearer%20secret")
	t.Setenv("OTEL_EXPORTER_OTLP_METRICS_HEADERS", "X-Metric=abc")
	t.Setenv("OTEL_EXPORTER_OTLP_METRICS_INSECURE", "true")
	t.Setenv("OTEL_METRIC_EXPORT_INTERVAL", "250ms")

	shutdown, err := InitMeter("configured-meter-test")
	require.NoError(t, err)
	assert.NotNil(t, shutdown)
	defer shutdown()

	_, ok := otel.GetMeterProvider().(*sdkmetric.MeterProvider)
	assert.True(t, ok)
	assert.Equal(t, collector.URL+"/v1/metrics", os.Getenv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"))
	assert.Equal(t, "Authorization=Bearer%20secret", os.Getenv("OTEL_EXPORTER_OTLP_HEADERS"))
	assert.Equal(t, "X-Metric=abc", os.Getenv("OTEL_EXPORTER_OTLP_METRICS_HEADERS"))
}

func setupTestTracerProvider(t *testing.T) *tracetest.SpanRecorder {
	t.Helper()
	previous := otel.GetTracerProvider()
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	otel.SetTracerProvider(provider)
	t.Cleanup(func() {
		_ = provider.Shutdown(context.Background())
		otel.SetTracerProvider(previous)
	})
	return recorder
}

func TestWithTracingWrapsHTTPHandler(t *testing.T) {
	recorder := setupTestTracerProvider(t)
	handler := WithTracing(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.NotNil(t, r.Context())
		w.WriteHeader(http.StatusAccepted)
	}), "test-operation")

	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, httptest.NewRequest(http.MethodPost, "/api/test", nil))

	assert.Equal(t, http.StatusAccepted, resp.Code)
	ended := recorder.Ended()
	require.Len(t, ended, 1)
	assert.Equal(t, "POST", ended[0].Name())
}

func TestWithTracingFuncWrapsHTTPHandlerFunc(t *testing.T) {
	recorder := setupTestTracerProvider(t)
	handler := WithTracingFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
	}, "test-handler-func")

	resp := httptest.NewRecorder()
	handler(resp, httptest.NewRequest(http.MethodGet, "/api/test", nil))

	assert.Equal(t, http.StatusCreated, resp.Code)
	ended := recorder.Ended()
	require.Len(t, ended, 1)
	assert.Equal(t, "GET", ended[0].Name())
}

func TestFinishSpanSetsStatusAndRecordsErrors(t *testing.T) {
	recorder := setupTestTracerProvider(t)
	tracer := otel.Tracer("finish-span-test")

	_, okSpan := tracer.Start(context.Background(), "ok")
	FinishSpan(okSpan, nil)

	boom := errors.New("boom")
	_, errorSpan := tracer.Start(context.Background(), "error")
	FinishSpan(errorSpan, boom)

	assert.NotPanics(t, func() {
		FinishSpan(nil, boom)
	})

	ended := recorder.Ended()
	require.Len(t, ended, 2)
	assert.Equal(t, codes.Ok, ended[0].Status().Code)
	assert.Equal(t, codes.Error, ended[1].Status().Code)
	assert.Equal(t, "boom", ended[1].Status().Description)
	require.Len(t, ended[1].Events(), 1)
	assert.Equal(t, "exception", ended[1].Events()[0].Name)
}

func TestForceFlushHelpersUseSDKProviders(t *testing.T) {
	traceProvider := sdktrace.NewTracerProvider()
	previousTracer := otel.GetTracerProvider()
	otel.SetTracerProvider(traceProvider)
	t.Cleanup(func() {
		_ = traceProvider.Shutdown(context.Background())
		otel.SetTracerProvider(previousTracer)
	})

	meterProvider := sdkmetric.NewMeterProvider()
	previousMeter := otel.GetMeterProvider()
	otel.SetMeterProvider(meterProvider)
	t.Cleanup(func() {
		_ = meterProvider.Shutdown(context.Background())
		otel.SetMeterProvider(previousMeter)
	})

	assert.NotPanics(t, func() {
		ForceFlushTraces(context.Background())
		ForceFlushMetrics(context.Background())
	})
}
