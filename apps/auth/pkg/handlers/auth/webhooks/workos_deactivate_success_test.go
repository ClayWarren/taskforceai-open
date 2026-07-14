package webhooks

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

func TestHandleUserDeactivated_Success(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	q := db.New(mock)

	workosID := "org_deactivate"
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	orgColumns := []string{
		"id", "name", "slug", "domain", "created_at", "updated_at", "plan",
		"subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings",
	}
	mock.ExpectQuery(`SELECT .* FROM organizations WHERE workos_organization_id`).
		WithArgs(&workosID).
		WillReturnRows(pgxmock.NewRows(orgColumns).
			AddRow(int32(7), "Org", "org", nil, ts, ts, "free", nil, nil, nil, &workosID, false, []byte("{}")))

	mock.ExpectQuery(`SELECT .* FROM users WHERE email`).
		WithArgs("deactivate@example.com").
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: 9, Email: "deactivate@example.com", Theme: "system", APITier: db.DeveloperApiTier("free"),
		}))
	mock.ExpectExec(`DELETE FROM memberships`).
		WithArgs(int32(7), int32(9)).
		WillReturnResult(pgxmock.NewResult("DELETE", 1))

	err := handleUserDeactivated(context.Background(), q, "deactivate@example.com", workosID)
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestWorkOSWebhook_ProductionWithoutReplayStore(t *testing.T) {
	t.Setenv("NODE_ENV", "production")

	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).
		Return(`{"id":"evt_prod","event":"unknown.event","organization_id":"org","data":{}}`, nil)

	h := &WorkOSWebhookHandlerStruct{
		Validator:   mockVal,
		ReplayStore: nil,
		GetQueries: func(context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(`{}`))
	rr := serve(h, req)
	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
}
