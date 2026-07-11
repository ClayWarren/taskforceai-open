package developer

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	devhandler "github.com/TaskForceAI/developer-service/pkg/handler"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"
)

func setupTestAPI(_ *testing.T, mock pgxmock.PgxPoolIface) *chi.Mux {
	r := chi.NewRouter()
	config := huma.DefaultConfig("Test API", "1.0.0")
	api := humachi.New(r, config)

	q := db.New(mock)

	RegisterKeysHandlers(api, q)
	RegisterUsageHandler(api, q)

	return r
}

// setDevAuth sets the X-User-Id / X-Email headers that withTestAuth reads to
// inject an authenticated user.
func setDevAuth(req *http.Request, userID string) {
	req.Header.Set("X-User-Id", userID)
	req.Header.Set("X-Email", "test@example.com")
}

func withTestAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Header.Set("X-Requested-With", "XMLHttpRequest")
		userIDRaw := r.Header.Get("X-User-Id")
		email := r.Header.Get("X-Email")
		if userIDRaw != "" && email != "" {
			userID, err := strconv.Atoi(userIDRaw)
			if err != nil {
				next.ServeHTTP(w, r)
				return
			}
			user := &auth.AuthenticatedUser{
				ID:    userID,
				Email: email,
			}
			ctx := context.WithValue(r.Context(), adapterhandler.UserContextKey, user)
			r = r.WithContext(ctx)
		}
		next.ServeHTTP(w, r)
	})
}

type developerEmailCall struct {
	ctxErr      error
	to          string
	displayName string
	keyName     string
	prefix      string
}

type recordingDeveloperKeyEmailService struct {
	created chan developerEmailCall
	revoked chan developerEmailCall
	err     error
}

func (s *recordingDeveloperKeyEmailService) SendApiKeyCreatedEmail(ctx context.Context, to, displayName, keyName, prefix string) error {
	if s.created != nil {
		s.created <- developerEmailCall{ctxErr: ctx.Err(), to: to, displayName: displayName, keyName: keyName, prefix: prefix}
	}
	return s.err
}

func (s *recordingDeveloperKeyEmailService) SendApiKeyRevokedEmail(ctx context.Context, to, displayName, keyName string) error {
	if s.revoked != nil {
		s.revoked <- developerEmailCall{ctxErr: ctx.Err(), to: to, displayName: displayName, keyName: keyName}
	}
	return s.err
}

//go:fix inline

func TestCreateKey_DbError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	r := setupTestAPI(t, mock)

	mock.ExpectQuery("SELECT .* FROM users WHERE id =").
		WithArgs(int32(1)).
		WillReturnRows(dbtest.UserRow(dbtest.DeveloperBillingUser(1, "test@example.com", 100)))

	mock.ExpectQuery("SELECT .* FROM developer_api_keys").
		WithArgs(int32(1)).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(0))

	mock.ExpectQuery("INSERT INTO developer_api_keys").
		WillReturnError(assert.AnError)

	body := map[string]string{"tier": "STARTER"}
	bodyBytes, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/keys", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	setDevAuth(req, "1")
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestCreateKey_GetQueriesError(t *testing.T) {
	origGetQueries := devhandler.GetQueries
	defer func() { devhandler.GetQueries = origGetQueries }()
	devhandler.GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return nil, assert.AnError
	}

	r := chi.NewRouter()
	config := huma.DefaultConfig("Test API", "1.0.0")
	api := humachi.New(r, config)
	RegisterKeysHandlers(api, nil)

	body := map[string]string{"tier": "STARTER"}
	bodyBytes, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/keys", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	setDevAuth(req, "1")
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

func TestCreateKey_GetUserByIDError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	r := setupTestAPI(t, mock)

	mock.ExpectQuery("SELECT .* FROM users WHERE id =").
		WithArgs(int32(1)).
		WillReturnError(assert.AnError)

	body := map[string]string{"tier": "STARTER"}
	bodyBytes, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/keys", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	setDevAuth(req, "1")
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestCreateKey_InvalidTier(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	r := setupTestAPI(t, mock)

	body := map[string]string{"tier": "INVALID"}
	bodyBytes, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/keys", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	setDevAuth(req, "1")
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnprocessableEntity, w.Code)
}

