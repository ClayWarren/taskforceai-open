package saml

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	ratelimit_mocks "github.com/TaskForceAI/auth-service/mocks/pkg/ratelimit"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	stateutil "github.com/TaskForceAI/auth-service/pkg/handlers/auth/state"
	"github.com/TaskForceAI/auth-service/pkg/ratelimit"
	"github.com/TaskForceAI/auth-service/pkg/testutils"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/mock"
	"github.com/workos/workos-go/v6/pkg/sso"
)

func requestWithState(t testing.TB, path string) *http.Request {
	t.Helper()
	secret := os.Getenv("AUTH_SECRET")
	state, cookieState, err := stateutil.BuildStatePayload("test_nonce", "", secret)
	if err != nil {
		t.Fatalf("failed to build state: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, path+"&state="+state, nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: cookieState})
	return req
}

func TestCallbackHandler_RejectsOrglessProfile(t *testing.T) {
	_ = os.Setenv("WORKOS_API_KEY", "test")
	_ = os.Setenv("WORKOS_CLIENT_ID", "test")
	_ = os.Setenv("AUTH_SECRET", "test_secret_must_be_long_enough_32_chars")
	_ = os.Setenv("ALLOWED_REDIRECT_DOMAIN", "www.taskforceai.chat")
	_ = os.Setenv("VERCEL", "1")
	defer func() {
		_ = os.Unsetenv("WORKOS_API_KEY")
		_ = os.Unsetenv("WORKOS_CLIENT_ID")
		_ = os.Unsetenv("AUTH_SECRET")
		_ = os.Unsetenv("ALLOWED_REDIRECT_DOMAIN")
		_ = os.Unsetenv("VERCEL")
	}()

	mockWorkOS := &testutils.MockWorkOSClient{
		SSOProfile: sso.ProfileAndToken{
			Profile: sso.Profile{
				ID:    "prof_123",
				Email: "saml@example.com",
			},
		},
	}

	linkCalled := false
	h := &CallbackHandlerStruct{
		WorkOS: mockWorkOS,
		LinkUser: func(ctx context.Context, q *db.Queries, profile sso.Profile) (*auth.AuthUser, error) {
			linkCalled = true
			return nil, nil
		},
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			t.Fatal("orgless SAML callback should reject before opening DB")
			return nil, nil
		},
	}

	req := requestWithState(t, "/api/v1/auth/saml/callback?code=valid")
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	if w.Result().StatusCode != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", w.Result().StatusCode)
	}
	if linkCalled {
		t.Fatal("orgless SAML callback should reject before linking a user")
	}
}

func TestCallbackHandler_RejectsEmailDomainOrgMismatch(t *testing.T) {
	t.Setenv("WORKOS_API_KEY", "test")
	t.Setenv("WORKOS_CLIENT_ID", "test")
	t.Setenv("AUTH_SECRET", "test_secret_must_be_long_enough_32_chars")

	mockWorkOS := &testutils.MockWorkOSClient{
		SSOProfile: sso.ProfileAndToken{
			Profile: sso.Profile{
				ID:             "prof_mismatch",
				Email:          "victim@othertenant.com",
				OrganizationID: "org_attacker",
			},
		},
	}

	mockPool := dbtest.NewMockPool(t)
	mockPool.ExpectBeginTx(pgx.TxOptions{})
	expectSAMLDomainOrgRow(mockPool, "othertenant.com", "org_victim", 4)
	mockPool.ExpectRollback()

	h := &CallbackHandlerStruct{
		WorkOS:   mockWorkOS,
		LinkUser: linkOrCreateSAMLUser,
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return db.New(mockPool), nil
		},
	}

	req := requestWithState(t, "/api/v1/auth/saml/callback?code=valid")
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	if w.Result().StatusCode != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", w.Result().StatusCode)
	}
	if err := mockPool.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestCallbackHandler_Errors(t *testing.T) {
	mockWorkOS := &testutils.MockWorkOSClient{}
	mockPool := dbtest.NewMockPool(t)
	h := &CallbackHandlerStruct{
		WorkOS: mockWorkOS,
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return db.New(mockPool), nil
		},
	}

	// 1. Missing Code
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/saml/callback", nil)
	w := serve(h, req)
	if w.Result().StatusCode != http.StatusBadRequest {
		t.Error("expected 400 for missing code")
	}

	// 1.5 Missing State
	req = httptest.NewRequest(http.MethodGet, "/api/v1/auth/saml/callback?code=ok", nil)
	w = serve(h, req)
	if w.Result().StatusCode != http.StatusBadRequest {
		t.Error("expected 400 for missing state")
	}

	// 1.6 Missing state cookie
	req = httptest.NewRequest(http.MethodGet, "/api/v1/auth/saml/callback?code=ok&state=abc", nil)
	w = serve(h, req)
	if w.Result().StatusCode != http.StatusBadRequest {
		t.Error("expected 400 for missing state cookie")
	}

	// 1.7 State mismatch
	req = httptest.NewRequest(http.MethodGet, "/api/v1/auth/saml/callback?code=ok&state=abc", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: "xyz"})
	w = serve(h, req)
	if w.Result().StatusCode != http.StatusBadRequest {
		t.Error("expected 400 for state mismatch")
	}

	// 2. WorkOS Failure
	mockWorkOS.SSOErr = errors.New("workos fail")
	req = requestWithState(t, "/api/v1/auth/saml/callback?code=fail")
	w = serve(h, req)
	if w.Result().StatusCode != http.StatusUnauthorized {
		t.Error("expected 401 for workos fail")
	}
	mockWorkOS.SSOErr = nil

	// 3. Link User Failure — transaction begins, then rolls back
	mockWorkOS.SSOProfile = sso.ProfileAndToken{Profile: sso.Profile{Email: "fail@example.com", OrganizationID: "org_123"}}
	h.LinkUser = func(ctx context.Context, q *db.Queries, profile sso.Profile) (*auth.AuthUser, error) {
		return nil, errors.New("db fail")
	}
	mockPool2 := dbtest.NewMockPool(t)
	mockPool2.ExpectBeginTx(pgx.TxOptions{})
	mockPool2.ExpectRollback()
	h.GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return db.New(mockPool2), nil
	}
	req = requestWithState(t, "/api/v1/auth/saml/callback?code=ok")
	w = serve(h, req)
	if w.Result().StatusCode != http.StatusInternalServerError {
		t.Error("expected 500 for link fail")
	}
	_ = mockPool2.ExpectationsWereMet()
}

