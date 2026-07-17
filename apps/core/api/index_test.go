package handler

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	auditpkg "github.com/TaskForceAI/adapters/pkg/audit"
	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	conversationadapters "github.com/TaskForceAI/adapters/pkg/conversations"
	"github.com/TaskForceAI/adapters/pkg/db"
	handlerutil "github.com/TaskForceAI/adapters/pkg/handler"
	sharednotifications "github.com/TaskForceAI/adapters/pkg/notifications"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
	conversationspkg "github.com/TaskForceAI/core/pkg/conversations"
	"github.com/TaskForceAI/core/pkg/identity"
	notificationspkg "github.com/TaskForceAI/core/pkg/notifications"
	"github.com/TaskForceAI/core/pkg/platform"
	projectspkg "github.com/TaskForceAI/core/pkg/projects"
	"github.com/TaskForceAI/go-core/pkg/handlers/agents"
	handlerconversations "github.com/TaskForceAI/go-core/pkg/handlers/conversations"
	publicshare "github.com/TaskForceAI/go-core/pkg/handlers/public-share"
	"github.com/TaskForceAI/go-core/pkg/pulsebridge"
	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
)

type fakeDB struct{}

type recordingAuditRepo struct {
	writes []auditpkg.AuditLogWrite
}

func (r *recordingAuditRepo) CreateMany(ctx context.Context, data []auditpkg.AuditLogWrite) error {
	r.writes = append(r.writes, data...)
	return nil
}

func (r *recordingAuditRepo) Create(ctx context.Context, data auditpkg.AuditLogWrite) error {
	r.writes = append(r.writes, data)
	return nil
}

func (r *recordingAuditRepo) FindByUser(ctx context.Context, userID string, take int) ([]auditpkg.AuditLogRecord, error) {
	return nil, nil
}

func (r *recordingAuditRepo) FindByOrganization(ctx context.Context, orgID int32, take int) ([]auditpkg.AuditLogRecord, error) {
	return nil, nil
}

func (r *recordingAuditRepo) FindByResource(ctx context.Context, resource, resourceID string, take int) ([]auditpkg.AuditLogRecord, error) {
	return nil, nil
}

func (r *recordingAuditRepo) FindFailedLoginAttempts(ctx context.Context, hours, take int) ([]auditpkg.AuditLogRecord, error) {
	return nil, nil
}

func (r *recordingAuditRepo) FindForPeriod(ctx context.Context, startDate, endDate time.Time, actions []string) ([]auditpkg.AuditLogRecord, error) {
	return nil, nil
}

func setTestRedis(t *testing.T) {
	t.Helper()
	infraredis.SetClient(infraredis.NewMockClient())
	t.Cleanup(infraredis.ResetClient)
}

func serveGET(handler http.Handler, path string) *httptest.ResponseRecorder {
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func (fakeDB) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, nil
}

type fakeRows struct {
	pgx.Rows
}

func (fakeRows) Close() {}

func (fakeRows) Next() bool { return false }

func (fakeRows) Err() error { return nil }

func (fakeDB) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return fakeRows{}, nil
}

func (fakeDB) QueryRow(context.Context, string, ...any) pgx.Row {
	return nil
}

func TestNewRouter_NoDatabase(t *testing.T) {
	setTestRedis(t)
	t.Setenv("DATABASE_URL", "")
	t.Setenv("AUTH_SECRET", "test-auth-secret-32-characters-long!!")

	router, api, degraded := NewRouter()
	assert.NotNil(t, router)
	assert.NotNil(t, api)
	assert.True(t, degraded)

	resp := serveGET(router, "/api/v1/health")
	assert.Equal(t, http.StatusOK, resp.Code)

	deepReq := httptest.NewRequest(http.MethodGet, "/api/v1/health?deep=true", nil)
	deepReq = deepReq.WithContext(context.WithValue(
		deepReq.Context(),
		handlerutil.UserContextKey,
		&adapterauth.AuthenticatedUser{ID: 42},
	))
	deepResp := httptest.NewRecorder()
	router.ServeHTTP(deepResp, deepReq)
	assert.Equal(t, http.StatusOK, deepResp.Code)
}

