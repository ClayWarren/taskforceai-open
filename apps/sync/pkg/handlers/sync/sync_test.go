package sync

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/pashagolub/pgxmock/v4"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/go-sync/pkg/sync"
)

func TestSyncStatus_Unauthorized(t *testing.T) {
	repo := &stubRepo{}
	service := sync.NewService(repo, nil, nil, nil, nil, nil)
	r := setupAPI(service, repo, nil)

	w := doRequest(r, http.MethodGet, "/api/v1/sync/status", nil)
	assert.Equal(t, http.StatusUnauthorized, w.Result().StatusCode)
}

func TestSyncStatus_WithUser(t *testing.T) {
	repo := &stubRepo{latestVersion: 7}
	service := sync.NewService(repo, nil, nil, nil, nil, nil)
	r := setupAPI(service, repo, testUser())

	w := doRequest(r, http.MethodGet, "/api/v1/sync/status", nil)
	assert.Equal(t, http.StatusOK, w.Result().StatusCode)
}

func TestSyncStatus_WithOrg(t *testing.T) {
	repo := &stubRepo{latestOrgVersion: 9}
	service := sync.NewService(repo, nil, nil, nil, nil, nil)

	mockPool, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mockPool.Close()
	q := db.New(mockPool)
	mockPool.ExpectQuery("SELECT (.+) FROM memberships").
		WithArgs(int32(2), int32(1)).
		WillReturnRows(pgxmock.NewRows([]string{"id", "organization_id", "user_id", "role", "created_at", "updated_at"}).
			AddRow(int32(1), int32(2), int32(1), "member", pgtype.Timestamp{Time: time.Now(), Valid: true}, pgtype.Timestamp{Time: time.Now(), Valid: true}))

	r := setupAPI(service, repo, &adapterauth.AuthenticatedUser{ID: 1, Email: "user@example.com"}, q)

	w := doRequest(r, http.MethodGet, "/api/v1/sync/status?organizationId=2", nil)
	assert.Equal(t, http.StatusOK, w.Result().StatusCode)
}

