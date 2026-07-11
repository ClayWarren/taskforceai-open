-- Add organization_id to memories table
ALTER TABLE memories ADD COLUMN organization_id INTEGER;

-- Add index for organization_id
CREATE INDEX memories_organization_id_idx ON memories (organization_id);

-- Add foreign key constraint
ALTER TABLE memories ADD CONSTRAINT memories_organization_id_fkey FOREIGN KEY (
    organization_id
) REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE;
