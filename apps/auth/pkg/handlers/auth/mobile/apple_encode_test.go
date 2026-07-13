package mobile

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	auth_mocks "github.com/TaskForceAI/auth-service/mocks/pkg/auth"
	provider_mocks "github.com/TaskForceAI/auth-service/mocks/pkg/providers"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/providers"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

func TestAppleHandler_EncodeSessionFailure(t *testing.T) {
	t.Setenv("APPLE_CLIENT_ID", "com.taskforceai.mobile")
	t.Setenv("AUTH_SECRET", "")

	mockApple := provider_mocks.NewAppleProvider(t)
	claims := verifiedAppleClaims("user@example.com")
	mockApple.On("VerifyIdentityToken", "valid").Return(claims, nil).Once()

	mockAudit := auth_mocks.NewAuditLogRepository(t)
	mockAudit.On("CreateAuditLog", mock.Anything, mock.Anything).Return(nil).Once()

	h := &AppleHandlerStruct{
		Apple:    mockApple,
		AuditLog: auth.NewAuditService(mockAudit),
		GetQueries: func(context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
		LinkUser: func(context.Context, *db.Queries, *providers.AppleClaims, string, string) (*auth.AuthUser, error) {
			return &auth.AuthUser{ID: 1, Email: "user@example.com"}, nil
		},
	}

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/auth/apple",
		strings.NewReader(`{"identityToken":"valid","authorizationCode":"code","nonce":"nonce"}`),
	)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestAppleHandler_VerifyFallbackAudienceLoop(t *testing.T) {
	t.Setenv("APPLE_CLIENT_ID", "com.primary.app")
	t.Setenv("APPLE_BUNDLE_ID", "com.fallback.app")

	h := &AppleHandlerStruct{}
	_, err := h.verifyAppleIdentityToken("not-a-real-token", resolveAppleAudiences())
	assert.Error(t, err)
}