func TestSyncPull_Success(t *testing.T) {
	repo := &stubRepo{convCount: 0, msgCount: 0}
	service := sync.NewService(repo, nil, nil, nil, nil, nil)
	r := setupAPI(service, repo, testUser())

	body := `{"last_sync_version":0,"limit":10}`
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/pull", strings.NewReader(body))
	req.Header.Set("X-Device-Id", "device1")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Result().StatusCode)
	var response struct {
		Conversations []sync.ConversationSyncPayload `json:"conversations"`
		Messages      []sync.MessageSyncPayload      `json:"messages"`
		Deletions     []sync.DeletionRecord          `json:"deletions"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
	assert.NotNil(t, response.Conversations)
	assert.NotNil(t, response.Messages)
	assert.NotNil(t, response.Deletions)
}

func TestSyncPull_AllowsOversizedLastSyncVersion(t *testing.T) {
	repo := &stubRepo{convCount: 0, msgCount: 0}
	service := sync.NewService(repo, nil, nil, nil, nil, nil)
	r := setupAPI(service, repo, testUser())

	body := `{"last_sync_version":9223372036854775807,"limit":10}`
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/pull", strings.NewReader(body))
	req.Header.Set("X-Device-Id", "device1")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Result().StatusCode)
}

func TestSyncPull_RejectsMissingDeviceID(t *testing.T) {
	repo := &stubRepo{convCount: 0, msgCount: 0}
	service := sync.NewService(repo, nil, nil, nil, nil, nil)
	r := setupAPI(service, repo, testUser())

	body := `{"last_sync_version":12.75,"device_id":null,"limit":20.5}`
	w := doRequest(r, http.MethodPost, "/api/v1/sync/pull", strings.NewReader(body))
	assert.Equal(t, http.StatusBadRequest, w.Result().StatusCode)
}

func TestSyncPush_Success(t *testing.T) {
	repo := &stubRepo{}
	repo.devices = []sync.SyncDeviceRecord{{DeviceID: "device1", LastSeenAt: sync.Timestamp{Time: time.Now(), Valid: true}, CreatedAt: sync.Timestamp{Time: time.Now(), Valid: true}}}
	service := sync.NewService(repo, nil, nil, nil, nil, nil)
	r := setupAPI(service, repo, testUser())

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/push", strings.NewReader(`{"conversations":[],"messages":[],"deletions":[]}`))
	req.Header.Set("X-Device-Id", "device1")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Result().StatusCode)
}

func TestSyncPush_RejectsMissingDeviceID(t *testing.T) {
	repo := &stubRepo{}
	service := sync.NewService(repo, nil, nil, nil, nil, nil)
	r := setupAPI(service, repo, testUser())

	w := doRequest(r, http.MethodPost, "/api/v1/sync/push", strings.NewReader(`{"conversations":[],"messages":[],"deletions":[]}`))
	assert.Equal(t, http.StatusBadRequest, w.Result().StatusCode)
}

func TestSyncPush_RejectsUnsupportedResolutionStrategy(t *testing.T) {
	repo := &stubRepo{}
	service := sync.NewService(repo, nil, nil, nil, nil, nil)
	r := setupAPI(service, repo, testUser())

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/push", strings.NewReader(`{"resolution_strategy":"bogus","conversations":[],"messages":[],"deletions":[]}`))
	req.Header.Set("X-Device-Id", "device1")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusBadRequest, w.Result().StatusCode)
}

func TestSyncPush_RejectsConversationOrgWithoutTopLevelOrg(t *testing.T) {
	repo := &stubRepo{}
	repo.devices = []sync.SyncDeviceRecord{{DeviceID: "device1", LastSeenAt: sync.Timestamp{Time: time.Now(), Valid: true}, CreatedAt: sync.Timestamp{Time: time.Now(), Valid: true}}}
	service := sync.NewService(repo, nil, nil, nil, nil, nil)
	r := setupAPI(service, repo, testUser())

	body := `{"conversations":[{"id":0,"organization_id":2,"timestamp":"2026-01-01T00:00:00Z","user_input":"prompt","agent_count":1,"sync_version":1,"last_synced_at":"2026-01-01T00:00:00Z","is_deleted":false,"updated_at":"2026-01-01T00:00:00Z"}],"messages":[],"deletions":[]}`
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/push", strings.NewReader(body))
	req.Header.Set("X-Device-Id", "device1")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusBadRequest, w.Result().StatusCode)
}

func TestSyncPush_RejectsConversationOrgMismatch(t *testing.T) {
	repo := &stubRepo{}
	repo.devices = []sync.SyncDeviceRecord{{DeviceID: "device1", LastSeenAt: sync.Timestamp{Time: time.Now(), Valid: true}, CreatedAt: sync.Timestamp{Time: time.Now(), Valid: true}}}
	service := sync.NewService(repo, nil, nil, nil, nil, nil)
	r := setupAPI(service, repo, testUser())

	body := `{"organization_id":2,"conversations":[{"id":0,"organization_id":3,"timestamp":"2026-01-01T00:00:00Z","user_input":"prompt","agent_count":1,"sync_version":1,"last_synced_at":"2026-01-01T00:00:00Z","is_deleted":false,"updated_at":"2026-01-01T00:00:00Z"}],"messages":[],"deletions":[]}`
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/push", strings.NewReader(body))
	req.Header.Set("X-Device-Id", "device1")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusBadRequest, w.Result().StatusCode)
}

func TestListDevices_Success(t *testing.T) {
	repo := &stubRepo{devices: []sync.SyncDeviceRecord{{DeviceID: "device1", LastSeenAt: sync.Timestamp{Time: time.Now(), Valid: true}, CreatedAt: sync.Timestamp{Time: time.Now(), Valid: true}}}}
	service := sync.NewService(repo, nil, nil, nil, nil, nil)
	r := setupAPI(service, repo, testUser())

	w := doRequest(r, http.MethodGet, "/api/v1/sync/devices", nil)
	assert.Equal(t, http.StatusOK, w.Result().StatusCode)
}

func TestListDevices_Unauthorized(t *testing.T) {
	repo := &stubRepo{}
	service := sync.NewService(repo, nil, nil, nil, nil, nil)
	r := setupAPI(service, repo, nil)

	w := doRequest(r, http.MethodGet, "/api/v1/sync/devices", nil)
	assert.Equal(t, http.StatusUnauthorized, w.Result().StatusCode)
}

func TestRevokeDevice_Success(t *testing.T) {
	repo := &stubRepo{}
	service := sync.NewService(repo, nil, nil, nil, nil, nil)
	r := setupAPI(service, repo, testUser())

	w := doRequest(r, http.MethodDelete, "/api/v1/sync/devices/device1", nil)
	assert.Equal(t, http.StatusOK, w.Result().StatusCode)
}

func TestRevokeDevice_Unauthorized(t *testing.T) {
	repo := &stubRepo{}
	service := sync.NewService(repo, nil, nil, nil, nil, nil)
	r := setupAPI(service, repo, nil)

	w := doRequest(r, http.MethodDelete, "/api/v1/sync/devices/device1", nil)
	assert.Equal(t, http.StatusUnauthorized, w.Result().StatusCode)
}

func TestVerifyOrgMembership_DBError(t *testing.T) {
	err := verifyOrgMembership(context.Background(), nil, 1, 2)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "database unavailable")
}

func TestVerifyOrgMembership_Branches(t *testing.T) {
	err := verifyOrgMembership(context.Background(), db.New(nil), 0, 2)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid user ID 0")

	err = verifyOrgMembership(context.Background(), db.New(nil), int(^uint32(0))+1, 2)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "out of int32 range")

	mockPool, mockErr := pgxmock.NewPool()
	require.NoError(t, mockErr)
	defer mockPool.Close()
	mockPool.ExpectQuery("SELECT (.+) FROM memberships").
		WithArgs(int32(2), int32(1)).
		WillReturnRows(pgxmock.NewRows([]string{"id", "organization_id", "user_id", "role", "created_at", "updated_at"}).
			AddRow(int32(1), int32(2), int32(1), "member", pgtype.Timestamp{Time: time.Now(), Valid: true}, pgtype.Timestamp{Time: time.Now(), Valid: true}))
	assert.NoError(t, verifyOrgMembership(context.Background(), db.New(mockPool), 1, 2))
	assert.NoError(t, mockPool.ExpectationsWereMet())
}

func TestSyncPull_Unauthorized(t *testing.T) {
	r := setupAPI(nil, nil, nil)
	w := doRequest(r, http.MethodPost, "/api/v1/sync/pull", strings.NewReader(`{}`))
	assert.Equal(t, http.StatusUnauthorized, w.Result().StatusCode)
}

func TestSyncPull_InvalidOrgID(t *testing.T) {
	repo := &stubRepo{}
	r := setupAPI(nil, repo, testUser())

	body := `{"organization_id":"not-a-number"}`
	w := doRequest(r, http.MethodPost, "/api/v1/sync/pull", strings.NewReader(body))
	assert.NotEqual(t, http.StatusOK, w.Result().StatusCode)
}

type errorRepo struct {
	stubRepo
}

func (e *errorRepo) GetLatestSyncVersion(ctx context.Context, userID string) (int32, error) {
	e.latestUserID = userID
	return 0, assert.AnError
}

func TestSyncStatus_RepoError(t *testing.T) {
	repo := &errorRepo{}
	service := sync.NewService(repo, nil, nil, nil, nil, nil)
	r := setupAPI(service, repo, testUser())

	w := doRequest(r, http.MethodGet, "/api/v1/sync/status", nil)
	assert.Equal(t, http.StatusInternalServerError, w.Result().StatusCode)
}

func TestRegisterHandlersWithResolver(t *testing.T) {
	api := humachi.New(chi.NewRouter(), huma.DefaultConfig("Test", "1.0"))
	RegisterHandlersWithResolver(api, func(context.Context) (Dependencies, error) {
		return Dependencies{}, nil
	})
}

func TestNormalizePushResolutionStrategy_ValidExplicitStrategies(t *testing.T) {
	for _, strategy := range []sync.ResolutionStrategy{
		sync.StrategyServerWins,
		sync.StrategyClientWins,
		sync.StrategyAutoMerge,
	} {
		req := &SyncPushRequest{ResolutionStrategy: strategy}
		require.NoError(t, normalizePushResolutionStrategy(req))
		assert.Equal(t, strategy, req.ResolutionStrategy)
	}
}

func TestSyncPush_DepsError(t *testing.T) {
	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Test", "1.0"))
	RegisterHandlersWithResolver(api, func(ctx context.Context) (Dependencies, error) {
		return Dependencies{}, assert.AnError
	})

	w := httptest.NewRecorder()
	body := `{"conversations":[],"messages":[],"deletions":[]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/push", strings.NewReader(body))
	req.Header.Set("X-Device-Id", "d1")
	req.Header.Set("X-Sync-Id", "s1")
	ctx := context.WithValue(req.Context(), adapterhandler.UserContextKey, testUser())
	req = req.WithContext(ctx)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusServiceUnavailable, w.Result().StatusCode)
}

