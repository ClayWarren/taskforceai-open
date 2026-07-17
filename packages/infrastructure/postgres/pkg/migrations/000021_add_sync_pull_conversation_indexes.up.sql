CREATE INDEX IF NOT EXISTS conversations_org_sync_version_idx
ON conversations (organization_id, sync_version)
WHERE organization_id IS NOT NULL;
