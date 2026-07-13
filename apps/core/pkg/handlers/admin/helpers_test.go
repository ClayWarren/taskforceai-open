package admin

import (
	"net/http"
	"net/http/httptest"
)

// serve runs req against router and returns the recorder.
func serve(router http.Handler, req *http.Request) *httptest.ResponseRecorder {
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	return resp
}

// doGet runs a GET against router and returns the recorder.
func doGet(router http.Handler, path string) *httptest.ResponseRecorder {
	return serve(router, httptest.NewRequest(http.MethodGet, path, nil))
}