type errorService struct {
	SyncService
}

func (e *errorService) PushChanges(ctx context.Context, userID, deviceID, userAgent, idempotencyKey string, req sync.SyncPushRequest) (*sync.SyncPushResponse, error) {
	return nil, assert.AnError
}

func (e *errorService) PullChanges(ctx context.Context, userID, deviceID, userAgent string, req sync.SyncPullRequest) (*sync.SyncPullResponse, error) {
	return nil, assert.AnError
}

type revokedDeviceService struct {
	SyncService
}

func (s *revokedDeviceService) PushChanges(ctx context.Context, userID, deviceID, userAgent, idempotencyKey string, req sync.SyncPushRequest) (*sync.SyncPushResponse, error) {
	return nil, sync.ErrDeviceRevoked
}

func (s *revokedDeviceService) PullChanges(ctx context.Context, userID, deviceID, userAgent string, req sync.SyncPullRequest) (*sync.SyncPullResponse, error) {
	return nil, sync.ErrDeviceRevoked
}

type recordingPullService struct {
	SyncService
	req      sync.SyncPullRequest
	userID   string
	deviceID string
}

func (s *recordingPullService) PullChanges(ctx context.Context, userID, deviceID, userAgent string, req sync.SyncPullRequest) (*sync.SyncPullResponse, error) {
	s.req = req
	s.userID = userID
	s.deviceID = deviceID
	return &sync.SyncPullResponse{}, nil
}