func TestNewRouter_WithQueries(t *testing.T) {
	setTestRedis(t)
	old := getQueries
	getQueries = func(ctx context.Context) (*db.Queries, error) {
		return db.New(fakeDB{}), nil
	}
	t.Cleanup(func() { getQueries = old })

	t.Setenv("RESEND_API_KEY", "token")
	t.Setenv("DATABASE_URL", "unused")
	t.Setenv("PLAID_CLIENT_ID", "client-id")
	t.Setenv("PLAID_SECRET", "secret")

	router, api, degraded := NewRouter()
	assert.NotNil(t, router)
	assert.NotNil(t, api)
	assert.False(t, degraded)

	resp := serveGET(router, "/api/v1/models")
	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestNewRouter_ConfigLoadError(t *testing.T) {
	setTestRedis(t)
	oldQueries := getQueries
	getQueries = func(ctx context.Context) (*db.Queries, error) {
		return db.New(fakeDB{}), nil
	}
	t.Cleanup(func() { getQueries = oldQueries })

	oldLoadConfig := loadConfig
	loadConfig = func(string) (coreconfig.Config, error) {
		return coreconfig.Config{}, errors.New("config load failed")
	}
	t.Cleanup(func() { loadConfig = oldLoadConfig })

	router, api, degraded := NewRouter()
	assert.NotNil(t, router)
	assert.NotNil(t, api)
	assert.True(t, degraded)

	resp := serveGET(router, "/api/v1/models")
	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestNewRecoveringRouter_RebuildsAfterTransientDatabaseFailure(t *testing.T) {
	setTestRedis(t)
	oldQueries := getQueries
	calls := 0
	getQueries = func(ctx context.Context) (*db.Queries, error) {
		calls++
		if calls == 1 {
			return nil, errors.New("database warming up")
		}
		return db.New(fakeDB{}), nil
	}
	t.Cleanup(func() { getQueries = oldQueries })
	t.Setenv("DATABASE_URL", "unused")
	t.Setenv("RESEND_API_KEY", "token")

	router, api := NewRecoveringRouter()
	require.NotNil(t, api)
	resp := serveGET(router, "/api/v1/projects")

	assert.GreaterOrEqual(t, calls, 2)
	assert.NotEqual(t, http.StatusNotFound, resp.Code)
}

func TestHandler_WritesResponse(t *testing.T) {
	setTestRedis(t)
	t.Setenv("DATABASE_URL", "")

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/unknown", nil)
	resp := httptest.NewRecorder()

	Handler(resp, req)

	assert.Equal(t, http.StatusNotFound, resp.Code)
	assert.NotEmpty(t, resp.Header().Get("X-Content-Type-Options"))
}

func TestDegradedRouterStateServesCurrentMuxDuringRefresh(t *testing.T) {
	currentMux := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("current"))
	})
	refreshedMux := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("refreshed"))
	})
	refreshStarted := make(chan struct{})
	releaseRefresh := make(chan struct{})
	var refreshes atomic.Int32

	state := newDegradedRouterState(currentMux, true, time.Minute, func() (http.Handler, bool) {
		refreshes.Add(1)
		close(refreshStarted)
		<-releaseRefresh
		return refreshedMux, false
	})

	firstDone := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/first", nil)
		rec := httptest.NewRecorder()
		state.ServeHTTP(rec, req)
		firstDone <- rec
	}()

	<-refreshStarted

	secondReq := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/second", nil)
	secondRec := httptest.NewRecorder()
	state.ServeHTTP(secondRec, secondReq)

	assert.Equal(t, "current", secondRec.Body.String())
	assert.Equal(t, int32(1), refreshes.Load())

	close(releaseRefresh)
	firstRec := <-firstDone
	assert.Equal(t, "refreshed", firstRec.Body.String())
}

func TestHandler_ProxyPaths(t *testing.T) {
	setTestRedis(t)
	// We don't need real proxy targets, just triggering the paths
	paths := []string{
		"/api/auth/login",
		"/api/v1/auth/me",
		"/api/v1/sync",
		"/api/v1/sync/delta",
		"/api/v1/payments",
		"/api/v1/checkout",
		"/api/v1/run",
		"/api/v1/integrations",
		"/api/v1/stream",
		"/api/v1/developer",
	}

	for _, p := range paths {
		req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, p, nil)
		resp := httptest.NewRecorder()
		handled := handlerutil.ProxyCoreServiceRoute(resp, req)
		// Upstream responses vary by environment; this test only covers prefix matching.
		assert.True(t, handled, "Path %s should match a proxy route", p)
	}
}

