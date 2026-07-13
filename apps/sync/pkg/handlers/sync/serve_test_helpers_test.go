package sync

import (
	"io"
	"net/http"
	"net/http/httptest"
)

// doRequest runs method+path (with optional body) against r and returns the recorder.
func doRequest(r http.Handler, method, path string, body io.Reader) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(method, path, body))
	return w
}
