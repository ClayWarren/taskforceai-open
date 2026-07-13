package handler

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"
	"github.com/stretchr/testify/assert"
)

func TestRegisterHumaHTTPHandlerPreservesRequestAndResponse(t *testing.T) {
	router := http.NewServeMux()
	api := humago.New(router, huma.DefaultConfig("test", "1.0.0"))

	RegisterHumaHTTPHandler(api, huma.Operation{
		OperationID: "legacy-compatible-json",
		Method:      http.MethodPost,
		Path:        "/api/test",
	}, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if !assert.NoError(t, err) {
			return
		}
		assert.Equal(t, "value", r.URL.Query().Get("query"))
		assert.Equal(t, "session=value", r.Header.Get("Cookie"))
		assert.Equal(t, "payload", string(body))
		http.SetCookie(w, &http.Cookie{Name: "result", Value: "ok"})
		w.Header().Set("X-Handler", "huma")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))

	request := httptest.NewRequest(http.MethodPost, "/api/test?query=value", strings.NewReader("payload"))
	request.Header.Set("Cookie", "session=value")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	assert.Equal(t, http.StatusAccepted, response.Code)
	assert.Equal(t, "huma", response.Header().Get("X-Handler"))
	assert.Contains(t, response.Header().Values("Set-Cookie"), "result=ok")
	assert.JSONEq(t, `{"ok":true}`, response.Body.String())
	assert.NotNil(t, api.OpenAPI().Paths["/api/test"].Post)
}

func TestRegisterHumaHTTPHandlerBoundaryBehavior(t *testing.T) {
	router := http.NewServeMux()
	api := humago.New(router, huma.DefaultConfig("test", "1.0.0"))
	RegisterHumaHTTPHandler(api, huma.Operation{
		OperationID: "boundary-handler",
		Method:      http.MethodPost,
		Path:        "/api/boundary",
	}, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, int64(7), r.ContentLength)
		w.Header().Add("X-Multi", "first")
		w.Header().Add("X-Multi", "second")
		_, err := w.Write([]byte("response"))
		assert.NoError(t, err)
		w.WriteHeader(http.StatusTeapot)
	}))

	request := httptest.NewRequest(http.MethodPost, "/api/boundary", strings.NewReader("payload"))
	request.Header.Set("Content-Length", "7")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	assert.Equal(t, http.StatusOK, response.Code)
	assert.Equal(t, []string{"first", "second"}, response.Header().Values("X-Multi"))
	assert.Equal(t, "response", response.Body.String())

	nilRouter := http.NewServeMux()
	nilAPI := humago.New(nilRouter, huma.DefaultConfig("test", "1.0.0"))
	RegisterHumaHTTPHandler(nilAPI, huma.Operation{
		OperationID: "nil-handler",
		Method:      http.MethodGet,
		Path:        "/api/nil",
	}, nil)
	nilResponse := httptest.NewRecorder()
	nilRouter.ServeHTTP(nilResponse, httptest.NewRequest(http.MethodGet, "/api/nil", nil))
	assert.Equal(t, http.StatusNotFound, nilResponse.Code)
}

func TestHumaResponseWriterFlushesAndToleratesNonFlusher(t *testing.T) {
	var body bytes.Buffer
	writer := newHumaResponseWriter(testHumaContext{ctx: context.Background(), writer: &body})
	writer.Flush()
	assert.True(t, writer.wroteHeader)

	recorder := httptest.NewRecorder()
	writer = newHumaResponseWriter(testHumaContext{ctx: context.Background(), writer: recorder})
	writer.Flush()
	assert.True(t, recorder.Flushed)
}

func TestRegisterHumaHTTPHandlerRunsHumaMiddleware(t *testing.T) {
	router := http.NewServeMux()
	api := humago.New(router, huma.DefaultConfig("test", "1.0.0"))
	api.UseMiddleware(func(ctx huma.Context, next func(huma.Context)) {
		ctx.SetHeader("X-Middleware", "ran")
		next(ctx)
	})

	RegisterHumaHTTPHandler(api, huma.Operation{
		OperationID: "middleware-json",
		Method:      http.MethodGet,
		Path:        "/api/middleware",
	}, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/middleware", nil))

	assert.Equal(t, http.StatusNoContent, response.Code)
	assert.Equal(t, "ran", response.Header().Get("X-Middleware"))
}

func TestRegisterHumaHTTPHandlerHandlesCORSPreflight(t *testing.T) {
	router := http.NewServeMux()
	api := humago.New(router, huma.DefaultConfig("test", "1.0.0"))
	handlerCalled := false

	RegisterHumaHTTPHandler(api, huma.Operation{
		OperationID: "cors-json",
		Method:      http.MethodPost,
		Path:        "/api/cors",
	}, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		handlerCalled = true
		w.WriteHeader(http.StatusOK)
	}))

	request := httptest.NewRequest(http.MethodOptions, "/api/cors", nil)
	request.Header.Set("Origin", "https://taskforceai.chat")
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	request.Header.Set("Access-Control-Request-Headers", "Content-Type, X-CSRF-Token")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	assert.Equal(t, http.StatusNoContent, response.Code)
	assert.Equal(t, "https://taskforceai.chat", response.Header().Get("Access-Control-Allow-Origin"))
	assert.Contains(t, response.Header().Get("Access-Control-Allow-Headers"), "X-CSRF-Token")
	assert.False(t, handlerCalled)
	assert.Nil(t, api.OpenAPI().Paths["/api/cors"].Options)
}
