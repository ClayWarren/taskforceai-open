package observability

import (
	"context"
	"fmt"
	"log"
	"log/slog"
	"maps"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-logr/stdr"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.24.0"
	"go.opentelemetry.io/otel/trace"
)

func init() {
	// Pipe OTel internal errors to stderr with a prefix
	otel.SetLogger(stdr.New(log.New(os.Stderr, "OTEL_INTERNAL: ", log.LstdFlags)))
}

var (
	tracerOnce sync.Once
	meterOnce  sync.Once
	envMu      sync.Mutex
)

type otlpEndpointConfig struct {
	endpoint    string
	endpointURL string
	enabled     bool
}

type otlpSignal string

const (
	otlpSignalTraces  otlpSignal = "traces"
	otlpSignalMetrics otlpSignal = "metrics"
)

func resolveOTLPEndpoint(raw string) otlpEndpointConfig {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return otlpEndpointConfig{}
	}

	trimmed = strings.Trim(trimmed, "\"'")
	if trimmed == "" {
		return otlpEndpointConfig{}
	}

	// Guard against malformed quoted placeholders like "\"\"" or percent-encoded quotes.
	if strings.Contains(trimmed, "%22") || strings.ContainsAny(trimmed, "\"'") {
		return otlpEndpointConfig{}
	}

	if strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://") {
		parsed, err := url.Parse(trimmed)
		if err != nil || parsed.Host == "" {
			return otlpEndpointConfig{}
		}
		return otlpEndpointConfig{endpointURL: trimmed, enabled: true}
	}

	// `WithEndpoint` expects host[:port], not paths.
	if strings.Contains(trimmed, "/") {
		return otlpEndpointConfig{}
	}

	return otlpEndpointConfig{endpoint: trimmed, enabled: true}
}

