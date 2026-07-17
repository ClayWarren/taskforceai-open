package signin

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/TaskForceAI/auth-service/pkg/providers"
	"github.com/TaskForceAI/auth-service/pkg/testutils"
	"github.com/stretchr/testify/assert"
	"github.com/workos/workos-go/v6/pkg/sso"
	"github.com/workos/workos-go/v6/pkg/usermanagement"
)

type hostedWorkOSMock struct {
	authURL string
}

var _ providers.WorkOSProvider = (*hostedWorkOSMock)(nil)

func (m *hostedWorkOSMock) Configure(string, string) {}

func (m *hostedWorkOSMock) GetHostedAuthURL(usermanagement.GetAuthorizationURLOpts) (string, error) {
	return m.authURL, nil
}

func (m *hostedWorkOSMock) AuthenticateWithCode(context.Context, usermanagement.AuthenticateWithCodeOpts) (usermanagement.AuthenticateResponse, error) {
	return usermanagement.AuthenticateResponse{}, nil
}

func (m *hostedWorkOSMock) GetSSOAuthorizationURL(sso.GetAuthorizationURLOpts) (string, error) {
	return "", nil
}

func (m *hostedWorkOSMock) GetSSOProfileAndToken(context.Context, sso.GetProfileAndTokenOpts) (sso.ProfileAndToken, error) {
	return sso.ProfileAndToken{}, nil
}

func TestHostedHandlerStruct_SuccessRedirect(t *testing.T) {
	t.Setenv("WORKOS_CLIENT_ID", "client_test")
	t.Setenv("AUTH_SECRET", "test-secret-value-that-is-long-enough")
	t.Setenv("AUTH_URL", "https://auth.example.com")

	h := &HostedHandlerStruct{WorkOS: &hostedWorkOSMock{authURL: "https://workos.example.com/login"}}
	rr := doGet(h, "/api/v1/auth/login?callbackUrl=%2Fdashboard")

	assert.Equal(t, http.StatusTemporaryRedirect, rr.Code)
	assert.Equal(t, "https://workos.example.com/login", rr.Header().Get("Location"))
}

func TestHostedHandlerStruct_WorkOSError(t *testing.T) {
	t.Setenv("WORKOS_CLIENT_ID", "client_test")
	t.Setenv("AUTH_SECRET", "test-secret-value-that-is-long-enough")
	t.Setenv("AUTH_URL", "https://auth.example.com")

	h := &HostedHandlerStruct{WorkOS: &testutils.MockWorkOSClient{AuthURLErr: errors.New("auth url failed")}}
	rr := doGet(h, "/api/v1/auth/login")
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}