type recordingPushService struct {
	SyncService
	req      sync.SyncPushRequest
	userID   string
	deviceID string
	err      error
}

func (s *recordingPushService) PushChanges(ctx context.Context, userID, deviceID, userAgent, idempotencyKey string, req sync.SyncPushRequest) (*sync.SyncPushResponse, error) {
	s.req = req
	s.userID = userID
	s.deviceID = deviceID
	if s.err != nil {
		return nil, s.err
	}
	return &sync.SyncPushResponse{
		Success:                true,
		Version:                3,
		NewVersion:             3,
		Accepted:               []string{"ok"},
		Conflicts:              []sync.ConflictRecord{{ID: "c1", Reason: "conflict"}},
		ConversationIDMappings: map[string]int32{},
	}, nil
}

type devicesService struct {
	SyncService
	listUserID   string
	revokeUserID string
	listErr      error
	revokeErr    error
}

func (s *devicesService) ListDevices(ctx context.Context, userID string) ([]sync.DeviceRecord, error) {
	s.listUserID = userID
	if s.listErr != nil {
		return nil, s.listErr
	}
	return []sync.DeviceRecord{{DeviceID: "device-1"}}, nil
}

func (s *devicesService) RevokeDevice(ctx context.Context, userID string, deviceID string) error {
	s.revokeUserID = userID
	return s.revokeErr
}

