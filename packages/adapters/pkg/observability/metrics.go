package observability

import (
	"net/http"
	"regexp"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

var idLikeSegmentPattern = regexp.MustCompile(`^(?:\d+|[0-9a-fA-F]{8,}|[0-9a-fA-F-]{32,}|[A-Za-z0-9_-]{24,})$`)

// responseWriter wraps http.ResponseWriter to capture the status code.
type responseWriter struct {
	http.ResponseWriter
	statusCode int
	written    bool
}

func (rw *responseWriter) WriteHeader(code int) {
	if !rw.written {
		rw.statusCode = code
		rw.written = true
	}
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *responseWriter) Write(b []byte) (int, error) {
	if !rw.written {
		rw.statusCode = http.StatusOK
		rw.written = true
	}
	return rw.ResponseWriter.Write(b)
}

// Unwrap allows middleware that wraps response writers (like otelhttp) to
// reach the underlying writer for feature detection (e.g., http.Flusher).
func (rw *responseWriter) Unwrap() http.ResponseWriter {
	return rw.ResponseWriter
}

// WithHTTPMetrics returns middleware that records HTTP server metrics.
// It creates histograms for request duration and counters for request totals and errors.
func WithHTTPMetrics(serviceName string) func(http.Handler) http.Handler {
	meter := otel.Meter(serviceName)

	duration, _ := meter.Float64Histogram(
		"http.server.duration",
		metric.WithDescription("Duration of HTTP server requests in milliseconds"),
		metric.WithUnit("ms"),
	)

	requestTotal, _ := meter.Int64Counter(
		"http.server.request.total",
		metric.WithDescription("Total number of HTTP server requests"),
	)

	errorTotal, _ := meter.Int64Counter(
		"http.server.error.total",
		metric.WithDescription("Total number of HTTP server errors (4xx and 5xx)"),
	)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()

			rw := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}
			next.ServeHTTP(rw, r)

			elapsed := float64(time.Since(start).Milliseconds())
			route := normalizeMetricRouteWithStatus(r, rw.statusCode)
			attrs := []attribute.KeyValue{
				attribute.String("http.method", r.Method),
				attribute.String("http.route", route),
				attribute.Int("http.status_code", rw.statusCode),
			}

			duration.Record(r.Context(), elapsed, metric.WithAttributes(attrs...))
			requestTotal.Add(r.Context(), 1, metric.WithAttributes(attrs...))

			if rw.statusCode >= 400 {
				errorTotal.Add(r.Context(), 1, metric.WithAttributes(attrs...))
			}
		})
	}
}

func normalizeMetricRouteWithStatus(r *http.Request, statusCode int) string {
	if r == nil {
		return "unknown"
	}

	if r.Pattern != "" {
		return r.Pattern
	}

	if statusCode == http.StatusNotFound {
		return "unmatched"
	}

	if r.URL == nil || r.URL.Path == "" {
		return "/"
	}

	segments := strings.Split(r.URL.Path, "/")
	for idx, segment := range segments {
		if segment == "" {
			continue
		}
		if idLikeSegmentPattern.MatchString(segment) {
			segments[idx] = ":id"
		}
	}

	return strings.Join(segments, "/")
}