func TestNewPulseBridgeProvider(t *testing.T) {
	t.Setenv("VERCEL", "1") // Skip start in Vercel to avoid background goroutines
	provider := newPulseBridgeProvider(&db.Queries{})
	assert.NotNil(t, provider)

	bridge, err := provider()
	require.NoError(t, err)
	assert.NotNil(t, bridge)

	// Calling twice should return same bridge (sync.Once)
	bridge2, err2 := provider()
	require.NoError(t, err2)
	assert.Equal(t, bridge, bridge2)
}

func TestNewPulseBridgeProvider_ReturnsStartError(t *testing.T) {
	setTestRedis(t)
	t.Setenv("VERCEL", "")

	q, backing := newQueuedQueries()
	backing.queryErr = errors.New("sync failed")
	provider := newPulseBridgeProvider(q)

	bridge, err := provider()
	require.Error(t, err)
	assert.Nil(t, bridge)
}

func TestNewAgentBridgeRegistryProvider(t *testing.T) {
	provider := newAgentBridgeRegistryProvider(func() (*pulsebridge.Bridge, error) {
		return pulsebridge.NewBridgeWithRedis(context.Background(), nil, nil, "http://engine.example.com", "token"), nil
	})

	bridge, err := provider()
	require.NoError(t, err)
	assert.IsType(t, pulseBridgeAdapter{}, bridge)

	expectedErr := errors.New("bridge unavailable")
	provider = newAgentBridgeRegistryProvider(func() (*pulsebridge.Bridge, error) {
		return nil, expectedErr
	})
	bridge, err = provider()
	require.ErrorIs(t, err, expectedErr)
	assert.Nil(t, bridge)
}

func TestHandler_RetriesRouterInitializationAfterDegradedStart(t *testing.T) {
	setTestRedis(t)
	t.Setenv("AUTH_SECRET", "test-auth-secret-32-characters-long!!")
	t.Setenv("RESEND_API_KEY", "token")

	oldQueries := getQueries
	queryCalls := 0
	getQueries = func(ctx context.Context) (*db.Queries, error) {
		queryCalls++
		if queryCalls == 1 {
			return nil, errors.New("db temporarily unavailable")
		}
		return db.New(fakeDB{}), nil
	}
	t.Cleanup(func() { getQueries = oldQueries })

	oldLoadConfig := loadConfig
	loadConfig = func(string) (coreconfig.Config, error) { return coreconfig.Config{}, nil }
	t.Cleanup(func() { loadConfig = oldLoadConfig })

	// Reset global handler state so this test starts from a cold boot.
	handlerMux = nil
	muxOnce = sync.Once{}

	req1 := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/health", nil)
	resp1 := httptest.NewRecorder()
	Handler(resp1, req1)
	assert.Equal(t, http.StatusOK, resp1.Code)

	req2 := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/models", nil)
	resp2 := httptest.NewRecorder()
	Handler(resp2, req2)
	assert.Equal(t, http.StatusOK, resp2.Code)
	assert.GreaterOrEqual(t, queryCalls, 2)
}

type queuedDB struct {
	queryRows [][]any
	rows      [][][]any
	queryErr  error
	execErr   error
}

func newQueuedQueries(queryRows ...[]any) (*db.Queries, *queuedDB) {
	store := &queuedDB{queryRows: queryRows}
	return db.New(store), store
}

func (d *queuedDB) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	if d.execErr != nil {
		return pgconn.CommandTag{}, d.execErr
	}
	return pgconn.NewCommandTag("UPDATE 2"), nil
}

func (d *queuedDB) Query(context.Context, string, ...any) (pgx.Rows, error) {
	if d.queryErr != nil {
		return nil, d.queryErr
	}
	if len(d.rows) == 0 {
		return &adapterRows{}, nil
	}
	next := d.rows[0]
	d.rows = d.rows[1:]
	return &adapterRows{rows: next}, nil
}