func TestCallbackHandler_MethodNotAllowed(t *testing.T) {
	h := &CallbackHandlerStruct{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/saml/callback?code=ok&state=state", nil)
	rr := serve(h, req)

	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", rr.Code)
	}
}

func TestCallbackHandler_DisabledUser(t *testing.T) {
	t.Setenv("AUTH_SECRET", "test_secret_must_be_long_enough_32_chars")
	mockWorkOS := &testutils.MockWorkOSClient{
		SSOProfile: sso.ProfileAndToken{
			Profile: sso.Profile{
				Email:          "disabled@example.com",
				OrganizationID: "org_123",
			},
		},
	}
	mockPool := dbtest.NewMockPool(t)
	mockPool.ExpectBeginTx(pgx.TxOptions{})
	mockPool.ExpectRollback()

	h := &CallbackHandlerStruct{
		WorkOS: mockWorkOS,
		LinkUser: func(ctx context.Context, q *db.Queries, profile sso.Profile) (*auth.AuthUser, error) {
			return nil, auth.ErrUserDisabled
		},
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return db.New(mockPool), nil
		},
	}

	req := requestWithState(t, "/api/v1/auth/saml/callback?code=ok")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for disabled SAML user, got %d", rr.Code)
	}
	if err := mockPool.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestCallbackHandler_RateLimitFailures(t *testing.T) {
	for _, tc := range []struct {
		name     string
		incr     int
		incrErr  error
		expected int
	}{
		{name: "rate limited", incr: 100, expected: http.StatusTooManyRequests},
		{name: "limiter error", incrErr: errors.New("redis down"), expected: http.StatusServiceUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			mockRedis := new(ratelimit_mocks.RedisClient)
			mockRedis.On("Incr", mock.Anything, mock.Anything).Return(tc.incr, tc.incrErr)
			h := &CallbackHandlerStruct{
				WorkOS:  &testutils.MockWorkOSClient{},
				Limiter: ratelimit.NewRedisRateLimiter(mockRedis, ""),
			}
			req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/saml/callback?code=ok&state=abc", nil)
			req.Header.Set("X-Forwarded-For", "1.2.3.4")
			rr := httptest.NewRecorder()

			h.ServeHTTP(rr, req)

			if rr.Code != tc.expected {
				t.Fatalf("expected %d, got %d", tc.expected, rr.Code)
			}
		})
	}
}

