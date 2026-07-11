package audit

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/jackc/pgx/v5/pgtype"
)

// Ensure implementation satisfies interface
var _ AuditLogRepository = (*PgAuditLogRepository)(nil)

type PgAuditLogRepository struct {
	q *db.Queries
}

func NewAuditLogRepository(q *db.Queries) *PgAuditLogRepository {
	return &PgAuditLogRepository{q: q}
}

func (r *PgAuditLogRepository) CreateMany(ctx context.Context, data []AuditLogWrite) error {
	if len(data) == 0 {
		return nil
	}

	var (
		values = make([]string, 0, len(data))
		args   = make([]any, 0, len(data)*10)
	)
	for i, item := range data {
		detailsJSON, err := marshalAuditDetails(item)
		if err != nil {
			slog.Warn("audit: failed to marshal event details, falling back to empty object",
				"action", item.Action, "resource", item.Resource, "error", err)
		}
		base := i*10 + 1
		values = append(values, fmt.Sprintf("($%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d)",
			base, base+1, base+2, base+3, base+4, base+5, base+6, base+7, base+8, base+9))
		args = append(args,
			item.UserID,
			item.OrganizationID,
			item.Action,
			item.Resource,
			item.ResourceID,
			item.IPAddress,
			item.UserAgent,
			detailsJSON,
			item.Success,
			item.ErrorMessage,
		)
	}

	query := `INSERT INTO audit_logs (
		user_id, organization_id, action, resource, resource_id, ip_address, user_agent, details, success, error_message
	) VALUES ` + strings.Join(values, ",")
	if _, err := r.q.GetDB().Exec(ctx, query, args...); err != nil {
		return err
	}
	return nil
}

func (r *PgAuditLogRepository) Create(ctx context.Context, data AuditLogWrite) error {
	detailsJSON, marshalErr := marshalAuditDetails(data)
	if marshalErr != nil {
		slog.Warn("audit: failed to marshal event details, falling back to empty object",
			"action", data.Action, "resource", data.Resource, "error", marshalErr)
	}

	_, err := r.q.CreateAuditLog(ctx, db.CreateAuditLogParams{
		UserID:         data.UserID,
		OrganizationID: data.OrganizationID,
		Action:         data.Action,
		Resource:       data.Resource,
		ResourceID:     data.ResourceID,
		IpAddress:      data.IPAddress,
		UserAgent:      data.UserAgent,
		Details:        detailsJSON,
		Success:        data.Success,
		ErrorMessage:   data.ErrorMessage,
	})
	return err
}

func marshalAuditDetails(data AuditLogWrite) ([]byte, error) {
	detailsJSON, err := json.Marshal(data.Details)
	if err != nil {
		return []byte("{}"), err
	}
	return detailsJSON, nil
}

func (r *PgAuditLogRepository) FindByUser(ctx context.Context, userID string, take int) ([]AuditLogRecord, error) {
	logs, err := r.q.GetAuditLogsByUser(ctx, db.GetAuditLogsByUserParams{
		UserID: &userID,
		Limit:  auditLimit(take),
	})
	if err != nil {
		return nil, err
	}

	return mapDbAuditLogs(logs), nil
}

func (r *PgAuditLogRepository) FindByOrganization(ctx context.Context, orgID int32, take int) ([]AuditLogRecord, error) {
	logs, err := r.q.GetAuditLogsByOrganization(ctx, db.GetAuditLogsByOrganizationParams{
		OrganizationID: &orgID,
		Limit:          auditLimit(take),
	})
	if err != nil {
		return nil, err
	}

	return mapDbAuditLogs(logs), nil
}

func (r *PgAuditLogRepository) FindByResource(ctx context.Context, resource, resourceID string, take int) ([]AuditLogRecord, error) {
	logs, err := r.q.GetAuditLogsByResourceAndID(ctx, db.GetAuditLogsByResourceAndIDParams{
		Resource:   resource,
		ResourceID: &resourceID,
		Limit:      auditLimit(take),
	})
	if err != nil {
		return nil, err
	}

	return mapDbAuditLogs(logs), nil
}

func (r *PgAuditLogRepository) FindFailedLoginAttempts(ctx context.Context, hours, take int) ([]AuditLogRecord, error) {
	logs, err := r.q.GetFailedLoginAttempts(ctx, db.GetFailedLoginAttemptsParams{
		Column1: hours,
		Limit:   auditLimit(take),
	})
	if err != nil {
		return nil, err
	}

	return mapDbAuditLogs(logs), nil
}

func (r *PgAuditLogRepository) FindForPeriod(ctx context.Context, startDate, endDate time.Time, actions []string) ([]AuditLogRecord, error) {
	logs, err := r.q.GetAuditLogsForPeriod(ctx, db.GetAuditLogsForPeriodParams{
		Timestamp:   pgtype.Timestamp{Time: startDate, Valid: true},
		Timestamp_2: pgtype.Timestamp{Time: endDate, Valid: true},
		Column3:     actions,
	})
	if err != nil {
		return nil, err
	}

	return mapDbAuditLogs(logs), nil
}

func auditLimit(take int) int32 {
	if take < 0 {
		return 0
	}
	if take > math.MaxInt32 {
		return math.MaxInt32
	}
	return int32(take) // #nosec G115 -- take range checked above.
}

func mapDbAuditLogs(logs []db.AuditLog) []AuditLogRecord {
	records := make([]AuditLogRecord, len(logs))
	for i, log := range logs {
		records[i] = mapDbAuditLog(&log)
	}
	return records
}

func mapDbAuditLog(log *db.AuditLog) AuditLogRecord {
	var ts time.Time
	if log.Timestamp.Valid {
		ts = log.Timestamp.Time
	}

	var details any
	if len(log.Details) > 0 {
		if err := json.Unmarshal(log.Details, &details); err != nil {
			slog.Warn("audit: failed to unmarshal event details",
				"auditLogId", log.ID,
				"action", log.Action,
				"resource", log.Resource,
				"error", err)
		}
	}

	return AuditLogRecord{
		ID:             int(log.ID),
		Timestamp:      ts,
		UserID:         log.UserID,
		OrganizationID: log.OrganizationID,
		Action:         log.Action,
		Resource:       log.Resource,
		ResourceID:     log.ResourceID,
		IPAddress:      log.IpAddress,
		UserAgent:      log.UserAgent,
		Details:        details,
		Success:        log.Success,
		ErrorMessage:   log.ErrorMessage,
	}
}
