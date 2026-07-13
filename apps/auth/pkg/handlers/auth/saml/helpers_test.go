package saml

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

// doGet runs a GET against h and returns the recorder.
func doGet(h http.Handler, path string) *httptest.ResponseRecorder {
	return serve(h, httptest.NewRequest(http.MethodGet, path, nil))
}