func TestHandleSyncPull_Branches(t *testing.T) {
	ctx := context.Background()

	_, err := handleSyncPull(ctx, func(context.Context) (Dependencies, error) {
		return Dependencies{}, assert.AnError
	}, &syncPullInput{AuthContext: adapterhandler.AuthContext{User: testUser()}})
	require.Error(t, err)

	_, err = handleSyncPull(ctx, func(context.Context) (Dependencies, error) {
		return Dependencies{}, nil
	}, &syncPullInput{AuthContext: adapterhandler.AuthContext{User: &adapterauth.AuthenticatedUser{}}})
	require.Error(t, err)

	invalidOrgID := math.Inf(1)
	_, err = handleSyncPull(ctx, func(context.Context) (Dependencies, error) {
		return Dependencies{}, nil
	}, &syncPullInput{
		Body:        &SyncPullRequest{OrganizationID: &invalidOrgID},
		AuthContext: adapterhandler.AuthContext{User: testUser()},
	})
	require.Error(t, err)

	orgID := float64(7)
	_, err = handleSyncPull(ctx, func(context.Context) (Dependencies, error) {
		return Dependencies{Queries: nil}, nil
	}, &syncPullInput{
		Body:        &SyncPullRequest{OrganizationID: &orgID},
		DeviceID:    "device-1",
		AuthContext: adapterhandler.AuthContext{User: &adapterauth.AuthenticatedUser{ID: 123, Email: "user@example.com"}},
	})
	require.Error(t, err)

	deviceID := " body-device "
	limit := float64(250)
	service := &recordingPullService{}
	resp, err := handleSyncPull(ctx, func(context.Context) (Dependencies, error) {
		return Dependencies{Service: service}, nil
	}, &syncPullInput{
		Body:        &SyncPullRequest{DeviceID: &deviceID, Limit: &limit},
		AuthContext: adapterhandler.AuthContext{User: testUser()},
	})
	require.NoError(t, err)
	assert.NotNil(t, resp)
	assert.Equal(t, "123", service.userID)
	assert.Equal(t, "body-device", service.deviceID)
	assert.Equal(t, int32(250), service.req.Limit)

	service = &recordingPullService{}
	negativeLimit := float64(-10)
	resp, err = handleSyncPull(ctx, func(context.Context) (Dependencies, error) {
		return Dependencies{Service: service}, nil
	}, &syncPullInput{
		Body:        &SyncPullRequest{DeviceID: &deviceID, Limit: &negativeLimit},
		AuthContext: adapterhandler.AuthContext{User: testUser()},
	})
	require.NoError(t, err)
	assert.NotNil(t, resp)
	assert.Equal(t, int32(100), service.req.Limit)

	service = &recordingPullService{}
	resp, err = handleSyncPull(ctx, func(context.Context) (Dependencies, error) {
		return Dependencies{Service: service}, nil
	}, &syncPullInput{
		DeviceID:    "header-device",
		AuthContext: adapterhandler.AuthContext{User: testUser()},
	})
	require.NoError(t, err)
	assert.NotNil(t, resp)
	assert.Equal(t, "123", service.userID)
	assert.Equal(t, int32(100), service.req.Limit)
	assert.Equal(t, "header-device", service.deviceID)
}

