package saml

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/TaskForceAI/auth-service/pkg/testutils"
)

func TestSigninHandler_Success(t *testing.T) {
	_ = os.Setenv("WORKOS_API_KEY", "test")
	_ = os.Setenv("WORKOS_CLIENT_ID", "test")
	defer func() {
		_ = os.Unsetenv("WORKOS_API_KEY")
		_ = os.Unsetenv("WORKOS_CLIENT_ID")
	}()

	mockWorkOS := &testutils.MockWorkOSClient{
		SSOURL: "https://mock.workos.com/sso",
	}

	workosID := "org_123"
	mockGetOrg := func(ctx context.Context, q *db.Queries, domain string) (*db.Organization, error) {
		if domain != "example.com" {
			t.Fatalf("expected normalized domain example.com, got %q", domain)
		}
		return &db.Organization{
			WorkosOrganizationID: &workosID,
		}, nil
	}

	mockPool := dbtest.NewMockPool(t)
	h := &SigninHandlerStruct{
		WorkOS: mockWorkOS,
		GetOrg: mockGetOrg,
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return db.New(mockPool), nil
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/saml/signin?email=Test@Example.COM", nil)
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	if w.Result().StatusCode != http.StatusFound {
		t.Errorf("Expected status 302, got %d", w.Result().StatusCode)
	}

	if w.Header().Get("Location") != "https://mock.workos.com/sso" {
		t.Errorf("Expected location https://mock.workos.com/sso, got %s", w.Header().Get("Location"))
	}

	if mockWorkOS.LastSSOOpts.State == "" {
		t.Fatal("expected non-empty SSO state")
	}
	if mockWorkOS.LastSSOOpts.Organization != workosID {
		t.Fatalf("expected WorkOS organization %q, got %q", workosID, mockWorkOS.LastSSOOpts.Organization)
	}

	stateCookie := w.Result().Cookies()
	foundStateCookie := false
	for _, c := range stateCookie {
		if c.Name == "oauth_state" {
			foundStateCookie = true
			if strings.TrimSpace(c.Value) == "" {
				t.Fatal("expected oauth_state cookie value")
			}
			break
		}
	}
	if !foundStateCookie {
		t.Fatal("expected oauth_state cookie to be set")
	}
}

func TestSigninHandler_Errors(t *testing.T) {
	mockPool := dbtest.NewMockPool(t)
	h := &SigninHandlerStruct{
		WorkOS: &testutils.MockWorkOSClient{},
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return db.New(mockPool), nil
		},
	}

	// 1. Missing Config
	_ = os.Unsetenv("WORKOS_API_KEY")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/saml/signin", nil)
	w := serve(h, req)
	if w.Result().StatusCode != http.StatusInternalServerError {
		t.Error("expected 500 for missing config")
	}
	_ = os.Setenv("WORKOS_API_KEY", "test")
	_ = os.Setenv("WORKOS_CLIENT_ID", "test")

	// 2. Missing Email
	req = httptest.NewRequest(http.MethodGet, "/api/v1/auth/saml/signin", nil)
	w = serve(h, req)
	if w.Result().StatusCode != http.StatusBadRequest {
		t.Error("expected 400 for missing email")
	}

	// 3. SSO Not Enabled
	h.GetOrg = func(ctx context.Context, q *db.Queries, domain string) (*db.Organization, error) {
		return nil, nil
	}
	req = httptest.NewRequest(http.MethodGet, "/api/v1/auth/saml/signin?email=test@example.com", nil)
	w = serve(h, req)
	if w.Result().StatusCode != http.StatusBadRequest {
		t.Error("expected 400 for disabled sso")
	}

	// 4. Invalid Email
	req = httptest.NewRequest(http.MethodGet, "/api/v1/auth/saml/signin?email=invalid", nil)
	w = serve(h, req)
	if w.Result().StatusCode != http.StatusBadRequest {
		t.Error("expected 400 for invalid email")
	}

	// 5. GetOrg Error
	h.GetOrg = func(ctx context.Context, q *db.Queries, domain string) (*db.Organization, error) {
		return nil, errors.New("db error")
	}
	req = httptest.NewRequest(http.MethodGet, "/api/v1/auth/saml/signin?email=test@example.com", nil)
	w = serve(h, req)
	if w.Result().StatusCode != http.StatusInternalServerError {
		t.Error("expected 500 for db error")
	}
}

func TestSigninHandler_MethodNotAllowed(t *testing.T) {
	h := &SigninHandlerStruct{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/saml/signin?email=test@example.com", nil)
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	if w.Result().StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", w.Result().StatusCode)
	}
}

func TestGlobalSigninHandler(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/saml/signin?email=test@example.com", nil)
	w := httptest.NewRecorder()

	func() {
		defer func() { _ = recover() }()
		SigninHandler(w, req)
	}()
}
