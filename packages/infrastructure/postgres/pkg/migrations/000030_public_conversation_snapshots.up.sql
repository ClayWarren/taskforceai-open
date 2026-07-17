CREATE TABLE IF NOT EXISTS public_conversation_snapshots (
    conversation_id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    messages JSONB NOT NULL DEFAULT '[]'::JSONB,
    snapshot_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT public_conversation_snapshots_conversation_id_fkey
    FOREIGN KEY (conversation_id) REFERENCES conversations (id)
    ON DELETE CASCADE ON UPDATE CASCADE
);
