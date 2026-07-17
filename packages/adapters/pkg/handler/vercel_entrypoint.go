package handler

import (
	"context"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/TaskForceAI/adapters/pkg/auditflush"
	"github.com/TaskForceAI/adapters/pkg/logging"
	"github.com/TaskForceAI/adapters/pkg/observability"
)

// VercelEntrypointOptions configures shared Vercel function request bootstrap behavior.
type VercelEntrypointOptions struct {
	// ServiceName is included in centralized request completion logs.
	ServiceName string
	// InitLogMessage is logged once before handler initialization when non-empty.
	InitLogMessage string
	// ExtraDebugHeaders allows services to set additional debug headers.
	ExtraDebugHeaders func(w http.ResponseWriter, r *http.Request)
	// BeforeInit can short-circuit request handling (for proxy/SSE special-cases).
	// Return true when the request is fully handled.
	BeforeInit func(w http.ResponseWriter, r *http.Request) bool
	// InitHandler performs one-time router initialization and wrapper composition.
	InitHandler func() http.Handler
}

// ServeVercelEntrypoint centralizes standard Vercel Go function bootstrapping:
// CORS handling, rewritten-path restoration, debug headers, and lazy handler init.
func ServeVercelEntrypoint(
	w http.ResponseWriter,
	r *http.Request,
	handlerMux *http.Handler,
	muxOnce *sync.Once,
	options VercelEntrypointOptions,
) {
	if handlerMux == nil || muxOnce == nil {
		JSONError(w, http.StatusInternalServerError, "handler bootstrap is not configured")
		return
	}

	start := time.Now()
	loggingWriter := newStatusCaptureResponseWriter(w)
	w = loggingWriter
	r, _ = EnsureCorrelationID(w, r)

	// 1. Handle CORS first for all requests.
	if HandleCORS(w, r) {
		logVercelRequest(r, options, loggingWriter, start)
		return
	}

	// 2. Restore original path from various possible Vercel sources.
	RestorePath(r)

	// 3. Add debug headers to help troubleshoot routing in production.
	w.Header().Set("X-Debug-Path", r.URL.Path)
	if options.ExtraDebugHeaders != nil {
		options.ExtraDebugHeaders(w, r)
	}

	// 4. Allow service-specific fast paths before full router initialization.
	if options.BeforeInit != nil && options.BeforeInit(w, r) {
		logVercelRequest(r, options, loggingWriter, start)
		return
	}

	// 5. Lazy-initialize the global router.
	muxOnce.Do(func() {
		if options.InitLogMessage != "" {
			GetLogger().Info(options.InitLogMessage, nil)
		}
		if options.InitHandler != nil {
			*handlerMux = options.InitHandler()
		}
	})

	if *handlerMux == nil {
		JSONError(w, http.StatusInternalServerError, "handler initialization failed")
		logVercelRequest(r, options, loggingWriter, start)
		return
	}

	(*handlerMux).ServeHTTP(w, r)
	logVercelRequest(r, options, loggingWriter, start)

	// Ensure traces and metrics are flushed before the Vercel request ends.
	// This is critical in serverless environments where the process is frozen or killed immediately after return.
	if os.Getenv("VERCEL") != "" {
		// Use a short timeout for flushing to avoid delaying the response too much if Grafana Cloud is slow.
		ctx, cancel := context.WithTimeout(r.Context(), 1*time.Second)
		defer cancel()
		observability.ForceFlushTraces(ctx)
		observability.ForceFlushMetrics(ctx)
		auditflush.Flush()
	}
}

type statusCaptureResponseWriter struct {
	http.ResponseWriter
	statusCode  int
	wroteHeader bool
}

func newStatusCaptureResponseWriter(w http.ResponseWriter) *statusCaptureResponseWriter {
	return &statusCaptureResponseWriter{
		ResponseWriter: w,
		statusCode:     http.StatusOK,
	}
}

func (w *statusCaptureResponseWriter) WriteHeader(statusCode int) {
	if w.wroteHeader {
		return
	}
	w.statusCode = statusCode
	w.wroteHeader = true
	w.ResponseWriter.WriteHeader(statusCode)
}

func (w *statusCaptureResponseWriter) Write(data []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(w.statusCode)
	}
	return w.ResponseWriter.Write(data)
}

func (w *statusCaptureResponseWriter) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

// Unwrap lets protocol upgrades reach the platform's underlying writer through
// the request logging wrapper (for example, WebSocket Hijacker support).
func (w *statusCaptureResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func logVercelRequest(
	r *http.Request,
	options VercelEntrypointOptions,
	w *statusCaptureResponseWriter,
	start time.Time,
) {
	serviceName := options.ServiceName
	if serviceName == "" {
		serviceName = "go-service"
	}
	duration := time.Since(start)
	metadata := map[string]any{
		"service":       serviceName,
		"method":        r.Method,
		"path":          r.URL.Path,
		"status":        w.statusCode,
		"durationMs":    duration.Milliseconds(),
		"matchedPath":   r.Header.Get("X-Matched-Path"),
		"originalPath":  r.URL.Query().Get("__path"),
		"userAgent":     logging.SanitizeValue(r.UserAgent()),
		"remoteAddress": logging.SanitizeValue(r.RemoteAddr),
	}
	if userID := GetUserID(r); userID != 0 {
		metadata["userId"] = userID
	}
	if orgID := GetOrgID(r); orgID != 0 {
		metadata["orgId"] = orgID
	}
	if cid := logging.GetCorrelationID(r.Context()); cid != "" {
		metadata["correlationId"] = cid
	}

	logger := GetLogger()
	if w.statusCode >= 500 {
		logger.ErrorContext(r.Context(), "Go service request failed", flattenMetadata(metadata)...)
		return
	}
	if w.statusCode >= 400 {
		logger.WarnContext(r.Context(), "Go service request completed with client error", flattenMetadata(metadata)...)
		return
	}
	logger.InfoContext(r.Context(), "Go service request completed", flattenMetadata(metadata)...)
}

func flattenMetadata(metadata map[string]any) []any {
	args := make([]any, 0, len(metadata)*2)
	for key, value := range metadata {
		args = append(args, key, value)
	}
	return args
}
