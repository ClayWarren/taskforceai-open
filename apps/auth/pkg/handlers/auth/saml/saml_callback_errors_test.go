package saml

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	ratelimit_mocks "github.com/TaskForceAI/auth-service/mocks/pkg/ratelimit"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	authhandler "github.com/TaskForceAI/auth-service/pkg/handler"
	stateutil "github.com/TaskForceAI/auth-service/pkg/handlers/auth/state"
	"github.com/TaskForceAI/auth-service/pkg/providers"
	"github.com/TaskForceAI/auth-service/pkg/ratelimit"
	"github.com/TaskForceAI/auth-service/pkg/testutils"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/mock"
	"github.com/workos/workos-go/v6/pkg/sso"
)

type failingSAMLStateReader struct{}

func (failingSAMLStateReader) Read([]byte) (int, error) {
	return 0, errors.New("entropy unavailable")
}

func TestSAMLHandlersHandleCORSPreflight(t *testing.T) {
	tests := []struct {
		name    string
		handler http.Handler
		path    string
	}{
		{
			name:    "callback",
			handler: &CallbackHandlerStruct{},
			path:    "/api/v1/auth/saml/callback",
		},
		{
			name:    "signin",
			handler: &SigninHandlerStruct{},
			path:    "/api/v1/auth/saml/signin",
		},
		{
			name:    "method",
			handler: &MethodHandlerStruct{},
			path:    "/api/v1/auth/login-method",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodOptions, tt.path, nil)
			rr := serve(tt.handler, req)
			if rr.Code != http.StatusNoContent {
				t.Fatalf("expected 204, got %d", rr.Code)
			}
		})
	}
}

