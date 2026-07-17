package webhooks

import (
	"net/http"
	"net/http/httptest"
)

// serve runs req against h and returns the recorder.
func serve(h http.Handler, req *http.Request) *httptest.ResponseRecorder {
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr
}
