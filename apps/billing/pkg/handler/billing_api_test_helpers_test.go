package handler

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/pashagolub/pgxmock/v4"
)

type billingAPITest struct {
	router *chi.Mux
	ctx    context.Context
}

func newBillingAPITest(t *testing.T, userID int) *billingAPITest {
	t.Helper()

	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("Test", "1.0.0"))
	RegisterBillingHandlers(api)

	user := &auth.AuthenticatedUser{ID: userID, Email: "test@example.com"}
	ctx := context.WithValue(context.Background(), adapterhandler.UserContextKey, user)

	return &billingAPITest{router: router, ctx: ctx}
}

func (h *billingAPITest) request(method, path string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil).WithContext(h.ctx)
	w := httptest.NewRecorder()
	h.router.ServeHTTP(w, req)
	return w
}

func (h *billingAPITest) postAutoRecharge(body io.Reader) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/billing/auto-recharge", body).WithContext(h.ctx)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.router.ServeHTTP(w, req)
	return w
}

func (h *billingAPITest) postJSON(path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body)).WithContext(h.ctx)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.router.ServeHTTP(w, req)
	return w
}

// swap sets *target to val for the duration of the test and restores the
// previous value on cleanup, collapsing `old:=X; X=val; t.Cleanup(restore)`.
func swap[T any](t *testing.T, target *T, val T) {
	t.Helper()
	old := *target
	*target = val
	t.Cleanup(func() { *target = old })
}

// restore snapshots *target now and restores it on cleanup without changing the
// current value. Use when the test assigns the var itself just after.
func restore[T any](t *testing.T, target *T) {
	t.Helper()
	old := *target
	t.Cleanup(func() { *target = old })
}

func withBillingQueries(t *testing.T, queries *db.Queries) {
	t.Helper()
	swap(t, &getQueries, func(ctx context.Context) (*db.Queries, error) {
		return queries, nil
	})
}

func withEmptyBillingQueries(t *testing.T) {
	t.Helper()
	withBillingQueries(t, &db.Queries{})
}

func withBillingQueriesError(t *testing.T, err error) {
	t.Helper()
	swap(t, &getQueries, func(ctx context.Context) (*db.Queries, error) {
		return nil, err
	})
}

func newBillingDBMock(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()

	dbMock := dbtest.NewMockPool(t)
	withBillingQueries(t, db.New(dbMock))
	return dbMock
}

// expectGetUserByID queues the canonical "select user by id" query, returning a
// single row built from u (via billingAPIUser).
func expectGetUserByID(dbMock pgxmock.PgxPoolIface, u dbtest.User) {
	dbMock.ExpectQuery("SELECT .* FROM users WHERE id =").
		WithArgs(int32(1)).
		WillReturnRows(dbtest.UserRow(billingAPIUser(u)))
}

func withStripeClient(t *testing.T, client StripeClient, err error) {
	t.Helper()
	swap(t, &newStripeClient, func() (StripeClient, error) {
		return client, err
	})
}

func newBillingStripeMock(t *testing.T) *mockStripeClient {
	t.Helper()

	mockStripe := new(mockStripeClient)
	withStripeClient(t, mockStripe, nil)
	return mockStripe
}

func resetPaymentProductsCache(t *testing.T) {
	t.Helper()
	productsCache.mu.Lock()
	productsCache.key = ""
	productsCache.expiresAt = time.Time{}
	productsCache.products = nil
	productsCache.mu.Unlock()
	t.Cleanup(func() {
		productsCache.mu.Lock()
		productsCache.key = ""
		productsCache.expiresAt = time.Time{}
		productsCache.products = nil
		productsCache.mu.Unlock()
	})
}
