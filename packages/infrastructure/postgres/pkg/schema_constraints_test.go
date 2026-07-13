package postgres

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// schemaSQL reads the schema.sql file relative to this test file.
func schemaSQL(t *testing.T) string {
	t.Helper()
	_, here, _, _ := runtime.Caller(0)
	root := filepath.Join(filepath.Dir(here), "..", "sqlc", "schema.sql")
	b, err := os.ReadFile(filepath.Clean(root))
	require.NoError(t, err, "could not read sqlc/schema.sql")
	return string(b)
}

// TestSchema_UniqueConstraints_BillingIDs verifies that partial-UNIQUE indexes
// exist for all Stripe / RevenueCat / API billing identifiers so that two users
// cannot share the same external billing ID (finding #2 & #7).
func TestSchema_UniqueConstraints_BillingIDs(t *testing.T) {
	sql := schemaSQL(t)

	required := []string{
		`"users_subscription_id_key"`,
		`"users_customer_id_key"`,
		`"users_revenuecat_app_user_id_key"`,
		`"users_mobile_original_transaction_id_key"`,
		`"users_api_subscription_id_key"`,
	}
	for _, idx := range required {
		assert.Contains(t, sql, idx,
			"schema.sql must contain UNIQUE index %s to prevent duplicate billing IDs", idx)
	}

	// All of these are partial indexes (WHERE … IS NOT NULL) so NULL values
	// stay allowed for users who have no subscription yet.
	assert.Contains(t, strings.ToUpper(sql), `WHERE "SUBSCRIPTION_ID" IS NOT NULL`,
		"users_subscription_id_key must be a partial index (WHERE subscription_id IS NOT NULL)")
	assert.Contains(t, strings.ToUpper(sql), `WHERE "CUSTOMER_ID" IS NOT NULL`,
		"users_customer_id_key must be a partial index (WHERE customer_id IS NOT NULL)")
}

// TestSchema_AgentsFK verifies that agents.user_id references users.id with
// ON DELETE CASCADE so that agents are purged when their owner is deleted
// (finding #3).
func TestSchema_AgentsFK(t *testing.T) {
	sql := schemaSQL(t)

	// The FK must be defined as an inline table constraint on the agents table.
	assert.Contains(t,
		sql, `"agents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE`,
		`schema.sql must declare agents_user_id_fkey with ON DELETE CASCADE`)
}

// TestSchema_PlanCheckConstraints verifies that users.plan and
// organizations.plan are constrained to known values so that typos or bad
// migrations cannot silently break billing-gate logic (finding #8).
func TestSchema_PlanCheckConstraints(t *testing.T) {
	sql := schemaSQL(t)

	// Both tables must have a named CHECK constraint.
	assert.Contains(t, sql, `"users_plan_check"`,
		"schema.sql must contain users_plan_check constraint")
	assert.Contains(t, sql, `"organizations_plan_check"`,
		"schema.sql must contain organizations_plan_check constraint")

	// The allowed plan values must include the canonical set.
	validPlans := []string{"'free'", "'pro'", "'super'", "'admin'"}
	for _, p := range validPlans {
		assert.Contains(t, sql, p,
			"plan CHECK constraint must include value %s", p)
	}
}

// TestSchema_AuditLogsOrgCompositeIndex verifies that there is a composite
// index on (organization_id, timestamp DESC) for efficient org-scoped audit
// queries (finding #9).
func TestSchema_AuditLogsOrgCompositeIndex(t *testing.T) {
	sql := schemaSQL(t)

	assert.Contains(t,
		sql, `"audit_logs_organization_id_timestamp_idx" ON "audit_logs" ("organization_id", "timestamp" DESC)`,
		"schema.sql must contain the composite audit_logs_organization_id_timestamp_idx index")
}
