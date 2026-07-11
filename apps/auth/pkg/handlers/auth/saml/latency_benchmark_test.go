package saml

import (
	"context"
	"net/http"
	"sort"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/testutils"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/workos/workos-go/v6/pkg/sso"
)

func BenchmarkSAMLCallbackLatencyProfile(b *testing.B) {
	b.Setenv("WORKOS_API_KEY", "test")
	b.Setenv("WORKOS_CLIENT_ID", "test")
	b.Setenv("AUTH_SECRET", "test_secret_must_be_long_enough_32_chars")
	b.Setenv("ALLOWED_REDIRECT_DOMAIN", "www.taskforceai.chat")
	b.Setenv("APP_URL", "https://www.taskforceai.chat")

	workosID := "org_benchmark"
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	orgCols := []string{
		"id", "name", "slug", "domain", "created_at", "updated_at", "plan",
		"subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings",
	}
	handler := &CallbackHandlerStruct{
		WorkOS: &testutils.MockWorkOSClient{
			SSOProfile: sso.ProfileAndToken{
				Profile: sso.Profile{
					ID:             "profile_benchmark",
					Email:          "saml-benchmark@example.com",
					OrganizationID: workosID,
				},
			},
		},
		LinkUser: func(context.Context, *db.Queries, sso.Profile) (*auth.AuthUser, error) {
			return &auth.AuthUser{ID: 10, Email: "saml-benchmark@example.com"}, nil
		},
	}
	samples := make([]time.Duration, 0, b.N)

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		b.StopTimer()
		mockPool, err := pgxmock.NewPool()
		if err != nil {
			b.Fatalf("pgx mock: %v", err)
		}
		handler.GetQueries = func(context.Context) (*db.Queries, error) {
			return db.New(mockPool), nil
		}
		mockPool.ExpectBeginTx(pgx.TxOptions{})
		mockPool.ExpectQuery("SELECT (.+) FROM organizations WHERE workos_organization_id").
			WithArgs(&workosID).
			WillReturnRows(pgxmock.NewRows(orgCols).
				AddRow(int32(2), "Org", "org", nil, ts, ts, "free", nil, nil, nil, &workosID, false, []byte("{}")))
		mockPool.ExpectQuery("SELECT (.+) FROM memberships").
			WithArgs(int32(2), int32(10)).
			WillReturnError(pgx.ErrNoRows)
		mockPool.ExpectQuery("INSERT INTO memberships").
			WithArgs(int32(2), int32(10), db.OrganizationRoleMEMBER).
			WillReturnRows(pgxmock.NewRows([]string{"id", "organization_id", "user_id", "role", "created_at", "updated_at"}).
				AddRow(int32(99), int32(2), int32(10), db.OrganizationRoleMEMBER, ts, ts))
		mockPool.ExpectCommit()
		mockPool.ExpectQuery("INSERT INTO audit_logs").
			WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
			WillReturnRows(pgxmock.NewRows([]string{
				"id", "timestamp", "user_id", "organization_id", "action", "resource", "resource_id",
				"ip_address", "user_agent", "details", "success", "error_message",
			}).AddRow(int32(1), ts, nil, nil, "LOGIN", "user", nil, nil, nil, []byte("{}"), true, nil))
		req := requestWithState(b, "/api/v1/auth/saml/callback?code=valid")
		b.StartTimer()

		startedAt := time.Now()
		resp := serve(handler, req)
		samples = append(samples, time.Since(startedAt))
		if resp.Code != http.StatusFound {
			b.Fatalf("unexpected SAML callback status: %d", resp.Code)
		}
		b.StopTimer()
		if err := mockPool.ExpectationsWereMet(); err != nil {
			b.Fatalf("unmet pgx expectations: %v", err)
		}
		mockPool.Close()
	}
	b.StopTimer()
	reportSAMLCallbackLatencyProfile(b, samples)
}

func reportSAMLCallbackLatencyProfile(b *testing.B, samples []time.Duration) {
	b.Helper()
	if len(samples) == 0 {
		return
	}
	ordered := append([]time.Duration(nil), samples...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	b.ReportMetric(samlCallbackDurationMicroseconds(samlCallbackPercentileDuration(ordered, 0.50)), "p50_us")
	b.ReportMetric(samlCallbackDurationMicroseconds(samlCallbackPercentileDuration(ordered, 0.95)), "p95_us")
	b.ReportMetric(samlCallbackDurationMicroseconds(samlCallbackPercentileDuration(ordered, 0.99)), "p99_us")
}

func samlCallbackPercentileDuration(ordered []time.Duration, percentile float64) time.Duration {
	if len(ordered) == 0 {
		return 0
	}
	index := int(float64(len(ordered))*percentile + 0.999999)
	if index < 1 {
		index = 1
	}
	if index > len(ordered) {
		index = len(ordered)
	}
	return ordered[index-1]
}

func samlCallbackDurationMicroseconds(duration time.Duration) float64 {
	return float64(duration.Nanoseconds()) / 1000
}
