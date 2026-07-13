package handlertest

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestServeHelpers(t *testing.T) {
	handler := http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		body, err := io.ReadAll(request.Body)
		assert.NoError(t, err)
		if len(body) == 0 {
			assert.Empty(t, request.Header.Get("Content-Type"))
		} else {
			assert.Equal(t, "application/json", request.Header.Get("Content-Type"))
		}
		response.WriteHeader(http.StatusCreated)
	})

	ServeStatus(t, handler, http.StatusCreated, http.MethodGet, "/without-body")
	ServeStatus(t, handler, http.StatusCreated, http.MethodPost, "/with-body", strings.NewReader(`{"ok":true}`))
	ServeEndpointStatus(t, handler, http.StatusCreated, Endpoint{Name: "empty", Method: http.MethodGet, Path: "/empty"})
	ServeEndpointStatus(t, handler, http.StatusCreated, Endpoint{Name: "body", Method: http.MethodPost, Path: "/body", Body: `{"ok":true}`})
}
