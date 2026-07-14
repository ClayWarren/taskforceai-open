-- Add missing foreign key indexes for performance and cascading deletes

CREATE INDEX IF NOT EXISTS accounts_user_id_idx ON accounts (user_id);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS conversations_project_id_idx ON conversations (project_id);
CREATE INDEX IF NOT EXISTS device_logins_user_id_idx ON device_logins (user_id);