func (d *queuedDB) QueryRow(context.Context, string, ...any) pgx.Row {
	if len(d.queryRows) == 0 {
		return adapterRow{err: pgx.ErrNoRows}
	}
	next := d.queryRows[0]
	d.queryRows = d.queryRows[1:]
	return adapterRow{values: next}
}

type adapterRow struct {
	values []any
	err    error
}

func (r adapterRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	return scanValues(r.values, dest)
}

type adapterRows struct {
	rows   [][]any
	index  int
	closed bool
}

func (r adapterRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r adapterRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *adapterRows) Close()                                      { r.closed = true }
func (r adapterRows) Err() error                                   { return nil }
func (r adapterRows) Values() ([]any, error)                       { return r.rows[r.index-1], nil }
func (r adapterRows) RawValues() [][]byte                          { return nil }
func (r adapterRows) Conn() *pgx.Conn                              { return nil }

func (r *adapterRows) Next() bool {
	if r.index >= len(r.rows) {
		r.closed = true
		return false
	}
	r.index++
	return true
}

func (r *adapterRows) Scan(dest ...any) error {
	return scanValues(r.rows[r.index-1], dest)
}

func scanValues(values []any, dest []any) error {
	for i := range dest {
		target := reflect.ValueOf(dest[i]).Elem()
		value := reflect.ValueOf(values[i])
		if value.Type().AssignableTo(target.Type()) {
			target.Set(value)
			continue
		}
		if scanner, ok := dest[i].(sql.Scanner); ok {
			if err := scanner.Scan(values[i]); err != nil {
				return err
			}
			continue
		}
		target.Set(value)
	}
	return nil
}

func testTimestamp() pgtype.Timestamp {
	return pgtype.Timestamp{Time: time.Date(2026, 5, 21, 12, 0, 0, 0, time.UTC), Valid: true}
}

//go:fix inline
func int32Ptr(value int32) *int32 { return new(value) }

//go:fix inline
func subscriptionSourcePtr(value db.SubscriptionSource) *db.SubscriptionSource {
	return new(value)
}

func projectValues() []any {
	return []any{int32(10), int32(20), int32Ptr(30), "Project", new("desc"), new("custom"), testTimestamp(), testTimestamp()}
}

func conversationValues() []any {
	return []any{
		int32(12), testTimestamp(), new("user_1"), int32Ptr(30), "prompt", new("result"), new(1.5),
		new("model"), int32(2), int32Ptr(44), true, new("share_1"), testTimestamp(), []byte(`{}`), int32(7), testTimestamp(),
		new("device"), false, testTimestamp(),
	}
}

func agentValues() []any {
	return []any{
		"agent_1", int32(20), "Agent", new("desc"), new("avatar"), new("model"), true,
		"UTC", "09:00", "17:00", []int32{1, 2}, int32(15), testTimestamp(), testTimestamp(), "enabled",
		testTimestamp(), testTimestamp(),
	}
}

func userValues() []any {
	return []any{
		int32(20), "clay@example.com", new("Clay"), false, "system", true, true, true, true, true, false,
		false, (*string)(nil), pgtype.Timestamp{}, "pro", int32(5), testTimestamp(), true, new("sub"), new("active"), subscriptionSourcePtr(db.SubscriptionSourceSTRIPE), new("price"),
		new("visa"), new("4242"), testTimestamp(), testTimestamp(), false, testTimestamp(), new("cus"), new("rc"),
		new("tx"), new("mobile"), new("api_sub"), new("api_active"), db.DeveloperApiTierPRO,
		int32(1), int32(100), testTimestamp(), testTimestamp(), int32Ptr(1000), testTimestamp(), pgtype.Numeric{},
		true, pgtype.Numeric{}, pgtype.Numeric{},
	}
}

func auditLogValues() []any {
	return []any{int32(1), testTimestamp(), new("user_1"), int32Ptr(30), "read", "users", new("20"), new("127.0.0.1"), new("test"), []byte(`{"ok":true}`), true, (*string)(nil)}
}

func serviceIncidentValues() []any {
	return []any{int32(2), "core", "investigating", "message", testTimestamp(), pgtype.Timestamp{}}
}

