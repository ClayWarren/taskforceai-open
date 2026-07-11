package db

import (
	"context"
	"encoding/json"

	coreusage "github.com/TaskForceAI/core/pkg/usage"
)

func (q *Queries) CreateTokenUsage(ctx context.Context, rows []coreusage.TokenUsageRow) error {
	for _, row := range rows {
		_, err := q.db.Exec(ctx, `
			INSERT INTO token_usage (
				task_id,
				conversation_id,
				user_id,
				plan,
				model,
				stage,
				prompt_tokens,
				completion_tokens,
				total_tokens,
				cost_micros,
				metadata
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		`,
			emptyStringToNil(row.TaskID),
			row.ConversationID,
			row.UserID,
			row.Plan,
			emptyStringToNil(row.Model),
			emptyStringToNil(row.Stage),
			row.PromptTokens,
			row.CompletionTokens,
			row.TotalTokens,
			row.CostMicros,
			jsonBytesToNil(row.Metadata),
		)
		if err != nil {
			return err
		}
	}
	return nil
}

func (q *Queries) CreateToolUsage(ctx context.Context, rows []coreusage.ToolUsageRow) error {
	for _, row := range rows {
		metadata, _ := json.Marshal(row.Metadata)
		_, err := q.db.Exec(ctx, `
			INSERT INTO tool_usage (
				task_id,
				conversation_id,
				user_id,
				plan,
				tool_name,
				success,
				duration_ms,
				error,
				metadata
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		`,
			emptyStringToNil(row.TaskID),
			row.ConversationID,
			row.UserID,
			row.Plan,
			row.ToolName,
			row.Success,
			row.DurationMs,
			row.Error,
			string(metadata),
		)
		if err != nil {
			return err
		}
	}
	return nil
}

func emptyStringToNil(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func jsonBytesToNil(value []byte) any {
	if len(value) == 0 {
		return nil
	}
	return string(value)
}

func (q *Queries) SoftDeleteDeveloperFilesByIDsForUser(ctx context.Context, fileIDs []string, userID int32, organizationID *int32) error {
	if len(fileIDs) == 0 {
		return nil
	}
	_, err := q.db.Exec(ctx, `
		WITH updated AS (
			UPDATE developer_files AS df
			SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
			WHERE
				df.id = ANY($1::TEXT[])
				AND df.user_id = $2
				AND (
					($3::INT IS NULL AND df.organization_id IS NULL)
					OR df.organization_id = $3::INT
				)
				AND df.deleted_at IS NULL
			RETURNING df.user_id, df.bytes
		),
		totals AS (
			SELECT user_id, COALESCE(SUM(bytes), 0)::BIGINT AS bytes
			FROM updated
			GROUP BY user_id
		)
		UPDATE user_storage_quotas AS quota
		SET used_bytes = GREATEST(0, quota.used_bytes - totals.bytes), updated_at = CURRENT_TIMESTAMP
		FROM totals
		WHERE quota.user_id = totals.user_id
	`, fileIDs, userID, organizationID)
	return err
}