func TestDirectHandlers_Branches(t *testing.T) {
	ctx := context.Background()
	user := &adapterauth.AuthenticatedUser{ID: 123, Email: "user@example.com"}

	statusRepo := &stubRepo{latestVersion: 4}
	statusResp, err := handleSyncStatus(ctx, func(context.Context) (Dependencies, error) {
		return Dependencies{Repo: statusRepo}, nil
	}, &syncStatusInput{AuthContext: adapterhandler.AuthContext{User: user}})
	require.NoError(t, err)
	assert.Equal(t, int32(4), statusResp.Body["sync_version"])
	assert.Equal(t, "123", statusRepo.latestUserID)

	_, err = handleSyncStatus(ctx, func(context.Context) (Dependencies, error) {
		return Dependencies{}, nil
	}, &syncStatusInput{AuthContext: adapterhandler.AuthContext{User: &adapterauth.AuthenticatedUser{}}})
	require.Error(t, err)

	_, err = handleSyncStatus(ctx, func(context.Context) (Dependencies, error) {
		return Dependencies{Queries: nil}, nil
	}, &syncStatusInput{OrganizationID: 7, AuthContext: adapterhandler.AuthContext{User: user}})
	require.Error(t, err)

	mockPool, mockErr := pgxmock.NewPool()
	require.NoError(t, mockErr)
	defer mockPool.Close()
	mockPool.ExpectQuery("SELECT (.+) FROM memberships").
		WithArgs(int32(7), int32(123)).
		WillReturnRows(pgxmock.NewRows([]string{"id", "organization_id", "user_id", "role", "created_at", "updated_at"}).
			AddRow(int32(1), int32(7), int32(123), "member", pgtype.Timestamp{Time: time.Now(), Valid: true}, pgtype.Timestamp{Time: time.Now(), Valid: true}))
	statusCtx := context.WithValue(ctx, adapterhandler.UserContextKey, user)
	statusResp, err = handleSyncStatus(statusCtx, func(context.Context) (Dependencies, error) {
		return Dependencies{Repo: &stubRepo{latestOrgVersion: 9}, Queries: db.New(mockPool)}, nil
	}, &syncStatusInput{OrganizationID: 7, AuthContext: adapterhandler.AuthContext{User: user}})
	require.NoError(t, err)
	assert.Equal(t, int32(9), statusResp.Body["sync_version"])

	pushService := &recordingPushService{}
	deviceID := " body-device "
	pushResp, err := handleSyncPush(ctx, func(context.Context) (Dependencies, error) {
		return Dependencies{Service: pushService}, nil
	}, &syncPushInput{
		Body:        SyncPushRequest{DeviceID: deviceID},
		AuthContext: adapterhandler.AuthContext{User: user},
	})
	require.NoError(t, err)
	assert.True(t, pushResp.Body.Success)
	assert.Equal(t, "123", pushService.userID)
	assert.Equal(t, "body-device", pushService.deviceID)
	assert.Equal(t, sync.StrategyAutoMerge, pushService.req.ResolutionStrategy)

	_, err = handleSyncPush(ctx, func(context.Context) (Dependencies, error) {
		return Dependencies{Service: &recordingPushService{}}, nil
	}, &syncPushInput{
		Body:        SyncPushRequest{DeviceID: "device-1", ResolutionStrategy: sync.ResolutionStrategy("bogus")},
		AuthContext: adapterhandler.AuthContext{User: user},
	})
	require.Error(t, err)

	_, err = handleSyncPush(ctx, func(context.Context) (Dependencies, error) {
		return Dependencies{}, nil
	}, &syncPushInput{AuthContext: adapterhandler.AuthContext{User: &adapterauth.AuthenticatedUser{}}})
	require.Error(t, err)

	orgID := int32(7)
	_, err = handleSyncPush(ctx, func(context.Context) (Dependencies, error) {
		return Dependencies{Queries: nil}, nil
	}, &syncPushInput{
		Body:        SyncPushRequest{OrganizationID: &orgID},
		DeviceID:    "device-1",
		AuthContext: adapterhandler.AuthContext{User: user},
	})
	require.Error(t, err)

	mockPool.ExpectQuery("SELECT (.+) FROM memberships").
		WithArgs(int32(7), int32(123)).
		WillReturnRows(pgxmock.NewRows([]string{"id", "organization_id", "user_id", "role", "created_at", "updated_at"}).
			AddRow(int32(2), int32(7), int32(123), "member", pgtype.Timestamp{Time: time.Now(), Valid: true}, pgtype.Timestamp{Time: time.Now(), Valid: true}))
	pushService = &recordingPushService{}
	_, err = handleSyncPush(statusCtx, func(context.Context) (Dependencies, error) {
		return Dependencies{Service: pushService, Queries: db.New(mockPool)}, nil
	}, &syncPushInput{
		Body:        SyncPushRequest{OrganizationID: &orgID},
		DeviceID:    "device-1",
		AuthContext: adapterhandler.AuthContext{User: user},
	})
	require.NoError(t, err)
	assert.Equal(t, "123", pushService.userID)
	assert.Equal(t, &orgID, pushService.req.OrganizationID)

	_, err = handleSyncPush(ctx, func(context.Context) (Dependencies, error) {
		return Dependencies{Service: &recordingPushService{err: sync.ErrDeviceRevoked}}, nil
	}, &syncPushInput{DeviceID: "device-1", AuthContext: adapterhandler.AuthContext{User: user}})
	require.Error(t, err)

	_, err = handleListDevices(ctx, func(context.Context) (Dependencies, error) {
		return Dependencies{}, assert.AnError
	}, &listDevicesInput{AuthContext: adapterhandler.AuthContext{User: user}})
	require.Error(t, err)

	_, err = handleListDevices(ctx, func(context.Context) (Dependencies, error) {
		return Dependencies{}, nil
	}, &listDevicesInput{AuthContext: adapterhandler.AuthContext{User: &adapterauth.AuthenticatedUser{}}})
	require.Error(t, err)

	_, err = handleListDevices(ctx, func(context.Context) (Dependencies, error) {
		return Dependencies{Service: &devicesService{listErr: assert.AnError}}, nil
	}, &listDevicesInput{AuthContext: adapterhandler.AuthContext{User: user}})
	require.Error(t, err)

	listService := &devicesService{}
	listResp, err := handleListDevices(ctx, func(context.Context) (Dependencies, error) {
		return Dependencies{Service: listService}, nil
	}, &listDevicesInput{AuthContext: adapterhandler.AuthContext{User: user}})
	require.NoError(t, err)
	assert.Equal(t, "123", listService.listUserID)
	assert.Len(t, listResp.Body.Devices, 1)

	_, err = handleRevokeDevice(ctx, func(context.Context) (Dependencies, error) {
		return Dependencies{}, assert.AnError
	}, &revokeDeviceInput{RevokeDeviceRequest: RevokeDeviceRequest{DeviceID: "device-1"}, AuthContext: adapterhandler.AuthContext{User: user}})
	require.Error(t, err)

	_, err = handleRevokeDevice(ctx, func(context.Context) (Dependencies, error) {
		return Dependencies{}, nil
	}, &revokeDeviceInput{RevokeDeviceRequest: RevokeDeviceRequest{DeviceID: "device-1"}, AuthContext: adapterhandler.AuthContext{User: &adapterauth.AuthenticatedUser{}}})
	require.Error(t, err)

	_, err = handleRevokeDevice(ctx, func(context.Context) (Dependencies, error) {
		return Dependencies{Service: &devicesService{revokeErr: assert.AnError}}, nil
	}, &revokeDeviceInput{RevokeDeviceRequest: RevokeDeviceRequest{DeviceID: "device-1"}, AuthContext: adapterhandler.AuthContext{User: user}})
	require.Error(t, err)

	revokeService := &devicesService{}
	revokeResp, err := handleRevokeDevice(ctx, func(context.Context) (Dependencies, error) {
		return Dependencies{Service: revokeService}, nil
	}, &revokeDeviceInput{RevokeDeviceRequest: RevokeDeviceRequest{DeviceID: "device-1"}, AuthContext: adapterhandler.AuthContext{User: user}})
	require.NoError(t, err)
	assert.Equal(t, "123", revokeService.revokeUserID)
	assert.True(t, revokeResp.Body["success"])
	assert.NoError(t, mockPool.ExpectationsWereMet())
}

