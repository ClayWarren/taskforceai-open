CREATE SEQUENCE IF NOT EXISTS sync_version_seq;

CREATE TEMP TABLE legacy_sync_version_backfill (
    entity TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    sync_version INTEGER NOT NULL
) ON COMMIT DROP;

INSERT INTO legacy_sync_version_backfill (entity, entity_id, sync_version)
SELECT
    entity,
    entity_id,
    COALESCE((SELECT MAX(sync_version) FROM (
        SELECT sync_version FROM conversations
        UNION ALL
        SELECT sync_version FROM messages
    ) AS existing_versions WHERE sync_version > 0), 0)::INTEGER
        + ROW_NUMBER() OVER (ORDER BY updated_at, entity, entity_id)::INTEGER AS sync_version
FROM (
    SELECT 'conversation' AS entity, id AS entity_id, updated_at
    FROM conversations
    WHERE sync_version <= 0
    UNION ALL
    SELECT 'message' AS entity, id AS entity_id, updated_at
    FROM messages
    WHERE sync_version <= 0
) AS legacy_rows;

UPDATE conversations AS c
SET sync_version = b.sync_version
FROM legacy_sync_version_backfill AS b
WHERE b.entity = 'conversation' AND b.entity_id = c.id;

UPDATE messages AS m
SET sync_version = b.sync_version
FROM legacy_sync_version_backfill AS b
WHERE b.entity = 'message' AND b.entity_id = m.id;

SELECT SETVAL(
    'sync_version_seq',
    GREATEST((
        SELECT COALESCE(MAX(sync_version), 0)
        FROM (
            SELECT sync_version FROM conversations
            UNION ALL
            SELECT sync_version FROM messages
        ) AS all_versions
    ), 1),
    true
);

ALTER TABLE conversations ALTER COLUMN sync_version SET DEFAULT NEXTVAL('sync_version_seq');
ALTER TABLE messages ALTER COLUMN sync_version SET DEFAULT NEXTVAL('sync_version_seq');
