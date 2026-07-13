package stream

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/TaskForceAI/adapters/pkg/handler"
	enginehandler "github.com/TaskForceAI/go-engine/pkg/handler"
	"github.com/TaskForceAI/go-engine/pkg/run"
)

var bufferPool = sync.Pool{
	New: func() any { return bytes.NewBuffer(make([]byte, 0, 2048)) },
}

// streamKeepAliveTimeout controls how long the SSE handler loop waits before sending a keep-alive pulse.
var streamKeepAliveTimeout = 55 * time.Second
var streamStatusPollInterval = 500 * time.Millisecond

// streamMarshalEvent marshals SSE payloads; overridden in tests.
var streamMarshalEvent = func(h *streamHandler, v any) ([]byte, error) {
	return h.marshalToPooledBuffer(v)
}

var getQueries = enginehandler.GetQueries
var authWrapper = enginehandler.WithFlexibleAuth
var orchestrateTask = run.OrchestrateTask
var sseDataPrefix = []byte("data: ")
var sseEventSuffix = []byte("\n\n")
var sseNewline = []byte("\n")
var sseSpace = []byte(" ")

type streamHandler struct {
	w                     http.ResponseWriter
	taskID                string
	userID                int
	rc                    *http.ResponseController
	hasStarted            bool
	lastProgressEvent     []byte
	lastProgressVersion   int64
	lastProgressUpdatedAt int64
	lastProgressSentAt    time.Time
}

func (h *streamHandler) sendSSE(data []byte) error {
	data = bytes.TrimSpace(data)
	// Bug 18: Ensure we send a single `data:` line for JSON payloads to avoid SSE multiline issues
	if bytes.Contains(data, sseNewline) {
		data = bytes.ReplaceAll(data, sseNewline, sseSpace)
	}
	if _, err := h.w.Write(sseDataPrefix); err != nil {
		return err
	}
	if _, err := h.w.Write(data); err != nil {
		return err
	}
	if _, err := h.w.Write(sseEventSuffix); err != nil {
		return err
	}
	if err := h.rc.Flush(); err != nil {
		slog.Debug("[Stream] Response flush failed after SSE write", "taskId", h.taskID, "error", err)
	}
	return nil
}

func (h *streamHandler) marshalToPooledBuffer(v any) ([]byte, error) {
	var buf *bytes.Buffer
	if b, ok := bufferPool.Get().(*bytes.Buffer); ok {
		buf = b
		buf.Reset()
		defer bufferPool.Put(buf)
	} else {
		// Bug 9: Fallback if sync.Pool returns unexpected type or is empty
		buf = bytes.NewBuffer(make([]byte, 0, 2048))
		defer bufferPool.Put(buf)
	}

	enc := json.NewEncoder(buf)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	result := make([]byte, buf.Len())
	copy(result, buf.Bytes())
	return result, nil
}

func (h *streamHandler) sendError(message string) bool {
	errEvent, _ := h.marshalToPooledBuffer(map[string]string{"type": "error", "error": message})
	if err := h.sendSSE(errEvent); err != nil {
		slog.Debug("[Stream] Client disconnected while sending error", "taskId", h.taskID, "error", err)
	}
	return false
}

func extractTaskIDFromStreamPath(rawPath string) string {
	trimmed := strings.TrimRight(strings.TrimSpace(rawPath), "/")
	if trimmed == "" {
		return ""
	}
	base := path.Base(trimmed)
	if base == "." || base == "/" {
		return ""
	}
	return base
}

// Handler handles the SSE connection for task streaming.
func Handler(w http.ResponseWriter, r *http.Request) {
	if handler.HandleCORS(w, r) {
		return
	}

	if r.Method != http.MethodGet {
		handler.JSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	q, err := getQueries(r.Context())
	if err != nil {
		handler.JSONError(w, http.StatusServiceUnavailable, "Database unavailable")
		return
	}

	authHandler := authWrapper(q, func(w http.ResponseWriter, r *http.Request) {
		user := handler.GetAuthenticatedUser(r)
		if user == nil {
			handler.JSONError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}

		taskID := extractTaskIDFromStreamPath(r.URL.Path)

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache, no-transform")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")

		rc := http.NewResponseController(w)
		slog.Info("[Stream] Handler loop starting", "taskId", taskID, "userId", user.ID)

		h := &streamHandler{
			w:      w,
			taskID: taskID,
			userID: user.ID,
			rc:     rc,
		}

		if !h.sendState() { //nolint:contextcheck // sendState reads through the registry's bounded context API.
			slog.Info("[Stream] Handler loop ended during initial state send", "taskId", taskID, "userId", user.ID)
			return
		}

		ticker := time.NewTicker(streamStatusPollInterval)
		defer ticker.Stop()

		timeout := time.After(streamKeepAliveTimeout)
		ctx := r.Context()

		for {
			select {
			case <-ctx.Done():
				slog.Info("[Stream] Handler loop ended: client context closed", "taskId", taskID, "userId", user.ID, "error", ctx.Err())
				return
			case <-timeout:
				if !h.sendKeepAlivePulse("keep-alive") {
					return
				}
				slog.Info("[Stream] Sent keep-alive pulse", "taskId", taskID, "userId", user.ID)
				timeout = time.After(streamKeepAliveTimeout)
			case <-ticker.C:
				if !h.sendState() { //nolint:contextcheck // sendState reads through the registry's bounded context API.
					slog.Info("[Stream] Handler loop ended after state send", "taskId", taskID, "userId", user.ID)
					return
				}
			}
		}
	})

	authHandler(w, r)
}
