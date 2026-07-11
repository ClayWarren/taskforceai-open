package db

import "context"

type DeveloperFileStorageStats struct {
	Category string `json:"category"`
	Bytes    int64  `json:"bytes"`
	Count    int64  `json:"count"`
}

const getDeveloperFileStorageStatsByUser = `
WITH categorized_files AS (
    SELECT
        df.id,
        df.bytes,
        CASE
            WHEN df.mime_type LIKE 'image/%' THEN 'images'
            WHEN EXISTS (
                SELECT 1
                FROM artifact_versions AS av
                WHERE av.file_id = df.id
            ) THEN 'generated_artifacts'
            ELSE 'files'
        END AS category
    FROM developer_files AS df
    WHERE
        df.user_id = $1
        AND df.deleted_at IS NULL
)
SELECT
    category,
    COALESCE(SUM(bytes), 0)::BIGINT AS bytes,
    COUNT(*)::BIGINT AS count
FROM categorized_files
GROUP BY category
ORDER BY category
`

func (q *Queries) GetDeveloperFileStorageStatsByUser(ctx context.Context, userID int32) ([]DeveloperFileStorageStats, error) {
	rows, err := q.db.Query(ctx, getDeveloperFileStorageStatsByUser, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []DeveloperFileStorageStats{}
	for rows.Next() {
		var item DeveloperFileStorageStats
		if err := rows.Scan(&item.Category, &item.Bytes, &item.Count); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}