func organizationValues() []any {
	return []any{int32(30), "TaskForceAI", "taskforceai", (*string)(nil), testTimestamp(), testTimestamp(), "pro", (*string)(nil), (*string)(nil), (*string)(nil), new("workos"), false, []byte(`{"rpmQuota":120}`)}
}

func messageValues() []any {
	return []any{
		int32(1), "msg_1", int32(12), "assistant", "hello", false, false, (*float64)(nil), testTimestamp(),
		(*string)(nil), []byte(`[]`), []byte(`[]`), []byte(`[]`), []byte(`{}`), int32(1), testTimestamp(),
		new("device"), false, testTimestamp(), int32(1), []byte(`{"trace":true}`),
	}
}

func TestProjectStoreAdapter_CoversQueriesAndMapping(t *testing.T) {
	q, backing := newQueuedQueries(projectValues(), projectValues())
	backing.rows = [][][]any{{projectValues()}, {projectValues()}}
	adapter := projectStoreAdapter{q: q}

	projects, err := adapter.GetProjectsByUser(context.Background(), 20)
	require.NoError(t, err)
	require.Len(t, projects, 1)
	assert.Equal(t, "Project", projects[0].Name)

	projects, err = adapter.GetProjectsByUserAndOrg(context.Background(), projectspkg.GetProjectsByUserAndOrgInput{UserID: 20, OrganizationID: int32Ptr(30)})
	require.NoError(t, err)
	require.Len(t, projects, 1)

	project, err := adapter.CreateProject(context.Background(), projectspkg.CreateProjectStoreInput{
		UserID: 20, OrganizationID: int32Ptr(30), Name: "Project", Description: new("desc"), CustomInstructions: new("custom"),
	})
	require.NoError(t, err)
	assert.Equal(t, int32(10), project.ID)

	project, err = adapter.UpdateProjectName(context.Background(), projectspkg.UpdateProjectInput{
		ID: 10, UserID: 20, OrganizationID: int32Ptr(30), Name: "Renamed",
	})
	require.NoError(t, err)
	assert.Equal(t, int32(10), project.ID)

	assert.NoError(t, adapter.DeleteProject(context.Background(), projectspkg.DeleteProjectInput{ID: 10, UserID: 20}))
	assert.NoError(t, adapter.DeleteProjectWithOrg(context.Background(), projectspkg.DeleteProjectWithOrgInput{ID: 10, UserID: 20, OrganizationID: int32Ptr(30)}))
}

func TestProjectAuditAdapter_CreatesAuditLog(t *testing.T) {
	repo := &recordingAuditRepo{}
	logger := auditpkg.NewAuditLogger(repo)
	t.Cleanup(logger.Reset)

	adapter := projectAuditAdapter{logger: logger}
	adapter.CreateAuditLog(projectspkg.AuditEntry{
		UserID:         new("user_1"),
		OrganizationID: int32Ptr(30),
		Action:         "CREATE",
		Resource:       "project",
		ResourceID:     new("10"),
		Success:        true,
	})
	logger.Flush()

	require.Len(t, repo.writes, 1)
	assert.Equal(t, "CREATE", repo.writes[0].Action)
	assert.Equal(t, "project", repo.writes[0].Resource)

	projectAuditAdapter{}.CreateAuditLog(projectspkg.AuditEntry{Action: "CREATE"})
}

func TestNotificationAdapter_CoversQueriesAndMapping(t *testing.T) {
	q, _ := newQueuedQueries()
	pushAdapter := sharednotifications.NewPushTokenStore(q)
	err := pushAdapter.UpsertPushToken(context.Background(), notificationspkg.UpsertPushTokenInput{
		Token: "token", Platform: "ios", DeviceID: new("device"), AppVersion: new("1.0.0"), UserID: 20, LastRegisteredAt: testTimestamp().Time,
	})
	require.NoError(t, err)
	rows, err := pushAdapter.DeletePushToken(context.Background(), notificationspkg.DeletePushTokenInput{UserID: 20, Token: "token"})
	require.NoError(t, err)
	assert.Equal(t, int64(2), rows)
}