func parseBoolEnv(name string) bool {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv(name)))
	switch raw {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func telemetryDisabled() bool {
	return parseBoolEnv("TELEMETRY_DISABLED") || parseBoolEnv("OTEL_SDK_DISABLED")
}

func resolveSignalEndpoint(signal otlpSignal) otlpEndpointConfig {
	signalEndpoint := os.Getenv(signalEnv(signal, "_ENDPOINT"))
	if strings.TrimSpace(signalEndpoint) != "" {
		return resolveOTLPEndpoint(signalEndpoint)
	}

	globalEndpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	if strings.TrimSpace(globalEndpoint) == "" {
		return otlpEndpointConfig{}
	}

	cfg := resolveOTLPEndpoint(globalEndpoint)
	if cfg.enabled && cfg.endpointURL != "" {
		// Append signal-specific path for global endpoint as per OTLP spec
		if !strings.HasSuffix(cfg.endpointURL, "/") {
			cfg.endpointURL += "/"
		}
		cfg.endpointURL += "v1/" + string(signal)
	}

	return cfg
}

func signalEnv(signal otlpSignal, suffix string) string {
	return "OTEL_EXPORTER_OTLP_" + strings.ToUpper(string(signal)) + suffix
}

func safeOTLPTarget(target string) string {
	trimmed := strings.TrimSpace(target)
	if trimmed == "" {
		return ""
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return trimmed
	}
	if parsed.User != nil {
		parsed.User = url.User("[REDACTED]")
	}
	query := parsed.Query()
	for key := range query {
		if sensitiveOTLPQueryKey(key) {
			query.Set(key, "[REDACTED]")
		}
	}
	parsed.RawQuery = query.Encode()
	return parsed.String()
}

func sensitiveOTLPQueryKey(key string) bool {
	normalized := strings.ToLower(strings.TrimSpace(key))
	return strings.Contains(normalized, "token") ||
		strings.Contains(normalized, "secret") ||
		strings.Contains(normalized, "password") ||
		strings.Contains(normalized, "key") ||
		strings.Contains(normalized, "credential") ||
		strings.Contains(normalized, "authorization")
}

func parseOTLPHeaders(raw string) map[string]string {
	trimmed := trimOuterQuotes(strings.TrimSpace(raw))
	if trimmed == "" {
		return nil
	}

	headers := make(map[string]string)
	for _, token := range splitQuotedHeaderTokens(trimmed) {
		key, value, ok := parseOTLPHeaderToken(token)
		if ok {
			headers[key] = value
		}
	}
	if len(headers) == 0 {
		return nil
	}
	return headers
}

func trimOuterQuotes(value string) string {
	if len(value) > 1 && (value[0] == '"' && value[len(value)-1] == '"' ||
		value[0] == '\'' && value[len(value)-1] == '\'') {
		return value[1 : len(value)-1]
	}
	return value
}

func splitQuotedHeaderTokens(value string) (tokens []string) {
	var inQuote rune
	start := 0
	for i, r := range value {
		switch {
		case r == inQuote:
			inQuote = 0
		case inQuote == 0 && (r == '"' || r == '\''):
			inQuote = r
		case inQuote == 0 && r == ',':
			tokens = append(tokens, value[start:i])
			start = i + 1
		}
	}
	return append(tokens, value[start:])
}

func parseOTLPHeaderToken(token string) (string, string, bool) {
	segment := strings.TrimSpace(token)
	if segment == "" {
		return "", "", false
	}
	separator := strings.IndexAny(segment, "=:")
	if separator < 0 {
		return "", "", false
	}
	key, value := segment[:separator], segment[separator+1:]
	key = strings.Trim(strings.TrimSpace(key), "\"'")
	value = strings.Trim(strings.TrimSpace(value), "\"'")
	if strings.Contains(value, "%") {
		if decoded, err := url.PathUnescape(value); err == nil {
			value = decoded
		}
	}
	return key, value, key != "" && value != ""
}
func resolveOTLPHeaders(signal otlpSignal) map[string]string {
	merged := make(map[string]string)
	maps.Copy(merged, parseOTLPHeaders(os.Getenv("OTEL_EXPORTER_OTLP_HEADERS")))
	maps.Copy(merged, parseOTLPHeaders(os.Getenv(signalEnv(signal, "_HEADERS"))))

	if len(merged) == 0 {
		return nil
	}
	return merged
}

func resolveOTLPInsecure(signal otlpSignal) bool {
	return parseBoolEnv(signalEnv(signal, "_INSECURE")) || parseBoolEnv("OTEL_EXPORTER_OTLP_INSECURE")
}

func resolveTraceSampleRatio() float64 {
	candidates := []string{
		os.Getenv("TELEMETRY_TRACE_SAMPLE_RATIO"),
		os.Getenv("OTEL_TRACES_SAMPLER_ARG"),
	}

	for _, candidate := range candidates {
		raw := strings.TrimSpace(candidate)
		if raw == "" {
			continue
		}
		ratio, err := strconv.ParseFloat(raw, 64)
		if err != nil {
			continue
		}
		if ratio < 0 || ratio > 1 {
			continue
		}
		return ratio
	}

	return 1.0
}

func resolveTraceSampler() sdktrace.Sampler {
	ratio := resolveTraceSampleRatio()
	ratioSampler := sdktrace.TraceIDRatioBased(ratio)

	switch strings.ToLower(strings.TrimSpace(os.Getenv("OTEL_TRACES_SAMPLER"))) {
	case "always_off":
		return sdktrace.NeverSample()
	case "traceidratio":
		return ratioSampler
	case "parentbased_traceidratio":
		return sdktrace.ParentBased(ratioSampler)
	case "always_on", "parentbased_always_on":
		return sdktrace.ParentBased(sdktrace.AlwaysSample())
	case "parentbased_always_off":
		return sdktrace.ParentBased(sdktrace.NeverSample())
	default:
		if ratio <= 0 {
			return sdktrace.NeverSample()
		}
		if ratio >= 1 {
			return sdktrace.AlwaysSample()
		}
		return sdktrace.ParentBased(ratioSampler)
	}
}

func resolveMetricExportInterval() time.Duration {
	const defaultMetricExportInterval = 30 * time.Second

	raw := strings.TrimSpace(os.Getenv("OTEL_METRIC_EXPORT_INTERVAL"))
	if raw == "" {
		return defaultMetricExportInterval
	}

	if milliseconds, err := strconv.ParseInt(raw, 10, 64); err == nil && milliseconds > 0 {
		maxMilliseconds := int64(^uint64(0)>>1) / int64(time.Millisecond)
		if milliseconds > maxMilliseconds {
			return defaultMetricExportInterval
		}
		return time.Duration(milliseconds) * time.Millisecond
	}

	if parsedDuration, err := time.ParseDuration(raw); err == nil && parsedDuration > 0 {
		return parsedDuration
	}

	return defaultMetricExportInterval
}

func safeHeaderKeys(headers map[string]string) []string {
	keys := make([]string, 0, len(headers))
	for k := range headers {
		keys = append(keys, k)
	}
	return keys
}

func telemetryResource(ctx context.Context, serviceName string) (*resource.Resource, error) {
	return resource.New(ctx, resource.WithAttributes(
		semconv.ServiceNameKey.String(serviceName),
		semconv.DeploymentEnvironmentKey.String(os.Getenv("NODE_ENV")),
	))
}

func withMaskedOTLPEnv(signal otlpSignal, create func() error) error {
	names := []string{
		"OTEL_EXPORTER_OTLP_HEADERS",
		signalEnv(signal, "_HEADERS"),
		"OTEL_EXPORTER_OTLP_ENDPOINT",
		signalEnv(signal, "_ENDPOINT"),
	}
	values := make([]string, len(names))

	envMu.Lock()
	defer envMu.Unlock()
	for i, name := range names {
		values[i] = os.Getenv(name)
		_ = os.Unsetenv(name)
	}
	defer func() {
		for i, name := range names {
			if values[i] != "" {
				_ = os.Setenv(name, values[i])
			}
		}
	}()
	return create()
}

type providerShutdown func(context.Context) error

func shutdownProvider(shutdown providerShutdown) func() {
	return func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := shutdown(ctx); err != nil {
			otel.Handle(err)
		}
	}
}

