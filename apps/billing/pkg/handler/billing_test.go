package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/billing-service/pkg/billing"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
)

type fakeMobileSubscriptionService struct {
	result         *billing.MobileSyncResult
	err            error
	userID         *int
	appUserID      *string
	appUserIDs     *[]string
	appSyncErr     billing.MobileSyncError
	appSyncErrByID map[string]billing.MobileSyncError
}

func (f fakeMobileSubscriptionService) SyncMobileSubscriptionByUserID(ctx context.Context, userID int) (*billing.MobileSyncResult, error) {
	if f.userID != nil {
		*f.userID = userID
	}
	return f.result, f.err
}

func (f fakeMobileSubscriptionService) SyncMobileSubscriptionByAppUserID(ctx context.Context, appUserID string) (*billing.MobileSyncResult, billing.MobileSyncError) {
	if f.appUserID != nil {
		*f.appUserID = appUserID
	}
	if f.appUserIDs != nil {
		*f.appUserIDs = append(*f.appUserIDs, appUserID)
	}
	if f.appSyncErrByID != nil {
		return f.result, f.appSyncErrByID[appUserID]
	}
	return f.result, f.appSyncErr
}

func TestMobileSyncRoute_DBError(t *testing.T) {
	restore(t, &getQueries)
	getQueries = func(ctx context.Context) (*db.Queries, error) {
		return nil, errors.New("db connection failure")
	}

	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("test", "1.0.0"))
	RegisterBillingHandlers(api)

	user := &auth.AuthenticatedUser{ID: 1}
	ctx := context.WithValue(context.Background(), adapterhandler.UserContextKey, user)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/mobile/sync", nil).WithContext(ctx)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
	assert.Contains(t, w.Body.String(), "Database unavailable")
}

func TestMobileSyncRoute_ServiceError(t *testing.T) {
	restore(t, &getQueries)
	getQueries = func(ctx context.Context) (*db.Queries, error) {
		return &db.Queries{}, nil
	}

	restore(t, &NewMobileSubscriptionService)
	NewMobileSubscriptionService = func(repo billing.MobileSubscriptionRepository) MobileSubscriptionService {
		return fakeMobileSubscriptionService{err: errors.New("sync failed internal")}
	}

	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("test", "1.0.0"))
	RegisterBillingHandlers(api)

	user := &auth.AuthenticatedUser{ID: 1}
	ctx := context.WithValue(context.Background(), adapterhandler.UserContextKey, user)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/mobile/sync", nil).WithContext(ctx)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
	assert.Contains(t, w.Body.String(), "Sync failed")
}

func TestMobileSyncRoute_Success(t *testing.T) {
	restore(t, &getQueries)
	getQueries = func(ctx context.Context) (*db.Queries, error) {
		return &db.Queries{}, nil
	}

	restore(t, &NewMobileSubscriptionService)
	NewMobileSubscriptionService = func(repo billing.MobileSubscriptionRepository) MobileSubscriptionService {
		activeStr := "active"
		return fakeMobileSubscriptionService{
			result: &billing.MobileSyncResult{
				Plan:               "pro",
				SubscriptionStatus: &activeStr,
			},
		}
	}

	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("test", "1.0.0"))
	RegisterBillingHandlers(api)

	user := &auth.AuthenticatedUser{ID: 1}
	ctx := context.WithValue(context.Background(), adapterhandler.UserContextKey, user)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/mobile/sync", nil).WithContext(ctx)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), `"plan":"pro"`)
	assert.Contains(t, w.Body.String(), `"subscription_status":"active"`)
}