func TestConversationAndShareAdapters_CoverQueriesAndMapping(t *testing.T) {
	q, backing := newQueuedQueries(
		[]any{int64(12)},
		[]any{int64(12)},
		conversationValues(),
		conversationValues(),
		conversationValues(),
		[]any{int32(12), true, new("share_1")},
		[]any{int32(12), true, new("share_1")},
		[]any{int32(12), "prompt", true, false, testTimestamp()},
	)
	backing.rows = [][][]any{{conversationValues()}, {conversationValues()}, {messageValues()}, {{"msg_1", "assistant", "hello", true, testTimestamp()}}}
	adapter := conversationadapters.NewStore(q)

	count, err := adapter.CountConversationsByUser(context.Background(), new("user_1"))
	require.NoError(t, err)
	assert.Equal(t, int64(12), count)

	count, err = adapter.CountConversationsByUserAndOrg(context.Background(), conversationspkg.CountConversationsByUserAndOrgInput{UserID: new("user_1"), OrganizationID: int32Ptr(30)})
	require.NoError(t, err)
	assert.Equal(t, int64(12), count)

	conversationsOut, err := adapter.GetConversationsByUser(context.Background(), conversationspkg.GetConversationsByUserInput{UserID: new("user_1"), Limit: 10})
	require.NoError(t, err)
	require.Len(t, conversationsOut, 1)

	conversationsOut, err = adapter.GetConversationsByUserAndOrg(context.Background(), conversationspkg.GetConversationsByUserAndOrgInput{UserID: new("user_1"), OrganizationID: int32Ptr(30), Limit: 10})
	require.NoError(t, err)
	require.Len(t, conversationsOut, 1)

	messagesOut, err := adapter.GetMessagesByConversation(context.Background(), 12)
	require.NoError(t, err)
	require.Len(t, messagesOut, 1)

	conversation, err := adapter.GetConversationByUserAndID(context.Background(), conversationspkg.GetConversationByUserAndIDInput{ID: 12, UserID: new("user_1")})
	require.NoError(t, err)
	assert.Equal(t, "prompt", conversation.UserInput)

	conversation, err = adapter.GetConversationByUserOrgAndID(context.Background(), conversationspkg.GetConversationByUserOrgAndIDInput{ID: 12, UserID: new("user_1"), OrganizationID: int32Ptr(30)})
	require.NoError(t, err)
	assert.Equal(t, "prompt", conversation.UserInput)

	conversation, err = adapter.CreateConversation(context.Background(), conversationspkg.CreateConversationStoreInput{UserID: new("user_1"), OrganizationID: int32Ptr(30), UserInput: "prompt", Model: new("model"), AgentCount: 2})
	require.NoError(t, err)
	assert.Equal(t, int32(12), conversation.ID)

	assert.NoError(t, adapter.UpdateConversation(context.Background(), conversationspkg.UpdateConversationStoreInput{ID: 12, UserID: new("user_1"), UserInput: new("prompt")}))
	assert.NoError(t, adapter.UpdateConversationWithOrg(context.Background(), conversationspkg.UpdateConversationWithOrgInput{ID: 12, UserID: new("user_1"), OrganizationID: int32Ptr(30), UserInput: new("prompt")}))
	assert.NoError(t, adapter.SoftDeleteConversation(context.Background(), conversationspkg.SoftDeleteConversationInput{ID: 12, UserID: new("user_1")}))
	assert.NoError(t, adapter.SoftDeleteConversationWithOrg(context.Background(), conversationspkg.SoftDeleteConversationWithOrgInput{ID: 12, UserID: new("user_1"), OrganizationID: int32Ptr(30)}))

	shareAdapter := conversationShareQueriesAdapter{q: q}
	shared, err := shareAdapter.UpdateConversationSharing(context.Background(), handlerconversations.UpdateConversationSharingInput{ID: 12, IsPublic: true, ShareID: new("share_1"), UserID: new("user_1")})
	require.NoError(t, err)
	assert.Equal(t, "share_1", *shared.ShareID)

	shared, err = shareAdapter.UpdateConversationSharingWithOrg(context.Background(), handlerconversations.UpdateConversationSharingWithOrgInput{ID: 12, IsPublic: true, ShareID: new("share_1"), UserID: new("user_1"), OrganizationID: int32Ptr(30)})
	require.NoError(t, err)
	assert.True(t, shared.IsPublic)

	publicAdapter := publicShareQueriesAdapter{q: q}
	publicConversation, err := publicAdapter.GetConversationByShareID(context.Background(), new("share_1"))
	require.NoError(t, err)
	assert.Equal(t, "prompt", publicConversation.UserInput)
	assert.True(t, publicConversation.HasPublicSharedAt)
	assert.Equal(t, testTimestamp().Time, publicConversation.PublicSharedAt)

	messages, err := publicAdapter.GetPublicMessagesByConversationID(context.Background(), publicshare.PublicMessagesInput{
		ConversationID: 12,
		PublicSharedAt: testTimestamp().Time,
	})
	require.NoError(t, err)
	require.Len(t, messages, 1)
}

