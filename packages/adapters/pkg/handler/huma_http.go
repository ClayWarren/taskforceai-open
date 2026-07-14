package handler

import (
	"io"
	"net/http"
	"strconv"

	"github.com/danielgtaylor/huma/v2"
)

// RegisterHumaHTTPHandler registers an existing net/http handler as a Huma
// operation. It is intended for wire-compatible migrations where changing the
// handler's response envelope, cookies, or error format would break clients.
// New endpoints should prefer huma.Register with typed input and output structs.
func RegisterHumaHTTPHandler(api huma.API, operation huma.Operation, next http.Handler) {
	if next == nil {
		next = http.NotFoundHandler()
	}
	if operation.Responses == nil {
		operation.Responses = map[string]*huma.Response{
			"200": {Description: "Successful response"},
		}
	}
	if !operation.Hidden {
		api.OpenAPI().AddOperation(&operation)
	}

	handler := func(ctx huma.Context) {
		next.ServeHTTP(newHumaResponseWriter(ctx), requestFromHumaContext(ctx))
	}
	api.Adapter().Handle(
		&operation,
		api.Middlewares().Handler(operation.Middlewares.Handler(handler)),
	)

	if operation.Method != http.MethodOptions {
		preflightOperation := huma.Operation{
			OperationID: operation.OperationID + "-preflight",
			Method:      http.MethodOptions,
			Path:        operation.Path,
			Hidden:      true,
		}
		preflightHandler := func(ctx huma.Context) {
			HandleCORS(newHumaResponseWriter(ctx), requestFromHumaContext(ctx))
		}
		api.Adapter().Handle(
			&preflightOperation,
			api.Middlewares().Handler(preflightHandler),
		)
	}
}

func requestFromHumaContext(ctx huma.Context) *http.Request {
	requestURL := ctx.URL()
	protocol := ctx.Version()
	headers := make(http.Header)
	ctx.EachHeader(func(name, value string) {
		headers.Add(name, value)
	})

	request := &http.Request{
		Method:     ctx.Method(),
		URL:        &requestURL,
		Header:     headers,
		Body:       io.NopCloser(ctx.BodyReader()),
		Host:       ctx.Host(),
		RemoteAddr: ctx.RemoteAddr(),
		RequestURI: requestURL.RequestURI(),
		TLS:        ctx.TLS(),
		Proto:      protocol.Proto,
		ProtoMajor: protocol.ProtoMajor,
		ProtoMinor: protocol.ProtoMinor,
	}
	if contentLength, err := strconv.ParseInt(headers.Get("Content-Length"), 10, 64); err == nil {
		request.ContentLength = contentLength
	}
	return request.WithContext(ctx.Context())
}

type humaResponseWriter struct {
	ctx         huma.Context
	header      http.Header
	wroteHeader bool
}

func newHumaResponseWriter(ctx huma.Context) *humaResponseWriter {
	return &humaResponseWriter{ctx: ctx, header: make(http.Header)}
}

func (w *humaResponseWriter) Header() http.Header {
	return w.header
}

func (w *humaResponseWriter) WriteHeader(statusCode int) {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true
	for name, values := range w.header {
		for index, value := range values {
			if index == 0 {
				w.ctx.SetHeader(name, value)
			} else {
				w.ctx.AppendHeader(name, value)
			}
		}
	}
	w.ctx.SetStatus(statusCode)
}

func (w *humaResponseWriter) Write(body []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	return w.ctx.BodyWriter().Write(body)
}

func (w *humaResponseWriter) Flush() {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	if flusher, ok := w.ctx.BodyWriter().(http.Flusher); ok {
		flusher.Flush()
	}
}
