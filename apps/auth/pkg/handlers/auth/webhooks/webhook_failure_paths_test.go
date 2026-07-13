package webhooks

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pashagolub/pgxmock/v4"
)

type deleteErrorReplayStore struct{}

func (deleteErrorReplayStore) SetNX(context.Context, string, []byte, time.Duration) (bool, error) {
	return true, nil
}

func (deleteErrorReplayStore) Set(context.Context, string, []byte, time.Duration) error {
	return nil
}

func (deleteErrorReplayStore) Del(context.Context, string) (bool, error) {
	return false, errors.New("delete failed")
}

type dbtxOnly struct {
	db.DBTX
}

func TestRecordWorkOSWebhookDeadLetterNoMeter(t *testing.T) {
	workOSWebhookTelemetryInst = workOSWebhookTelemetry{}
	workOSWebhookTelemetryOnce = sync.Once{}
	workOSWebhookTelemetryOnce.Do(func() {})
	t.Cleanup(resetWorkOSWebhookTelemetryForTest)
	recordWorkOSWebhookDeadLetter(context.Background(), "dsync.user.created", "test_reason")
}

func TestHandleApplyFailureLogsReplayDeleteError(t *testing.T) {
	h := &WorkOSWebhookHandlerStruct{ReplayStore: deleteErrorReplayStore{}}
	rr := httptest.NewRecorder()

	h.handleApplyFailure(
		context.Background(),
		rr,
		"evt_delete_error",
		errors.New("apply failed"),
		"apply_failed",
		"apply failed",
		func(context.Context, error, string) {},
	)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rr.Code)
	}
}

func TestHandleMembershipAddedPoolFallbackError(t *testing.T) {
	mockPool := dbtest.NewMockPool(t)
	workosID := "workos_pool"
	expectWebhookOrgRow(mockPool, workosID)

	original := getWebhookDBPool
	getWebhookDBPool = func(context.Context) (*pgxpool.Pool, error) {
		return nil, errors.New("pool unavailable")
	}
	t.Cleanup(func() { getWebhookDBPool = original })

	err := handleMembershipAdded(context.Background(), db.New(dbtxOnly{DBTX: mockPool}), "user@example.com", workosID)
	if err == nil {
		t.Fatal("expected pool error")
	}
	if err := mockPool.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestHandleMembershipAddedUserLookupError(t *testing.T) {
	mockPool := dbtest.NewMockPool(t)
	workosID := "workos_lookup"
	expectWebhookOrgRow(mockPool, workosID)
	mockPool.ExpectBeginTx(pgx.TxOptions{})
	mockPool.ExpectQuery(`SELECT .* FROM users WHERE email = \$1`).
		WithArgs("user@example.com").
		WillReturnError(errors.New("lookup failed"))
	mockPool.ExpectRollback()

	err := handleMembershipAdded(context.Background(), db.New(mockPool), "user@example.com", workosID)
	if err == nil {
		t.Fatal("expected lookup error")
	}
	if err := mockPool.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestHandleMembershipRemovedUserLookupError(t *testing.T) {
	mockPool := dbtest.NewMockPool(t)
	workosID := "workos_remove_lookup"
	expectWebhookOrgRow(mockPool, workosID)
	mockPool.ExpectQuery(`SELECT .* FROM users WHERE email = \$1`).
		WithArgs("user@example.com").
		WillReturnError(errors.New("lookup failed"))

	err := handleMembershipRemoved(context.Background(), db.New(mockPool), "user@example.com", workosID)
	if err == nil {
		t.Fatal("expected lookup error")
	}
	if err := mockPool.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func expectWebhookOrgRow(mockPool pgxmock.PgxPoolIface, workosID string) {
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	mockPool.ExpectQuery(`SELECT .* FROM organizations WHERE workos_organization_id = \$1`).
		WithArgs(pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "name", "slug", "domain", "created_at", "updated_at", "plan",
			"subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings",
		}).AddRow(
			int32(2), "Org", "org", nil, ts, ts, "free",
			nil, nil, nil, &workosID, false, []byte("{}"),
		))
}