func TestSyncPush_ServiceError(t *testing.T) {
	repo := &stubRepo{}
	svc := &errorService{}
	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Test", "1.0"))
	RegisterHandlersWithResolver(api, func(ctx context.Context) (Dependencies, error) {
		return Dependencies{Service: svc, Repo: repo}, nil
	})

	w := httptest.NewRecorder()
	body := `{"conversations":[],"messages":[],"deletions":[]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/push", strings.NewReader(body))
	req.Header.Set("X-Device-Id", "d1")
	req.Header.Set("X-Sync-Id", "s1")
	ctx := context.WithValue(req.Context(), adapterhandler.UserContextKey, testUser())
	req = req.WithContext(ctx)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusInternalServerError, w.Result().StatusCode)
}

func TestSyncPull_ServiceError(t *testing.T) {
	repo := &stubRepo{}
	svc := &errorService{}
	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Test", "1.0"))
	RegisterHandlersWithResolver(api, func(ctx context.Context) (Dependencies, error) {
		return Dependencies{Service: svc, Repo: repo}, nil
	})

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/pull", strings.NewReader(`{}`))
	req.Header.Set("X-Device-Id", "device1")
	ctx := context.WithValue(req.Context(), adapterhandler.UserContextKey, testUser())
	req = req.WithContext(ctx)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusInternalServerError, w.Result().StatusCode)
}

func TestSyncPush_RevokedDeviceReturnsForbidden(t *testing.T) {
	repo := &stubRepo{}
	svc := &revokedDeviceService{}
	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Test", "1.0"))
	RegisterHandlersWithResolver(api, func(ctx context.Context) (Dependencies, error) {
		return Dependencies{Service: svc, Repo: repo}, nil
	})

	w := httptest.NewRecorder()
	body := `{"conversations":[],"messages":[],"deletions":[]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/push", strings.NewReader(body))
	req.Header.Set("X-Device-Id", "d1")
	ctx := context.WithValue(req.Context(), adapterhandler.UserContextKey, testUser())
	req = req.WithContext(ctx)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusForbidden, w.Result().StatusCode)
}

