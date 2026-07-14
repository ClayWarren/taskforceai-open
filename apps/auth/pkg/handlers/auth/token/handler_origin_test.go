package authtoken_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	authtoken "github.com/TaskForceAI/auth-service/pkg/handlers/auth/token"
	"github.com/stretchr/testify/assert"
)

func TestHandler_BlockedCrossOrigin(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/token", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	rr := httptest.NewRecorder()

	authtoken.Handler(rr, req)
	assert.Equal(t, http.StatusForbidden, rr.Code)
}

func TestHandler_AllowedSameOrigin(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/token", nil)
	req.Host = "taskforceai.chat"
	req.Header.Set("Origin", "https://taskforceai.chat")
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("X-Forwarded-Host", "taskforceai.chat")
	rr := httptest.NewRecorder()

	authtoken.Handler(rr, req)
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestHandler_TokenOriginNormalization(t *testing.T) {
	tests := []struct {
		name    string
		origin  string
		host    string
		xfHost  string
		xfProto string
		want    int
	}{
		{
			name:    "default https port",
			origin:  "https://taskforceai.chat",
			host:    "taskforceai.chat",
			xfProto: "https",
			want:    http.StatusUnauthorized,
		},
		{
			name:    "forwarded host list uses first",
			origin:  "https://app.taskforceai.chat",
			host:    "internal.vercel.local",
			xfHost:  "app.taskforceai.chat, evil.example",
			xfProto: "https, http",
			want:    http.StatusUnauthorized,
		},
		{
			name:   "loopback ipv6",
			origin: "http://[::1]",
			host:   "[::1]",
			want:   http.StatusUnauthorized,
		},
		{
			name:    "port mismatch",
			origin:  "https://taskforceai.chat:444",
			host:    "taskforceai.chat",
			xfProto: "https",
			want:    http.StatusForbidden,
		},
		{
			name:    "scheme mismatch",
			origin:  "http://taskforceai.chat",
			host:    "taskforceai.chat",
			xfProto: "https",
			want:    http.StatusForbidden,
		},
		{
			name:   "unsupported origin scheme",
			origin: "ftp://taskforceai.chat",
			host:   "taskforceai.chat",
			want:   http.StatusForbidden,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/token", nil)
			req.Host = tt.host
			req.Header.Set("Origin", tt.origin)
			if tt.xfHost != "" {
				req.Header.Set("X-Forwarded-Host", tt.xfHost)
			}
			if tt.xfProto != "" {
				req.Header.Set("X-Forwarded-Proto", tt.xfProto)
			}
			rr := httptest.NewRecorder()

			authtoken.Handler(rr, req)
			assert.Equal(t, tt.want, rr.Code)
		})
	}
}