func TestCallbackHandlerSignedStateAndSessionBranches(t *testing.T) {
	t.Run("invalid signed state", func(t *testing.T) {
		secret := "test_secret_must_be_long_enough_32_chars"
		t.Setenv("AUTH_SECRET", secret)
		stateParam, _, err := stateutil.BuildStatePayload("nonce", "/dashboard", secret)
		if err != nil {
			t.Fatalf("build state: %v", err)
		}
		tamperedTarget := base64.URLEncoding.EncodeToString([]byte("/admin"))
		req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/saml/callback?code=ok&state="+stateParam+"|"+tamperedTarget, nil)
		req.AddCookie(&http.Cookie{Name: "oauth_state", Value: stateParam})
		rr := serve(&CallbackHandlerStruct{WorkOS: &testutils.MockWorkOSClient{}}, req)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", rr.Code)
		}
	})

	t.Run("signed state split and full name", func(t *testing.T) {
		secret := "test_secret_must_be_long_enough_32_chars"
		t.Setenv("AUTH_SECRET", secret)
		t.Setenv("ALLOWED_REDIRECT_DOMAIN", "taskforceai.chat")
		t.Setenv("APP_URL", "https://www.taskforceai.chat")

		req := signedSAMLRequest(t, secret, "/dashboard")
		mockPool := dbtest.NewMockPool(t)
		expectSAMLTransactionWithOrgIDZero(mockPool, "org_full_name")
		expectSAMLAuditLog(mockPool)

		fullName := "SAML User"
		h := &CallbackHandlerStruct{
			WorkOS: &testutils.MockWorkOSClient{
				SSOProfile: sso.ProfileAndToken{Profile: sso.Profile{
					Email:          "full@example.com",
					OrganizationID: "org_full_name",
				}},
			},
			LinkUser: func(context.Context, *db.Queries, sso.Profile) (*auth.AuthUser, error) {
				return &auth.AuthUser{ID: 42, Email: "full@example.com", FullName: &fullName}, nil
			},
			GetQueries: func(context.Context) (*db.Queries, error) {
				return db.New(mockPool), nil
			},
		}

		rr := serve(h, req)
		if rr.Code != http.StatusFound {
			t.Fatalf("expected 302, got %d", rr.Code)
		}
		if err := mockPool.ExpectationsWereMet(); err != nil {
			t.Fatalf("unmet expectations: %v", err)
		}
	})

	t.Run("nil linked user", func(t *testing.T) {
		secret := "test_secret_must_be_long_enough_32_chars"
		t.Setenv("AUTH_SECRET", secret)
		req := requestWithState(t, "/api/v1/auth/saml/callback?code=ok")
		mockPool := dbtest.NewMockPool(t)
		mockPool.ExpectBeginTx(pgx.TxOptions{})
		mockPool.ExpectCommit()

		h := &CallbackHandlerStruct{
			WorkOS: &testutils.MockWorkOSClient{
				SSOProfile: sso.ProfileAndToken{Profile: sso.Profile{
					Email:          "nil@example.com",
					OrganizationID: "org_nil",
				}},
			},
			LinkUser: func(context.Context, *db.Queries, sso.Profile) (*auth.AuthUser, error) {
				return nil, nil
			},
			GetQueries: func(context.Context) (*db.Queries, error) {
				return db.New(mockPool), nil
			},
		}

		rr := serve(h, req)
		if rr.Code != http.StatusInternalServerError {
			t.Fatalf("expected 500, got %d", rr.Code)
		}
		if err := mockPool.ExpectationsWereMet(); err != nil {
			t.Fatalf("unmet expectations: %v", err)
		}
	})

	t.Run("MFA pending redirect", func(t *testing.T) {
		secret := "test_secret_must_be_long_enough_32_chars"
		t.Setenv("AUTH_SECRET", secret)
		t.Setenv("ALLOWED_REDIRECT_DOMAIN", "taskforceai.chat")
		t.Setenv("APP_URL", "https://www.taskforceai.chat")

		req := requestWithState(t, "/api/v1/auth/saml/callback?code=ok")
		mockPool := dbtest.NewMockPool(t)
		expectSAMLTransactionWithOrgIDZero(mockPool, "org_mfa")

		h := &CallbackHandlerStruct{
			WorkOS: &testutils.MockWorkOSClient{
				SSOProfile: sso.ProfileAndToken{Profile: sso.Profile{
					Email:          "mfa@example.com",
					OrganizationID: "org_mfa",
				}},
			},
			LinkUser: func(context.Context, *db.Queries, sso.Profile) (*auth.AuthUser, error) {
				return &auth.AuthUser{ID: 7, Email: "mfa@example.com", MFAEnabled: true}, nil
			},
			GetQueries: func(context.Context) (*db.Queries, error) {
				return db.New(mockPool), nil
			},
		}

		rr := serve(h, req)
		if rr.Code != http.StatusTemporaryRedirect {
			t.Fatalf("expected 307, got %d", rr.Code)
		}
		if err := mockPool.ExpectationsWereMet(); err != nil {
			t.Fatalf("unmet expectations: %v", err)
		}
	})

	t.Run("session token error", func(t *testing.T) {
		secret := "test_secret_must_be_long_enough_32_chars"
		t.Setenv("AUTH_SECRET", secret)
		t.Setenv("ALLOWED_REDIRECT_DOMAIN", "taskforceai.chat")
		t.Setenv("APP_URL", "https://www.taskforceai.chat")

		original := encodeSAMLSessionToken
		encodeSAMLSessionToken = func(auth.SessionUser, string, int) (string, error) {
			return "", errors.New("token failed")
		}
		t.Cleanup(func() { encodeSAMLSessionToken = original })

		req := requestWithState(t, "/api/v1/auth/saml/callback?code=ok")
		mockPool := dbtest.NewMockPool(t)
		expectSAMLTransactionWithOrgIDZero(mockPool, "org_token")

		h := &CallbackHandlerStruct{
			WorkOS: &testutils.MockWorkOSClient{
				SSOProfile: sso.ProfileAndToken{Profile: sso.Profile{
					Email:          "token@example.com",
					OrganizationID: "org_token",
				}},
			},
			LinkUser: func(context.Context, *db.Queries, sso.Profile) (*auth.AuthUser, error) {
				return &auth.AuthUser{ID: 8, Email: "token@example.com"}, nil
			},
			GetQueries: func(context.Context) (*db.Queries, error) {
				return db.New(mockPool), nil
			},
		}

		rr := serve(h, req)
		if rr.Code != http.StatusInternalServerError {
			t.Fatalf("expected 500, got %d", rr.Code)
		}
		if err := mockPool.ExpectationsWereMet(); err != nil {
			t.Fatalf("unmet expectations: %v", err)
		}
	})
}

