package db

import "context"

const nextSyncVersion = `SELECT nextval('sync_version_seq')::integer`

// NextSyncVersion allocates a globally ordered version shared by every writer.
func (q *Queries) NextSyncVersion(ctx context.Context) (int32, error) {
	var version int32
	err := q.db.QueryRow(ctx, nextSyncVersion).Scan(&version)
	return version, err
}

const advanceSyncVersionSequence = `
SELECT setval(
    'sync_version_seq',
    GREATEST(
        $1::bigint,
        (
            SELECT COALESCE(MAX(sync_version), 0)::bigint
            FROM (
                SELECT sync_version FROM conversations
                UNION ALL
                SELECT sync_version FROM messages
            ) AS existing_versions
        )
    )
)
`

func (q *Queries) AdvanceSyncVersionSequence(ctx context.Context, minVersion int32) error {
	_, err := q.db.Exec(ctx, advanceSyncVersionSequence, minVersion)
	return err
}
