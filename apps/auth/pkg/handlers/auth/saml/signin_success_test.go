package saml

import (
	"context"
	"net/http"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/auth-service/pkg/providers"
	"github.com/TaskForceAI/auth-service/pkg/testutils"
	"github.com/stretchr/testify/assert"
	"github.com/workos/workos-go/v6/pkg/sso"
	"github.com/workos/workos-go/v6/pkg/usermanagement"
)

type mockWorkOSSAML struct {
	authURL string
}

var _ providers.WorkOSProvider = (*mockWorkOSSAML)(nil)

func (m *mockWorkOSSAML) Configure(string, string) {}

func (m *mockWorkOSSAML) GetHostedAuthURL(usermanagement.GetAuthorizationURLOpts) (string, error) {
	return "", nil
}

func (m *mockWorkOSSAML) AuthenticateWithCode(context.Context, usermanagement.AuthenticateWithCodeOpts) (usermanagement.AuthenticateResponse, error) {
	return usermanagement.AuthenticateResponse{}, nil
}

func (m *mockWorkOSSAML) GetSSOAuthorizationURL(sso.GetAuthorizationURLOpts) (string, error) {
	return m.authURL, nil
}

func (m *mockWorkOSSAML) GetSSOProfileAndToken(context.Context, sso.GetProfileAndTokenOpts) (sso.ProfileAndToken, error) {
	return sso.ProfileAndToken{}, nil
}

func TestSigninHandlerStruct_SuccessRedirect(t *testing.T) {
	t.Setenv("WORKOS_API_KEY", "test-key")
	t.Setenv("WORKOS_CLIENT_ID", "test-client")
	t.Setenv("AUTH_SECRET", "test-secret-value-that-is-long-enough")
	t.Setenv("AUTH_SERVICE_URL", "https://auth.example.com")

	workosID := "org_saml_ok"
	h := &SigninHandlerStruct{
		WorkOS: &mockWorkOSSAML{authURL: "https://sso.example.com/start"},
		GetOrg: func(context.Context, *db.Queries, string) (*db.Organization, error) {
			return &db.Organization{
				ID:                   1,
				WorkosOrganizationID: &workosID,
			}, nil
		},
		GetQueries: func(context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}

	rr := doGet(h, "/api/v1/auth/saml/signin?email=user@acme.com")

	assert.Equal(t, http.StatusFound, rr.Code)
	assert.Equal(t, "https://sso.example.com/start", rr.Header().Get("Location"))
}

func TestSigninHandlerStruct_InvalidEmailFormat(t *testing.T) {
	t.Setenv("WORKOS_API_KEY", "test-key")
	t.Setenv("WORKOS_CLIENT_ID", "test-client")

	h := &SigninHandlerStruct{WorkOS: &testutils.MockWorkOSClient{}}
	rr := doGet(h, "/api/v1/auth/saml/signin?email=not-an-email")
	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestSigninHandlerStruct_OrgMissingWorkOSID(t *testing.T) {
	t.Setenv("WORKOS_API_KEY", "test-key")
	t.Setenv("WORKOS_CLIENT_ID", "test-client")

	h := &SigninHandlerStruct{
		WorkOS: &testutils.MockWorkOSClient{},
		GetOrg: func(context.Context, *db.Queries, string) (*db.Organization, error) {
			return &db.Organization{ID: 1}, nil
		},
		GetQueries: func(context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}

	rr := doGet(h, "/api/v1/auth/saml/signin?email=user@acme.com")
	assert.Equal(t, http.StatusBadRequest, rr.Code)
}
