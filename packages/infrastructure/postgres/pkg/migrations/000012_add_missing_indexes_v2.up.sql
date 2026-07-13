-- sync_audit_logs: queried by user_id + timestamp for audit trails
CREATE INDEX IF NOT EXISTS sync_audit_logs_user_id_idx ON sync_audit_logs (user_id);
CREATE INDEX IF NOT EXISTS sync_audit_logs_timestamp_idx ON sync_audit_logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS sync_audit_logs_user_id_timestamp_idx ON sync_audit_logs (user_id, timestamp DESC);

-- organizations: queried by slug (lookups), workos_organization_id (SSO)
-- Note: organizations_slug_key and organizations_workos_organization_id_key already exist in baseline
-- but we ensure they exist here for safety
CREATE UNIQUE INDEX IF NOT EXISTS organizations_slug_key ON organizations (slug);
CREATE UNIQUE INDEX IF NOT EXISTS organizations_workos_organization_id_key
ON organizations (workos_organization_id)
WHERE workos_organization_id IS NOT NULL;

-- memberships: queried by user_id (what orgs do I belong to), org_id + user_id (membership check)
CREATE INDEX IF NOT EXISTS memberships_user_id_idx ON memberships (user_id);
CREATE INDEX IF NOT EXISTS memberships_organization_id_idx ON memberships (organization_id);
-- Note: memberships_organization_id_user_id_key already exists in baseline
CREATE UNIQUE INDEX IF NOT EXISTS memberships_organization_id_user_id_key ON memberships (organization_id, user_id);

-- projects: queried by user_id, organization_id
CREATE INDEX IF NOT EXISTS projects_user_id_idx ON projects (user_id);
CREATE INDEX IF NOT EXISTS projects_organization_id_idx ON projects (organization_id) WHERE organization_id IS NOT NULL;

-- memories: queried by user_id
CREATE INDEX IF NOT EXISTS memories_user_id_idx ON memories (user_id);
