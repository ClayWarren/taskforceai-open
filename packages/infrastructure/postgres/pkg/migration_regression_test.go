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

func infrastructureSQLFile(t *testing.T, parts ...string) string {
	t.Helper()
	_, here, _, _ := runtime.Caller(0)
	pathParts := append([]string{filepath.Dir(here), ".."}, parts...)
	contents, err := os.ReadFile(filepath.Clean(filepath.Join(pathParts...)))
	require.NoError(t, err)
	return string(contents)
}

func TestEmbeddedMigrationBaselineDoesNotRecreateDeveloperAPIKeys(t *testing.T) {
	baseline := infrastructureSQLFile(t, "pkg", "migrations", "000001_baseline.up.sql")
	second := infrastructureSQLFile(t, "pkg", "migrations", "000002_add_developer_api_keys.up.sql")

	assert.Contains(t, baseline, "CREATE TABLE developer_api_keys")
	assert.NotContains(t, second, "CREATE TABLE developer_api_keys")

	for _, table := range []string{
		"organizations",
		"memberships",
		"projects",
		"memories",
		"agents",
		"sync_audit_logs",
		"sync_devices",
	} {
		assert.Contains(t, second, "CREATE TABLE "+table, "migration 2 must create %s", table)
	}
}

func TestArtifactRollbackBreaksCurrentVersionCycleFirst(t *testing.T) {
	down := infrastructureSQLFile(t, "pkg", "migrations", "000016_add_artifacts.down.sql")
	dropConstraint := strings.Index(down, "DROP CONSTRAINT IF EXISTS artifacts_current_version_id_fkey")
	dropVersions := strings.Index(down, "DROP TABLE IF EXISTS artifact_versions")

	require.NotEqual(t, -1, dropConstraint)
	require.NotEqual(t, -1, dropVersions)
	assert.Less(t, dropConstraint, dropVersions)
}

func TestDeleteUserRemovesEveryNonCascadingOwnedTable(t *testing.T) {
	query := infrastructureSQLFile(t, "sqlc", "queries", "users.sql")

	for _, table := range []string{
		"conversations",
		"rate_limits",
		"tasks",
		"audit_logs",
		"sync_audit_logs",
		"sync_devices",
		"sync_push_results",
		"remote_targets",
		"remote_connections",
		"remote_device_credentials",
		"token_usage",
		"tool_usage",
		"usage_events",
		"execution_traces",
	} {
		assert.Contains(t, query, "DELETE FROM "+table, "DeleteUser must remove %s", table)
	}

	assert.Contains(t, query, "DELETE FROM users")
}

func TestSavingSyncPushResultsPerformsBoundedExpiryCleanup(t *testing.T) {
	query := infrastructureSQLFile(t, "sqlc", "queries", "sync_push_results.sql")

	assert.Contains(t, query, "WHERE expires_at <= NOW()")
	assert.Contains(t, query, "LIMIT 100")
	assert.Contains(t, query, "FOR UPDATE SKIP LOCKED")
	assert.Contains(t, query, "DELETE FROM sync_push_results AS results")
}
