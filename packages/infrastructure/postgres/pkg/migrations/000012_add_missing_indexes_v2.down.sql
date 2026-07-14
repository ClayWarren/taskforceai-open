-- Reverse of 000012_add_missing_indexes_v2.up.sql
-- Only drop indexes that were newly added (not ones that already existed in baseline)

DROP INDEX IF EXISTS sync_audit_logs_user_id_idx;
DROP INDEX IF EXISTS sync_audit_logs_timestamp_idx;
DROP INDEX IF EXISTS sync_audit_logs_user_id_timestamp_idx;

DROP INDEX IF EXISTS memberships_user_id_idx;
DROP INDEX IF EXISTS memberships_organization_id_idx;

DROP INDEX IF EXISTS projects_user_id_idx;
DROP INDEX IF EXISTS projects_organization_id_idx;

DROP INDEX IF EXISTS memories_user_id_idx;