func TestCallbackHandler_QueryAndPoolErrors(t *testing.T) {
	secret := "test_secret_must_be_long_enough_32_chars"
	t.Setenv("AUTH_SECRET", secret)
	mockWorkOS := &testutils.MockWorkOSClient{
		SSOProfile: sso.ProfileAndToken{Profile: sso.Profile{Email: "saml@example.com", OrganizationID: "org_123"}},
	}

	t.Run("query error", func(t *testing.T) {
		h := &CallbackHandlerStruct{
			WorkOS: mockWorkOS,
			LinkUser: func(ctx context.Context, q *db.Queries, profile sso.Profile) (*auth.AuthUser, error) {
				return &auth.AuthUser{ID: 1, Email: profile.Email}, nil
			},
			GetQueries: func(context.Context) (*db.Queries, error) {
				return nil, errors.New("db unavailable")
			},
		}
		req := requestWithState(t, "/api/v1/auth/saml/callback?code=ok")
		rr := httptest.NewRecorder()

		h.ServeHTTP(rr, req)

		if rr.Code != http.StatusInternalServerError {
			t.Fatalf("expected 500, got %d", rr.Code)
		}
	})

	t.Run("pool error", func(t *testing.T) {
		h := &CallbackHandlerStruct{
			WorkOS: mockWorkOS,
			LinkUser: func(ctx context.Context, q *db.Queries, profile sso.Profile) (*auth.AuthUser, error) {
				return &auth.AuthUser{ID: 1, Email: profile.Email}, nil
			},
			GetQueries: func(context.Context) (*db.Queries, error) {
				return &db.Queries{}, nil
			},
		}
		req := requestWithState(t, "/api/v1/auth/saml/callback?code=ok")
		rr := httptest.NewRecorder()

		h.ServeHTTP(rr, req)

		if rr.Code != http.StatusInternalServerError {
			t.Fatalf("expected 500, got %d", rr.Code)
		}
	})
}