func TestAgentAndPulseAdapters_CoverQueriesAndMapping(t *testing.T) {
	q, backing := newQueuedQueries(agentValues(), agentValues())
	backing.rows = [][][]any{{agentValues()}, {agentValues()}, {agentValues()}}
	adapter := q

	list, err := adapter.ListAgentsByUserID(context.Background(), 20)
	require.NoError(t, err)
	require.Len(t, list, 1)
	assert.Equal(t, "agent_1", list[0].ID)

	agent, err := adapter.GetAgent(context.Background(), "agent_1")
	require.NoError(t, err)
	assert.Equal(t, "Agent", agent.Name)

	agent, err = adapter.UpsertAgent(context.Background(), agents.UpsertAgentInput{
		ID: "agent_1", UserID: 20, Name: "Agent", Description: new("desc"), Avatar: new("avatar"), ModelID: new("model"),
		AutonomyEnabled: true, Timezone: "UTC", ActiveStart: "09:00", ActiveEnd: "17:00", ActiveDays: []int32{1, 2}, CheckInterval: 15, Status: "enabled",
	})
	require.NoError(t, err)
	assert.True(t, agent.AutonomyEnabled)

	pulseStore := pulseBridgeStoreAdapter{q: q}
	enabled, err := pulseStore.ListEnabledAgents(context.Background())
	require.NoError(t, err)
	require.Len(t, enabled, 1)

	due, err := pulseStore.ListAgentsDueForPulse(context.Background())
	require.NoError(t, err)
	require.Len(t, due, 1)
	claimed, err := pulseStore.ClaimAgentPulse(context.Background(), pulsebridge.ClaimAgentPulseInput{ID: "agent_1", NextRunAt: testTimestamp(), DueBefore: testTimestamp()})
	require.NoError(t, err)
	assert.True(t, claimed)
	assert.NoError(t, pulseStore.UpdateAgentPulseState(context.Background(), pulsebridge.UpdateAgentPulseStateInput{ID: "agent_1", LastRunAt: testTimestamp(), NextRunAt: testTimestamp()}))
	assert.NoError(t, pulseStore.UpdateAgentStatus(context.Background(), pulsebridge.UpdateAgentStatusInput{ID: "agent_1", Status: "enabled"}))

	bridge := pulsebridge.NewBridgeWithRedis(context.Background(), pulseStore, nil, "https://engine.example.com", "token")
	t.Cleanup(bridge.Stop)
	bridgeAdapter := pulseBridgeAdapter{bridge: bridge}
	require.NotPanics(t, func() {
		bridgeAdapter.RegisterAgent(agent)
		bridgeAdapter.UnregisterAgent(agent.ID)
	})
	nilBridgeAdapter := pulseBridgeAdapter{}
	require.NotPanics(t, func() {
		nilBridgeAdapter.RegisterAgent(agent)
		nilBridgeAdapter.UnregisterAgent(agent.ID)
	})
}