// InitTracer initializes an OTLP exporter, and configures the corresponding trace provider.
// Returns a shutdown function and an error.
func InitTracer(serviceName string) (func(), error) {
	var shutdown func()
	var initErr error

	tracerOnce.Do(func() {
		ctx := context.Background()

		if telemetryDisabled() {
			return
		}

		endpointCfg := resolveSignalEndpoint(otlpSignalTraces)
		if !endpointCfg.enabled {
			return
		}

		res, err := telemetryResource(ctx, serviceName)
		if err != nil {
			initErr = fmt.Errorf("failed to create resource: %w", err)
			return
		}

		exporterOpts := []otlptracehttp.Option{}
		var target string
		if endpointCfg.endpointURL != "" {
			target = endpointCfg.endpointURL
			exporterOpts = append(exporterOpts, otlptracehttp.WithEndpointURL(endpointCfg.endpointURL))
		} else {
			target = endpointCfg.endpoint
			exporterOpts = append(exporterOpts, otlptracehttp.WithEndpoint(endpointCfg.endpoint))
		}

		headers := resolveOTLPHeaders(otlpSignalTraces)
		if len(headers) > 0 {
			exporterOpts = append(exporterOpts, otlptracehttp.WithHeaders(headers))
		}

		insecure := resolveOTLPInsecure(otlpSignalTraces)
		if insecure {
			exporterOpts = append(exporterOpts, otlptracehttp.WithInsecure())
		}

		slog.Info("OTEL: Initializing tracer",
			"service", serviceName,
			"target", safeOTLPTarget(target),
			"headers", safeHeaderKeys(headers),
			"insecure", insecure,
		)

		var exporter sdktrace.SpanExporter
		err = withMaskedOTLPEnv(otlpSignalTraces, func() error {
			created, createErr := otlptracehttp.New(ctx, exporterOpts...)
			exporter = created
			return createErr
		})

		if err != nil {
			initErr = fmt.Errorf("failed to create exporter: %w", err)
			return
		}

		// Create TraceProvider
		tpOpts := []sdktrace.TracerProviderOption{
			sdktrace.WithResource(res),
			sdktrace.WithSampler(resolveTraceSampler()),
		}

		if os.Getenv("VERCEL") != "" {
			// Synchronous — exports each span immediately (required for serverless)
			tpOpts = append(tpOpts, sdktrace.WithSyncer(exporter))
		} else {
			// Asynchronous — buffers spans for performance
			tpOpts = append(tpOpts, sdktrace.WithBatcher(exporter))
		}

		tp := sdktrace.NewTracerProvider(tpOpts...)

		otel.SetTracerProvider(tp)
		otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))

		shutdown = shutdownProvider(tp.Shutdown)
	})

	if shutdown == nil {
		shutdown = func() {}
	}
	return shutdown, initErr
}