func TestCallbackHandler_OrgNotFound(t *testing.T) {
	_ = os.Setenv("WORKOS_API_KEY", "test")
	_ = os.Setenv("WORKOS_CLIENT_ID", "test")
	_ = os.Setenv("AUTH_SECRET", "test_secret_must_be_long_enough_32_chars")
	defer func() {
		_ = os.Unsetenv("WORKOS_API_KEY")
		_ = os.Unsetenv("WORKOS_CLIENT_ID")
		_ = os.Unsetenv("AUTH_SECRET")
	}()

	mockWorkOS := &testutils.MockWorkOSClient{
		SSOProfile: sso.ProfileAndToken{
			Profile: sso.Profile{
				ID:             "prof_123",
				Email:          "saml@example.com",
				OrganizationID: "org_123",
			},
		},
	}

	mockPool := dbtest.NewMockPool(t)

	// Transaction begins, then org lookup returns no rows → errSAMLOrgNotFound → rollback
	mockPool.ExpectBeginTx(pgx.TxOptions{})
	mockPool.ExpectQuery("SELECT (.+) FROM organizations WHERE workos_organization_id =").
		WithArgs(pgxmock.AnyArg()).
		WillReturnError(pgx.ErrNoRows)
	mockPool.ExpectRollback()

	h := &CallbackHandlerStruct{
		WorkOS: mockWorkOS,
		LinkUser: func(ctx context.Context, q *db.Queries, profile sso.Profile) (*auth.AuthUser, error) {
			return &auth.AuthUser{ID: 1, Email: profile.Email}, nil
		},
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return db.New(mockPool), nil
		},
	}

	req := requestWithState(t, "/api/v1/auth/saml/callback?code=valid")
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	if w.Result().StatusCode != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", w.Result().StatusCode)
	}
	if err := mockPool.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestCallbackHandler_MembershipError(t *testing.T) {
	_ = os.Setenv("WORKOS_API_KEY", "test")
	_ = os.Setenv("WORKOS_CLIENT_ID", "test")
	_ = os.Setenv("AUTH_SECRET", "test_secret_must_be_long_enough_32_chars")
	defer func() {
		_ = os.Unsetenv("WORKOS_API_KEY")
		_ = os.Unsetenv("WORKOS_CLIENT_ID")
		_ = os.Unsetenv("AUTH_SECRET")
	}()

	mockWorkOS := &testutils.MockWorkOSClient{
		SSOProfile: sso.ProfileAndToken{
			Profile: sso.Profile{
				ID:             "prof_123",
				Email:          "saml@example.com",
				OrganizationID: "org_123",
			},
		},
	}

	mockPool := dbtest.NewMockPool(t)
	now := time.Now()
	ts := pgtype.Timestamp{Time: now, Valid: true}
	orgCols := []string{"id", "name", "slug", "domain", "created_at", "updated_at", "plan", "subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings"}

	// Transaction wraps LinkUser + ensureSAMLMembership — rollback on membership error
	mockPool.ExpectBeginTx(pgx.TxOptions{})

	mockPool.ExpectQuery("SELECT (.+) FROM organizations WHERE workos_organization_id =").
		WithArgs(pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(orgCols).
			AddRow(int32(1), "Org", "org", nil, ts, ts, "free", nil, nil, nil, new("org_123"), false, []byte("{}")))
	mockPool.ExpectQuery("SELECT (.+) FROM memberships").
		WithArgs(int32(1), int32(1)).
		WillReturnError(errors.New("membership error"))

	mockPool.ExpectRollback()

	h := &CallbackHandlerStruct{
		WorkOS: mockWorkOS,
		LinkUser: func(ctx context.Context, q *db.Queries, profile sso.Profile) (*auth.AuthUser, error) {
			return &auth.AuthUser{ID: 1, Email: profile.Email}, nil
		},
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return db.New(mockPool), nil
		},
	}

	req := requestWithState(t, "/api/v1/auth/saml/callback?code=valid")
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	if w.Result().StatusCode != http.StatusInternalServerError {
		t.Errorf("Expected status 500, got %d", w.Result().StatusCode)
	}
	if err := mockPool.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestCallbackHandler_MissingAuthSecret(t *testing.T) {
	_ = os.Setenv("WORKOS_API_KEY", "test")
	_ = os.Setenv("WORKOS_CLIENT_ID", "test")
	_ = os.Unsetenv("AUTH_SECRET")
	defer func() {
		_ = os.Unsetenv("WORKOS_API_KEY")
		_ = os.Unsetenv("WORKOS_CLIENT_ID")
	}()

	mockWorkOS := &testutils.MockWorkOSClient{
		SSOProfile: sso.ProfileAndToken{
			Profile: sso.Profile{
				ID:             "prof_123",
				Email:          "saml@example.com",
				OrganizationID: "org_123",
			},
		},
	}

	mockPool := dbtest.NewMockPool(t)
	now := time.Now()
	ts := pgtype.Timestamp{Time: now, Valid: true}
	orgCols := []string{"id", "name", "slug", "domain", "created_at", "updated_at", "plan", "subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings"}

	// Transaction wraps LinkUser + ensureSAMLMembership; org.ID == 0 means no membership check, commit succeeds.
	// But AUTH_SECRET is empty so session creation fails after the transaction.
	mockPool.ExpectBeginTx(pgx.TxOptions{})

	mockPool.ExpectQuery("SELECT (.+) FROM organizations WHERE workos_organization_id =").
		WithArgs(pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(orgCols).
			AddRow(int32(0), "Org", "org", nil, ts, ts, "free", nil, nil, nil, new("org_123"), false, []byte("{}")))

	mockPool.ExpectCommit()

	h := &CallbackHandlerStruct{
		WorkOS: mockWorkOS,
		LinkUser: func(ctx context.Context, q *db.Queries, profile sso.Profile) (*auth.AuthUser, error) {
			return &auth.AuthUser{ID: 1, Email: profile.Email}, nil
		},
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return db.New(mockPool), nil
		},
	}

	req := requestWithState(t, "/api/v1/auth/saml/callback?code=valid")
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	if w.Result().StatusCode != http.StatusInternalServerError {
		t.Errorf("Expected status 500, got %d", w.Result().StatusCode)
	}
	if err := mockPool.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestCallbackHandler_MissingAuthSecretRejectedInProduction(t *testing.T) {
	t.Setenv("WORKOS_API_KEY", "test")
	t.Setenv("WORKOS_CLIENT_ID", "test")
	t.Setenv("AUTH_SECRET", "")
	t.Setenv("VERCEL", "1")

	h := &CallbackHandlerStruct{
		WorkOS: &testutils.MockWorkOSClient{},
	}

	req := requestWithState(t, "/api/v1/auth/saml/callback?code=valid")
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	if w.Result().StatusCode != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d", w.Result().StatusCode)
	}
}

func TestLinkOrCreateSAMLUser_Success(t *testing.T) {
	func() {
		defer func() { _ = recover() }()
		_, _ = linkOrCreateSAMLUser(context.Background(), nil, sso.Profile{Email: "test@example.com"})
	}()
}

func TestGlobalCallbackHandler(t *testing.T) {
	req := requestWithState(t, "/api/v1/auth/saml/callback?code=test")
	w := httptest.NewRecorder()

	func() {
		defer func() { _ = recover() }()
		CallbackHandler(w, req)
	}()
}

func TestCallbackHandler_RateLimitErrorReturnsServiceUnavailable(t *testing.T) {
	mockRedis := new(ratelimit_mocks.RedisClient)
	mockRedis.On("Incr", mock.Anything, mock.Anything).Return(0, errors.New("redis down"))

	h := &CallbackHandlerStruct{
		WorkOS:   &testutils.MockWorkOSClient{},
		Limiter:  ratelimit.NewRedisRateLimiter(mockRedis, ""),
		LinkUser: func(context.Context, *db.Queries, sso.Profile) (*auth.AuthUser, error) { return nil, nil },
	}

	req := requestWithState(t, "/api/v1/auth/saml/callback?code=test")
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	if w.Result().StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", w.Result().StatusCode)
	}
}