func TestCallbackRateLimitAllowsMissingIP(t *testing.T) {
	mockRedis := new(ratelimit_mocks.RedisClient)
	h := &CallbackHandlerStruct{
		Limiter: ratelimit.NewRedisRateLimiter(mockRedis, ""),
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/saml/callback", nil)
	req.RemoteAddr = ""
	rr := httptest.NewRecorder()

	if h.writeRateLimitError(rr, req) {
		t.Fatal("expected missing IP to skip limiter")
	}
	mockRedis.AssertNotCalled(t, "Incr", mock.Anything, mock.Anything)
}

func TestSigninHandlerStateGenerationErrorsAndWrapperNilQueries(t *testing.T) {
	workosID := "org_saml"
	org := &db.Organization{WorkosOrganizationID: &workosID}

	t.Run("random failure", func(t *testing.T) {
		t.Setenv("WORKOS_API_KEY", "key")
		t.Setenv("WORKOS_CLIENT_ID", "client")
		original := stateRandomReader
		stateRandomReader = failingSAMLStateReader{}
		t.Cleanup(func() { stateRandomReader = original })

		h := &SigninHandlerStruct{
			WorkOS: &testutils.MockWorkOSClient{},
			GetOrg: func(context.Context, *db.Queries, string) (*db.Organization, error) {
				return org, nil
			},
			GetQueries: func(context.Context) (*db.Queries, error) {
				return &db.Queries{}, nil
			},
		}
		rr := serve(h, httptest.NewRequest(http.MethodGet, "/api/v1/auth/saml/signin?email=user@example.com", nil))
		if rr.Code != http.StatusInternalServerError {
			t.Fatalf("expected 500, got %d", rr.Code)
		}
	})

	t.Run("state payload failure", func(t *testing.T) {
		t.Setenv("WORKOS_API_KEY", "key")
		t.Setenv("WORKOS_CLIENT_ID", "client")
		original := buildStatePayload
		buildStatePayload = func(string, string, string) (string, string, error) {
			return "", "", errors.New("state failed")
		}
		t.Cleanup(func() { buildStatePayload = original })

		h := &SigninHandlerStruct{
			WorkOS: &testutils.MockWorkOSClient{},
			GetOrg: func(context.Context, *db.Queries, string) (*db.Organization, error) {
				return org, nil
			},
			GetQueries: func(context.Context) (*db.Queries, error) {
				return &db.Queries{}, nil
			},
		}
		rr := serve(h, httptest.NewRequest(http.MethodGet, "/api/v1/auth/saml/signin?email=user@example.com", nil))
		if rr.Code != http.StatusInternalServerError {
			t.Fatalf("expected 500, got %d", rr.Code)
		}
	})

	t.Run("wrapper nil queries", func(t *testing.T) {
		t.Setenv("WORKOS_API_KEY", "key")
		t.Setenv("WORKOS_CLIENT_ID", "client")
		originalFactory := signinWorkOSFactory
		signinWorkOSFactory = func(_, _ string) providers.WorkOSProvider {
			return &testutils.MockWorkOSClient{}
		}
		authhandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
			return nil, nil
		})
		t.Cleanup(func() {
			signinWorkOSFactory = originalFactory
			authhandler.SetQueriesOverride(nil)
		})

		rr := httptest.NewRecorder()
		SigninHandler(rr, httptest.NewRequest(http.MethodGet, "/api/v1/auth/saml/signin?email=user@example.com", nil))
		if rr.Code != http.StatusInternalServerError {
			t.Fatalf("expected 500, got %d", rr.Code)
		}
	})
}