func TestGdprDownloadIdentityAndFeedbackAdapters_CoverQueriesAndMapping(t *testing.T) {
	q, backing := newQueuedQueries(
		userValues(),
		[]any{int32(1), int32(30), int32(20), db.OrganizationRoleADMIN, testTimestamp(), testTimestamp()},
		[]any{[]byte(`{"theme":"dark"}`)},
		[]any{int32(1), int32(30), int32(20), db.OrganizationRoleMEMBER, testTimestamp(), testTimestamp()},
	)
	backing.rows = [][][]any{{conversationValues()}, {{int32(1), int32(30), int32(20), db.OrganizationRoleMEMBER, testTimestamp(), testTimestamp(), "clay@example.com", new("Clay")}}}

	gdprAdapter := gdprStoreAdapter{q: q}
	user, err := gdprAdapter.GetUserByEmail(context.Background(), "clay@example.com")
	require.NoError(t, err)
	assert.Equal(t, "clay@example.com", user.Email)

	conversationsOut, err := gdprAdapter.GetConversationsByUser(context.Background(), platform.GetConversationsByUserInput{UserID: "user_1", Limit: 10})
	require.NoError(t, err)
	require.Len(t, conversationsOut, 1)
	assert.NoError(t, gdprAdapter.DeleteUser(context.Background(), 20))

	downloadAdapter := downloadStoreAdapter{q: q}
	assert.NoError(t, downloadAdapter.RecordDownload(context.Background(), platform.RecordDownloadInput{Product: "desktop", Platform: "mac", Version: "1.0.0"}))

	identityAdapter := identityStoreAdapter{q: q}
	membership, err := identityAdapter.GetMembership(context.Background(), identity.GetMembershipInput{OrganizationID: 30, UserID: 20})
	require.NoError(t, err)
	assert.Equal(t, "ADMIN", membership.Role)

	members, err := identityAdapter.GetOrganizationMembers(context.Background(), 30)
	require.NoError(t, err)
	require.Len(t, members, 1)
	settings, err := identityAdapter.GetOrganizationSettings(context.Background(), 30)
	require.NoError(t, err)
	assert.JSONEq(t, `{"theme":"dark"}`, string(settings))
	assert.NoError(t, identityAdapter.UpdateOrganizationSettings(context.Background(), identity.UpdateOrganizationSettingsInput{ID: 30, Settings: []byte(`{"theme":"light"}`)}))
	assert.NoError(t, identityAdapter.UpdateMembershipRole(context.Background(), identity.UpdateMembershipRoleInput{OrganizationID: 30, UserID: 20, Role: "MEMBER"}))
	assert.NoError(t, identityAdapter.DeleteMembership(context.Background(), identity.DeleteMembershipInput{OrganizationID: 30, UserID: 20}))

	feedbackAdapter := feedbackQueriesAdapter{q: q}
	affected, err := feedbackAdapter.UpdateMessageRating(context.Background(), handlerconversations.UpdateMessageRatingInput{MessageID: "msg_1", Rating: 1, UserID: new("user_1"), OrganizationID: 30})
	require.NoError(t, err)
	assert.Equal(t, int64(2), affected)
}

func TestGdprAndOwnerPreservingAdaptersCoverDirectQueries(t *testing.T) {
	q, _ := newQueuedQueries([]any{[]byte(`{"profile":{"email":"clay@example.com"}}`)})
	g := gdprStoreAdapter{q: q}
	exported, err := g.ExportUserData(context.Background(), 20)
	require.NoError(t, err)
	assert.Equal(t, "clay@example.com", exported["profile"].(map[string]any)["email"])

	invalidQ, _ := newQueuedQueries([]any{[]byte(`{`)})
	_, err = (gdprStoreAdapter{q: invalidQ}).ExportUserData(context.Background(), 20)
	require.Error(t, err)
	missingQ, _ := newQueuedQueries()
	_, err = (gdprStoreAdapter{q: missingQ}).ExportUserData(context.Background(), 20)
	require.ErrorIs(t, err, pgx.ErrNoRows)

	identityAdapter := identityStoreAdapter{q: q}
	_, err = identityAdapter.UpdateMembershipRolePreservingOwners(context.Background(), identity.UpdateMembershipRoleInput{
		OrganizationID: 30, UserID: 20, Role: "MEMBER",
	})
	require.Error(t, err)
	_, err = identityAdapter.DeleteMembershipPreservingOwners(context.Background(), identity.DeleteMembershipInput{
		OrganizationID: 30, UserID: 20,
	})
	require.Error(t, err)
}