func TestCreateKey_KeyLimitReached(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	r := setupTestAPI(t, mock)

	mock.ExpectQuery("SELECT .* FROM users WHERE id =").
		WithArgs(int32(1)).
		WillReturnRows(dbtest.UserRow(dbtest.DeveloperBillingUser(1, "test@example.com", 100)))

	mock.ExpectQuery("SELECT .* FROM developer_api_keys").
		WithArgs(int32(1)).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(10))

	body := map[string]string{"tier": "STARTER"}
	bodyBytes, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/keys", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	setDevAuth(req, "1")
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestCreateKey_NilUserTier(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	r := setupTestAPI(t, mock)

	nilTierUser := dbtest.DeveloperBillingUser(1, "test@example.com", 100)
	nilTierUser.APITier = ""
	mock.ExpectQuery("SELECT .* FROM users WHERE id =").
		WithArgs(int32(1)).
		WillReturnRows(dbtest.UserRow(nilTierUser))

	mock.ExpectQuery("SELECT .* FROM developer_api_keys").
		WithArgs(int32(1)).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(0))

	mock.ExpectQuery("INSERT INTO developer_api_keys").
		WithArgs(int32(1), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), db.DeveloperApiTierSTARTER, pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(dbtest.APIKeyRow(dbtest.APIKey{
			ID: 1, UserID: 1, KeyHash: "hash", DisplayKey: "tfai_new",
			Tier: db.DeveloperApiTierSTARTER, HandlerStyle: true,
		}))

	body := map[string]string{}
	bodyBytes, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/keys", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	setDevAuth(req, "1")
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestCreateKey_Success(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	r := setupTestAPI(t, mock)

	mock.ExpectQuery("SELECT .* FROM users WHERE id =").
		WithArgs(int32(1)).
		WillReturnRows(dbtest.UserRow(dbtest.DeveloperBillingUser(1, "test@example.com", 100)))

	mock.ExpectQuery("SELECT .* FROM developer_api_keys").
		WithArgs(int32(1)).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(0))

	mock.ExpectQuery("INSERT INTO developer_api_keys").
		WithArgs(int32(1), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), db.DeveloperApiTierSTARTER, pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(dbtest.APIKeyRow(dbtest.APIKey{
			ID: 1, UserID: 1, KeyHash: "hash", DisplayKey: "tfai_new",
			Tier: db.DeveloperApiTierSTARTER, HandlerStyle: true,
		}))

	body := map[string]string{"tier": "STARTER"}
	bodyBytes, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/keys", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	setDevAuth(req, "1")
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestCreateKey_Unauthorized(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	r := setupTestAPI(t, mock)

	body := map[string]string{"tier": "STARTER"}
	bodyBytes, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/keys", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestCreateKey_UserIDTooLarge(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	r := chi.NewRouter()
	config := huma.DefaultConfig("Test API", "1.0.0")
	api := humachi.New(r, config)
	q := db.New(mock)
	RegisterKeysHandlers(api, q)

	body := map[string]string{"tier": "STARTER"}
	bodyBytes, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/keys", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	setDevAuth(req, "2147483648")
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestCreateKey_UserNotFound(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	r := setupTestAPI(t, mock)

	mock.ExpectQuery("SELECT .* FROM users WHERE id =").
		WithArgs(int32(1)).
		WillReturnError(pgx.ErrNoRows)

	body := map[string]string{"tier": "STARTER"}
	bodyBytes, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/keys", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	setDevAuth(req, "1")
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestCreateKey_WithEmailNotification(t *testing.T) {
	t.Setenv("RESEND_API_KEY", "test-key")
	created := make(chan developerEmailCall, 1)
	previousEmailService := newDeveloperEmailService
	newDeveloperEmailService = func() developerKeyEmailService {
		return &recordingDeveloperKeyEmailService{created: created}
	}
	t.Cleanup(func() { newDeveloperEmailService = previousEmailService })

	mock := dbtest.NewMockPool(t)

	r := setupTestAPI(t, mock)

	notifyUser := dbtest.DeveloperBillingUser(1, "test@example.com", 100)
	notifyUser.FullName = new("Test User")
	mock.ExpectQuery("SELECT .* FROM users WHERE id =").
		WithArgs(int32(1)).
		WillReturnRows(dbtest.UserRow(notifyUser))

	mock.ExpectQuery("SELECT .* FROM developer_api_keys").
		WithArgs(int32(1)).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(0))

	mock.ExpectQuery("INSERT INTO developer_api_keys").
		WithArgs(int32(1), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), db.DeveloperApiTierSTARTER, pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(dbtest.APIKeyRow(dbtest.APIKey{
			ID: 1, UserID: 1, KeyHash: "hash", DisplayKey: "tfai_new",
			Tier: db.DeveloperApiTierSTARTER, HandlerStyle: true,
		}))

	body := map[string]string{"tier": "STARTER"}
	bodyBytes, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/keys", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	setDevAuth(req, "1")
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	select {
	case call := <-created:
		require.NoError(t, call.ctxErr)
		assert.Equal(t, "test@example.com", call.to)
		assert.Equal(t, "test@example.com", call.displayName)
		assert.Equal(t, "New Key", call.keyName)
		assert.Regexp(t, `^tfai_[0-9a-f]{5}…[0-9a-f]{4}$`, call.prefix)
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for API key created email")
	}
}

func TestNewDeveloperEmailServiceDefault(t *testing.T) {
	// Exercise the default constructor (not the test override) so the wiring to
	// the real email service is covered.
	assert.NotNil(t, newDeveloperEmailService())
}

func TestSendDeveloperKeyCreatedEmail_LogsSendError(t *testing.T) {
	t.Setenv("RESEND_API_KEY", "test-key")
	created := make(chan developerEmailCall, 1)
	previousEmailService := newDeveloperEmailService
	newDeveloperEmailService = func() developerKeyEmailService {
		return &recordingDeveloperKeyEmailService{created: created, err: errors.New("send failed")}
	}
	t.Cleanup(func() { newDeveloperEmailService = previousEmailService })

	sendDeveloperKeyCreatedEmail(context.Background(), 1, "test@example.com", nil, "tfai_x")

	select {
	case <-created:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for API key created email")
	}
}

func TestSendDeveloperKeyRevokedEmail_LogsSendError(t *testing.T) {
	t.Setenv("RESEND_API_KEY", "test-key")
	revoked := make(chan developerEmailCall, 1)
	previousEmailService := newDeveloperEmailService
	newDeveloperEmailService = func() developerKeyEmailService {
		return &recordingDeveloperKeyEmailService{revoked: revoked, err: errors.New("send failed")}
	}
	t.Cleanup(func() { newDeveloperEmailService = previousEmailService })

	sendDeveloperKeyRevokedEmail(context.Background(), 1, "test@example.com", nil, "tfai_x")

	select {
	case <-revoked:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for API key revoked email")
	}
}

func TestSendDeveloperKeyCreatedEmail_DetachesCanceledRequestContext(t *testing.T) {
	t.Setenv("RESEND_API_KEY", "test-key")
	created := make(chan developerEmailCall, 1)
	previousEmailService := newDeveloperEmailService
	newDeveloperEmailService = func() developerKeyEmailService {
		return &recordingDeveloperKeyEmailService{created: created}
	}
	t.Cleanup(func() { newDeveloperEmailService = previousEmailService })

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	sendDeveloperKeyCreatedEmail(ctx, 1, "test@example.com", nil, "tfai_12345…abcd")

	select {
	case call := <-created:
		require.NoError(t, call.ctxErr)
		assert.Equal(t, "tfai_12345…abcd", call.prefix)
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for API key created email")
	}
}

func TestCreateKey_WithProTierDeniedForStarterUser(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	r := setupTestAPI(t, mock)

	mock.ExpectQuery("SELECT .* FROM users WHERE id =").
		WithArgs(int32(1)).
		WillReturnRows(dbtest.UserRow(dbtest.DeveloperBillingUser(1, "test@example.com", 100)))

	mock.ExpectQuery("SELECT .* FROM developer_api_keys").
		WithArgs(int32(1)).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(0))

	body := map[string]string{"tier": "PRO"}
	bodyBytes, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/keys", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	setDevAuth(req, "1")
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestCreateKey_InvalidStoredUserTier(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	r := setupTestAPI(t, mock)

	invalidTierUser := dbtest.DeveloperBillingUser(1, "test@example.com", 100)
	invalidTierUser.APITier = db.DeveloperApiTier("UNKNOWN")
	mock.ExpectQuery("SELECT .* FROM users WHERE id =").
		WithArgs(int32(1)).
		WillReturnRows(dbtest.UserRow(invalidTierUser))

	mock.ExpectQuery("SELECT .* FROM developer_api_keys").
		WithArgs(int32(1)).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(0))

	body := map[string]string{}
	bodyBytes, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/keys", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	setDevAuth(req, "1")
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestCreateKey_WithUserTier(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	r := setupTestAPI(t, mock)

	proUser := dbtest.DeveloperBillingUser(1, "test@example.com", 100)
	proUser.APITier = db.DeveloperApiTierPRO
	mock.ExpectQuery("SELECT .* FROM users WHERE id =").
		WithArgs(int32(1)).
		WillReturnRows(dbtest.UserRow(proUser))

	mock.ExpectQuery("SELECT .* FROM developer_api_keys").
		WithArgs(int32(1)).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(0))

	mock.ExpectQuery("INSERT INTO developer_api_keys").
		WithArgs(int32(1), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), db.DeveloperApiTierPRO, pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(dbtest.APIKeyRow(dbtest.APIKey{
			ID: 1, UserID: 1, KeyHash: "hash", DisplayKey: "tfai_new",
			Tier: db.DeveloperApiTierPRO, RateLimit: 5000, MonthlyQuota: 10_000_000, HandlerStyle: true,
		}))

	body := map[string]string{}
	bodyBytes, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/developer/keys", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	setDevAuth(req, "1")
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestDebugRouteNotRegisteredInHumaHandlers(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	r := setupTestAPI(t, mock)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/debug", nil)
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestGetDBQueries_WithNil(t *testing.T) {
	ctx := context.Background()
	q, err := getDBQueries(ctx, nil)
	require.Error(t, err)
	assert.Nil(t, q)
}

func TestGetDBQueries_WithProvided(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	q := db.New(mock)
	result, err := getDBQueries(context.Background(), q)
	require.NoError(t, err)
	assert.Equal(t, q, result)
}

func TestGetUsage_DbError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	r := setupTestAPI(t, mock)

	mock.ExpectQuery("SELECT .* FROM users WHERE id =").
		WithArgs(int32(1)).
		WillReturnError(assert.AnError)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/usage", nil)
	setDevAuth(req, "1")
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestGetUsage_GetQueriesError(t *testing.T) {
	origGetQueries := devhandler.GetQueries
	defer func() { devhandler.GetQueries = origGetQueries }()
	devhandler.GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return nil, assert.AnError
	}

	r := chi.NewRouter()
	config := huma.DefaultConfig("Test API", "1.0.0")
	api := humachi.New(r, config)
	RegisterUsageHandler(api, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/usage", nil)
	setDevAuth(req, "1")
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

func TestGetUsage_GetUserByIDError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	r := setupTestAPI(t, mock)

	mock.ExpectQuery("SELECT .* FROM users WHERE id =").
		WithArgs(int32(1)).
		WillReturnError(assert.AnError)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/usage", nil)
	setDevAuth(req, "1")
	w := httptest.NewRecorder()

	withTestAuth(r).ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestDeveloperEmailName_UsesFullName(t *testing.T) {
	fullName := "Test User"

	assert.Equal(t, "Test User", developerEmailName("test@example.com", &fullName))
	assert.Equal(t, "test@example.com", developerEmailName("test@example.com", nil))
}
