-- Add settings JSONB column to organizations table
ALTER TABLE organizations ADD COLUMN settings JSONB NOT NULL DEFAULT '{}';

-- Add comment for clarity
COMMENT ON COLUMN organizations.settings IS 'Organization-wide policies and configuration (SSO, retention, etc.)';