// ForceFlushTraces ensures all pending spans are exported.
// In serverless environments like Vercel, this should be called before the handler returns.
func ForceFlushTraces(ctx context.Context) {
	if tp, ok := otel.GetTracerProvider().(*sdktrace.TracerProvider); ok {
		_ = tp.ForceFlush(ctx)
	}
}

// ForceFlushMetrics ensures all pending metrics are exported.
// In serverless environments like Vercel, this should be called before the handler returns.
func ForceFlushMetrics(ctx context.Context) {
	if mp, ok := otel.GetMeterProvider().(*sdkmetric.MeterProvider); ok {
		_ = mp.ForceFlush(ctx)
	}
}

// InitMeter initializes an OTLP metric exporter and configures the meter provider.
// Returns a shutdown function and an error.
func InitMeter(serviceName string) (func(), error) {
	var shutdown func()
	var initErr error

	meterOnce.Do(func() {
		ctx := context.Background()

		if telemetryDisabled() {
			return
		}

		endpointCfg := resolveSignalEndpoint(otlpSignalMetrics)
		if !endpointCfg.enabled {
			return
		}

		res, err := telemetryResource(ctx, serviceName)
		if err != nil {
			initErr = fmt.Errorf("failed to create resource for meter: %w", err)
			return
		}

		// Set up OTLP HTTP metric exporter using the same endpoint config as the tracer
		exporterOpts := []otlpmetrichttp.Option{}
		var target string
		if endpointCfg.endpointURL != "" {
			target = endpointCfg.endpointURL
			exporterOpts = append(exporterOpts, otlpmetrichttp.WithEndpointURL(endpointCfg.endpointURL))
		} else if endpointCfg.endpoint != "" {
			target = endpointCfg.endpoint
			exporterOpts = append(exporterOpts, otlpmetrichttp.WithEndpoint(endpointCfg.endpoint))
		}

		headers := resolveOTLPHeaders(otlpSignalMetrics)
		if len(headers) > 0 {
			exporterOpts = append(exporterOpts, otlpmetrichttp.WithHeaders(headers))
		}

		insecure := resolveOTLPInsecure(otlpSignalMetrics)
		if insecure {
			exporterOpts = append(exporterOpts, otlpmetrichttp.WithInsecure())
		}

		slog.Info("OTEL: Initializing meter",
			"service", serviceName,
			"target", safeOTLPTarget(target),
			"headers", safeHeaderKeys(headers),
			"insecure", insecure,
		)

		var exporter sdkmetric.Exporter
		err = withMaskedOTLPEnv(otlpSignalMetrics, func() error {
			created, createErr := otlpmetrichttp.New(ctx, exporterOpts...)
			exporter = created
			return createErr
		})

		if err != nil {
			initErr = fmt.Errorf("failed to create metric exporter: %w", err)
			return
		}

		mp := sdkmetric.NewMeterProvider(
			sdkmetric.WithResource(res),
			sdkmetric.WithReader(sdkmetric.NewPeriodicReader(exporter, sdkmetric.WithInterval(resolveMetricExportInterval()))),
		)

		otel.SetMeterProvider(mp)

		shutdown = shutdownProvider(mp.Shutdown)
	})

	if shutdown == nil {
		shutdown = func() {}
	}
	return shutdown, initErr
}

// WithTracing wraps an http.Handler with OpenTelemetry instrumentation.
func WithTracing(handler http.Handler, operationName string) http.Handler {
	return otelhttp.NewHandler(handler, operationName)
}

// WithTracingFunc is a helper for http.HandlerFunc
func WithTracingFunc(next http.HandlerFunc, operationName string) http.HandlerFunc {
	return otelhttp.NewHandler(next, operationName).ServeHTTP
}

// FinishSpan ends the span and sets its status based on the error.
func FinishSpan(span trace.Span, err error) {
	if span == nil {
		return
	}
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
	} else {
		span.SetStatus(codes.Ok, "")
	}
	span.End()
}