func TestSyncPull_RevokedDeviceReturnsForbidden(t *testing.T) {
	repo := &stubRepo{}
	svc := &revokedDeviceService{}
	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Test", "1.0"))
	RegisterHandlersWithResolver(api, func(ctx context.Context) (Dependencies, error) {
		return Dependencies{Service: svc, Repo: repo}, nil
	})

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/pull", strings.NewReader(`{}`))
	req.Header.Set("X-Device-Id", "device1")
	ctx := context.WithValue(req.Context(), adapterhandler.UserContextKey, testUser())
	req = req.WithContext(ctx)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusForbidden, w.Result().StatusCode)
}

func TestSyncStatus_DepsError(t *testing.T) {
	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Test", "1.0"))
	RegisterHandlersWithResolver(api, func(ctx context.Context) (Dependencies, error) {
		return Dependencies{}, assert.AnError
	})

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/sync/status", nil)
	ctx := context.WithValue(req.Context(), adapterhandler.UserContextKey, testUser())
	req = req.WithContext(ctx)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusServiceUnavailable, w.Result().StatusCode)
}

func TestListDevices_DepsError(t *testing.T) {
	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Test", "1.0"))
	RegisterHandlersWithResolver(api, func(ctx context.Context) (Dependencies, error) {
		return Dependencies{}, assert.AnError
	})

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/sync/devices", nil)
	ctx := context.WithValue(req.Context(), adapterhandler.UserContextKey, testUser())
	req = req.WithContext(ctx)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusServiceUnavailable, w.Result().StatusCode)
}

func TestRevokeDevice_DepsError(t *testing.T) {
	r := chi.NewRouter()
	api := humachi.New(r, huma.DefaultConfig("Test", "1.0"))
	RegisterHandlersWithResolver(api, func(ctx context.Context) (Dependencies, error) {
		return Dependencies{}, assert.AnError
	})

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/sync/devices/d1", nil)
	ctx := context.WithValue(req.Context(), adapterhandler.UserContextKey, testUser())
	req = req.WithContext(ctx)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusServiceUnavailable, w.Result().StatusCode)
}
