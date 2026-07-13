-- Add quota columns to organizations table
ALTER TABLE organizations ADD COLUMN requests_limit INTEGER;
ALTER TABLE organizations ADD COLUMN reset_date TIMESTAMP(3);

-- Add index for quota management
CREATE INDEX organizations_reset_date_idx ON organizations (reset_date);