func TestSAMLDataHelpersErrorBranches(t *testing.T) {
	t.Run("create user error", func(t *testing.T) {
		mockPool := dbtest.NewMockPool(t)
		workosID := "org_new_error"
		expectSAMLDomainOrgRow(mockPool, "example.com", workosID, 1)
		mockPool.ExpectQuery("SELECT (.+) FROM users WHERE email =").
			WithArgs("new-error@example.com").
			WillReturnError(pgx.ErrNoRows)
		mockPool.ExpectQuery("INSERT INTO users").
			WithArgs("new-error@example.com", pgxmock.AnyArg(), "free").
			WillReturnError(errors.New("insert failed"))

		user, err := linkOrCreateSAMLUser(context.Background(), db.New(mockPool), sso.Profile{
			Email:          "new-error@example.com",
			FirstName:      "New",
			LastName:       "Error",
			OrganizationID: workosID,
		})
		if err == nil {
			t.Fatal("expected error")
		}
		if user != nil {
			t.Fatalf("expected nil user, got %#v", user)
		}
		if err := mockPool.ExpectationsWereMet(); err != nil {
			t.Fatalf("unmet expectations: %v", err)
		}
	})

	t.Run("create membership error", func(t *testing.T) {
		mockPool := dbtest.NewMockPool(t)
		workosID := "org_create_error"
		ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
		expectSAMLOrgRow(mockPool, workosID, 5, ts)
		mockPool.ExpectQuery("SELECT (.+) FROM memberships").
			WithArgs(int32(5), int32(1)).
			WillReturnError(pgx.ErrNoRows)
		mockPool.ExpectQuery("INSERT INTO memberships").
			WithArgs(int32(5), int32(1), db.OrganizationRoleMEMBER).
			WillReturnError(errors.New("membership insert failed"))

		err := ensureSAMLMembership(context.Background(), db.New(mockPool), 1, workosID)
		if err == nil {
			t.Fatal("expected error")
		}
		if err := mockPool.ExpectationsWereMet(); err != nil {
			t.Fatalf("unmet expectations: %v", err)
		}
	})
}

func signedSAMLRequest(t *testing.T, secret string, target string) *http.Request {
	t.Helper()
	stateParam, fullState, err := stateutil.BuildStatePayload("nonce", target, secret)
	if err != nil {
		t.Fatalf("build state: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/saml/callback?code=ok&state="+fullState, nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: stateParam})
	return req
}

func expectSAMLTransactionWithOrgIDZero(mockPool pgxmock.PgxPoolIface, workosID string) {
	mockPool.ExpectBeginTx(pgx.TxOptions{})
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	expectSAMLOrgRow(mockPool, workosID, 0, ts)
	mockPool.ExpectCommit()
}

func expectSAMLOrgRow(mockPool pgxmock.PgxPoolIface, workosID string, orgID int32, ts pgtype.Timestamp) {
	mockPool.ExpectQuery("SELECT (.+) FROM organizations WHERE workos_organization_id").
		WithArgs(&workosID).
		WillReturnRows(pgxmock.NewRows(samlOrganizationColumns()).AddRow(
			orgID, "Org", "org", nil, ts, ts, "free",
			nil, nil, nil, &workosID, false, []byte("{}"),
		))
}

func expectSAMLDomainOrgRow(mockPool pgxmock.PgxPoolIface, domain string, workosID string, orgID int32) {
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	mockPool.ExpectQuery("SELECT (.+) FROM organizations WHERE domain").
		WithArgs(&domain).
		WillReturnRows(pgxmock.NewRows(samlOrganizationColumns()).AddRow(
			orgID, "Org", "org", &domain, ts, ts, "free",
			nil, nil, nil, &workosID, false, []byte("{}"),
		))
}

func samlOrganizationColumns() []string {
	return []string{
		"id", "name", "slug", "domain", "created_at", "updated_at", "plan",
		"subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings",
	}
}

func expectSAMLAuditLog(mockPool pgxmock.PgxPoolIface) {
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	mockPool.ExpectQuery("INSERT INTO audit_logs").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "timestamp", "user_id", "organization_id", "action", "resource", "resource_id",
			"ip_address", "user_agent", "details", "success", "error_message",
		}).AddRow(int32(1), ts, nil, nil, "LOGIN", "user", nil, nil, nil, []byte("{}"), true, nil))
}
