package sync

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"strconv"

	"github.com/TaskForceAI/adapters/pkg/collections"
	"github.com/TaskForceAI/adapters/pkg/db"
	postgres "github.com/TaskForceAI/infrastructure/postgres/pkg"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// SyncRepository defines the interface for sync data operations
type SyncRepository interface {
	GetLatestSyncVersion(ctx context.Context, userID string) (int32, error)
	GetLatestOrgSyncVersion(ctx context.Context, orgID int32) (int32, error)
	GetConversationsAfterVersion(ctx context.Context, userID string, lastVersion int32, limit int32) ([]ConversationRecord, error)
	GetConversationsByOrgAfterVersion(ctx context.Context, orgID int32, lastVersion int32, limit int32) ([]ConversationRecord, error)
	GetMessagesAfterVersion(ctx context.Context, userID string, lastVersion int32, limit int32) ([]MessageRecord, error)
	GetMessagesByOrgAfterVersion(ctx context.Context, orgID int32, lastVersion int32, limit int32) ([]MessageRecord, error)
	GetConversationVersion(ctx context.Context, id int32, userID *string) (ConversationVersion, error)
	GetConversationVersionWithOrg(ctx context.Context, id int32, userID *string, orgID int32) (ConversationVersion, error)
	GetConversation(ctx context.Context, id int32) (ConversationRecord, error)
	GetConversationWithOrg(ctx context.Context, id int32, orgID int32) (ConversationRecord, error)
	UpdateConversationSync(ctx context.Context, params UpdateConversationInput) error
	CreateConversationSync(ctx context.Context, params CreateConversationInput) (ConversationRecord, error)
	GetMessageVersion(ctx context.Context, messageID string) (MessageVersion, error)
	GetMessageVersionScoped(ctx context.Context, messageID string, userID string, orgID *int32) (MessageVersion, error)
	GetMessageByMessageID(ctx context.Context, messageID string) (MessageRecord, error)
	GetMessageByMessageIDScoped(ctx context.Context, messageID string, userID string, orgID *int32) (MessageRecord, error)
	UpdateMessageSync(ctx context.Context, params UpdateMessageInput) error
	CreateMessageSync(ctx context.Context, params CreateMessageInput) (MessageRecord, error)
	NextSyncVersion(ctx context.Context, after int32) (int32, error)
	AdvanceSyncVersionSequence(ctx context.Context, minVersion int32) error
	WithTransaction(ctx context.Context, fn func(SyncRepository) error) error

	// Auditing & Consistency
	CreateSyncAuditLog(ctx context.Context, params SyncAuditInput) (SyncAuditRecord, error)
	GetConversationsCount(ctx context.Context, userID string) (int64, error)
	GetMessagesCount(ctx context.Context, userID string) (int64, error)
	CountConversationsByOrg(ctx context.Context, orgID int32) (int64, error)
	CountMessagesByOrg(ctx context.Context, orgID int32) (int64, error)
	GetSyncCounts(ctx context.Context, userID string, orgID *int32) (int64, int64, error)

	// Device Management
	IsSyncDeviceRevoked(ctx context.Context, userID string, deviceID string) (bool, error)
	UpsertSyncDevice(ctx context.Context, params UpsertSyncDeviceInput) (SyncDeviceRecord, error)
	GetSyncDevices(ctx context.Context, userID string) ([]SyncDeviceRecord, error)
	RevokeSyncDevice(ctx context.Context, userID string, deviceID string) error
}

type DurablePushResultRepository interface {
	GetSyncPushResult(ctx context.Context, userID, idempotencyKey string) (SyncPushResponse, error)
	SaveSyncPushResult(ctx context.Context, userID, idempotencyKey string, response SyncPushResponse) error
}

// Repository implements SyncRepository using db.Queries
type Repository struct {
	q       *db.Queries
	beginTx func(context.Context) (pgx.Tx, error)
}

type repositoryTxPool interface {
	Begin(context.Context) (pgx.Tx, error)
}

var getRepositoryPool = func(ctx context.Context) (repositoryTxPool, error) {
	return postgres.GetPool(ctx)
}

func NewRepository(q *db.Queries) *Repository {
	return &Repository{
		q: q,
		beginTx: func(ctx context.Context) (pgx.Tx, error) {
			pool, err := getRepositoryPool(ctx)
			if err != nil {
				return nil, err
			}
			return pool.Begin(ctx)
		},
	}
}

func (r *Repository) GetLatestSyncVersion(ctx context.Context, userID string) (int32, error) {
	return r.q.GetLatestSyncVersion(ctx, &userID)
}

func (r *Repository) GetLatestOrgSyncVersion(ctx context.Context, orgID int32) (int32, error) {
	return r.q.GetLatestOrgSyncVersion(ctx, &orgID)
}

func (r *Repository) GetConversationsAfterVersion(ctx context.Context, userID string, lastVersion int32, limit int32) ([]ConversationRecord, error) {
	rows, err := r.q.GetConversationsAfterVersion(ctx, db.GetConversationsAfterVersionParams{
		UserID:      &userID,
		SyncVersion: lastVersion,
		Limit:       limit,
	})
	if err != nil {
		return nil, err
	}
	return mapConversationRecords(rows), nil
}

func (r *Repository) GetConversationsByOrgAfterVersion(ctx context.Context, orgID int32, lastVersion int32, limit int32) ([]ConversationRecord, error) {
	rows, err := r.q.GetConversationsByOrgAfterVersion(ctx, db.GetConversationsByOrgAfterVersionParams{
		OrganizationID: &orgID,
		SyncVersion:    lastVersion,
		Limit:          limit,
	})
	if err != nil {
		return nil, err
	}
	return mapConversationRecords(rows), nil
}

func (r *Repository) GetMessagesAfterVersion(ctx context.Context, userID string, lastVersion int32, limit int32) ([]MessageRecord, error) {
	rows, err := r.q.GetMessagesAfterVersion(ctx, db.GetMessagesAfterVersionParams{
		UserID:      &userID,
		SyncVersion: lastVersion,
		Limit:       limit,
	})
	if err != nil {
		return nil, err
	}
	return collections.Map(rows, mapMessageFromAfterVersionRow), nil
}

func (r *Repository) GetMessagesByOrgAfterVersion(ctx context.Context, orgID int32, lastVersion int32, limit int32) ([]MessageRecord, error) {
	rows, err := r.q.GetMessagesByOrgAfterVersion(ctx, db.GetMessagesByOrgAfterVersionParams{
		OrganizationID: &orgID,
		SyncVersion:    lastVersion,
		Limit:          limit,
	})
	if err != nil {
		return nil, err
	}
	return collections.Map(rows, mapMessageFromByOrgAfterVersionRow), nil
}

func (r *Repository) GetConversationVersion(ctx context.Context, id int32, userID *string) (ConversationVersion, error) {
	row, err := r.q.GetConversationVersion(ctx, db.GetConversationVersionParams{
		ID:     id,
		UserID: userID,
	})
	if err != nil {
		return ConversationVersion{}, repositoryError(err)
	}
	return ConversationVersion(row), nil
}

func (r *Repository) GetConversationVersionWithOrg(ctx context.Context, id int32, userID *string, orgID int32) (ConversationVersion, error) {
	row, err := r.q.GetConversationVersionWithOrg(ctx, db.GetConversationVersionWithOrgParams{
		ID:             id,
		UserID:         userID,
		OrganizationID: &orgID,
	})
	if err != nil {
		return ConversationVersion{}, repositoryError(err)
	}
	return ConversationVersion(row), nil
}

func (r *Repository) GetConversation(ctx context.Context, id int32) (ConversationRecord, error) {
	row, err := r.q.GetConversation(ctx, id)
	if err != nil {
		return ConversationRecord{}, repositoryError(err)
	}
	return mapConversationRecord(row), nil
}

func (r *Repository) GetConversationWithOrg(ctx context.Context, id int32, orgID int32) (ConversationRecord, error) {
	row, err := r.q.GetConversationWithOrg(ctx, db.GetConversationWithOrgParams{
		ID:             id,
		OrganizationID: &orgID,
	})
	if err != nil {
		return ConversationRecord{}, repositoryError(err)
	}
	return mapConversationRecord(row), nil
}

func (r *Repository) UpdateConversationSync(ctx context.Context, params UpdateConversationInput) error {
	if params.ScopeOrganizationID == nil {
		params.ScopeOrganizationID = params.OrganizationID
	}
	return r.q.UpdateConversationSync(ctx, db.UpdateConversationSyncParams(params))
}

func (r *Repository) CreateConversationSync(ctx context.Context, params CreateConversationInput) (ConversationRecord, error) {
	row, err := r.q.CreateConversationSync(ctx, db.CreateConversationSyncParams{
		UserID: params.UserID, OrganizationID: params.OrganizationID, ProjectID: params.ProjectID, UserInput: params.UserInput,
		Result: params.Result, ExecutionTime: params.ExecutionTime, Model: params.Model,
		AgentCount: params.AgentCount, SyncVersion: params.SyncVersion, DeviceID: params.DeviceID,
		IsDeleted: params.IsDeleted, Timestamp: toPGTimestamp(params.Timestamp), VectorClock: params.VectorClock,
	})
	if err != nil {
		return ConversationRecord{}, err
	}
	return mapConversationRecord(row), nil
}

func (r *Repository) GetSyncPushResult(ctx context.Context, userID, idempotencyKey string) (SyncPushResponse, error) {
	if err := r.q.AcquireSyncPushResultLock(ctx, db.AcquireSyncPushResultLockParams{UserID: &userID, IdempotencyKey: &idempotencyKey}); err != nil {
		return SyncPushResponse{}, fmt.Errorf("acquire durable sync push result lock: %w", err)
	}
	raw, err := r.q.GetSyncPushResult(ctx, db.GetSyncPushResultParams{UserID: userID, IdempotencyKey: idempotencyKey})
	if err != nil {
		return SyncPushResponse{}, repositoryError(err)
	}
	var response SyncPushResponse
	if err := json.Unmarshal(raw, &response); err != nil {
		return SyncPushResponse{}, fmt.Errorf("decode durable sync push result: %w", err)
	}
	return ensurePushResponseDefaults(response), nil
}

func (r *Repository) SaveSyncPushResult(ctx context.Context, userID, idempotencyKey string, response SyncPushResponse) error {
	raw, err := json.Marshal(ensurePushResponseDefaults(response))
	if err != nil {
		return fmt.Errorf("encode durable sync push result: %w", err)
	}
	return r.q.SaveSyncPushResult(ctx, db.SaveSyncPushResultParams{UserID: userID, IdempotencyKey: idempotencyKey, Response: raw})
}

func (r *Repository) GetMessageVersion(ctx context.Context, messageID string) (MessageVersion, error) {
	row, err := r.q.GetMessageVersion(ctx, messageID)
	if err != nil {
		return MessageVersion{}, repositoryError(err)
	}
	return MessageVersion(row), nil
}

func (r *Repository) GetMessageVersionScoped(ctx context.Context, messageID string, userID string, orgID *int32) (MessageVersion, error) {
	row, err := r.q.GetMessageVersionScoped(ctx, db.GetMessageVersionScopedParams{
		MessageID:      messageID,
		UserID:         &userID,
		OrganizationID: orgID,
	})
	if err != nil {
		return MessageVersion{}, repositoryError(err)
	}
	return MessageVersion(row), nil
}

func (r *Repository) GetMessageByMessageID(ctx context.Context, messageID string) (MessageRecord, error) {
	row, err := r.q.GetMessageByMessageID(ctx, messageID)
	if err != nil {
		return MessageRecord{}, repositoryError(err)
	}
	return mapMessageRecord(row), nil
}

func (r *Repository) GetMessageByMessageIDScoped(ctx context.Context, messageID string, userID string, orgID *int32) (MessageRecord, error) {
	row, err := r.q.GetMessageByMessageIDScoped(ctx, db.GetMessageByMessageIDScopedParams{
		MessageID:      messageID,
		UserID:         &userID,
		OrganizationID: orgID,
	})
	if err != nil {
		return MessageRecord{}, repositoryError(err)
	}
	return mapMessageFromScopedRow(row), nil
}

func (r *Repository) UpdateMessageSync(ctx context.Context, params UpdateMessageInput) error {
	return r.q.UpdateMessageSync(ctx, db.UpdateMessageSyncParams(params))
}

func (r *Repository) CreateMessageSync(ctx context.Context, params CreateMessageInput) (MessageRecord, error) {
	row, err := r.q.CreateMessageSync(ctx, db.CreateMessageSyncParams{
		MessageID: params.MessageID, ConversationID: params.ConversationID, Role: params.Role,
		Content: params.Content, IsStreaming: params.IsStreaming, IsAgentStatus: params.IsAgentStatus,
		ElapsedSeconds: params.ElapsedSeconds, Error: params.Error, Sources: params.Sources,
		ToolEvents: params.ToolEvents, AgentStatuses: params.AgentStatuses, SyncVersion: params.SyncVersion,
		DeviceID: params.DeviceID, IsDeleted: params.IsDeleted, CreatedAt: toPGTimestamp(params.CreatedAt),
		VectorClock: params.VectorClock, Trace: params.Trace,
	})
	if err != nil {
		return MessageRecord{}, err
	}
	return mapMessageFromCreateSyncRow(row), nil
}

func (r *Repository) NextSyncVersion(ctx context.Context, after int32) (int32, error) {
	version, err := r.q.NextSyncVersion(ctx)
	if err != nil {
		return 0, err
	}
	if version <= after {
		return 0, fmt.Errorf("allocated sync version %d does not advance %d", version, after)
	}
	return version, nil
}

func (r *Repository) AdvanceSyncVersionSequence(ctx context.Context, minVersion int32) error {
	return r.q.AdvanceSyncVersionSequence(ctx, minVersion)
}

func (r *Repository) WithTransaction(ctx context.Context, fn func(SyncRepository) error) error {
	tx, err := r.beginTx(ctx)
	if err != nil {
		return err
	}

	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()

	qtx := r.q.WithTx(tx)
	repoTx := &Repository{q: qtx, beginTx: r.beginTx}

	if err := fn(repoTx); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}
	committed = true
	return nil
}

func (r *Repository) CreateSyncAuditLog(ctx context.Context, params SyncAuditInput) (SyncAuditRecord, error) {
	row, err := r.q.CreateSyncAuditLog(ctx, db.CreateSyncAuditLogParams(params))
	if err != nil {
		return SyncAuditRecord{}, err
	}
	return SyncAuditRecord{
		ID: row.ID, Timestamp: fromPGTimestamp(row.Timestamp), UserID: row.UserID,
		DeviceID: row.DeviceID, Action: row.Action, VersionStart: row.VersionStart,
		VersionEnd: row.VersionEnd, ItemsCount: row.ItemsCount, ConflictsCount: row.ConflictsCount,
		DurationMs: row.DurationMs, Success: row.Success, ErrorMessage: row.ErrorMessage, Details: row.Details,
	}, nil
}

func (r *Repository) GetConversationsCount(ctx context.Context, userID string) (int64, error) {
	return r.q.GetConversationsCount(ctx, &userID)
}

func (r *Repository) GetMessagesCount(ctx context.Context, userID string) (int64, error) {
	return r.q.GetMessagesCount(ctx, &userID)
}

func (r *Repository) CountConversationsByOrg(ctx context.Context, orgID int32) (int64, error) {
	return r.q.CountConversationsByOrg(ctx, &orgID)
}

func (r *Repository) CountMessagesByOrg(ctx context.Context, orgID int32) (int64, error) {
	return r.q.CountMessagesByOrg(ctx, &orgID)
}

func (r *Repository) GetSyncCounts(ctx context.Context, userID string, orgID *int32) (int64, int64, error) {
	if orgID != nil {
		row, err := r.q.GetOrgSyncCounts(ctx, orgID)
		if err != nil {
			return 0, 0, err
		}
		return row.ConversationCount, row.MessageCount, nil
	}
	row, err := r.q.GetUserSyncCounts(ctx, &userID)
	if err != nil {
		return 0, 0, err
	}
	return row.ConversationCount, row.MessageCount, nil
}

func (r *Repository) IsSyncDeviceRevoked(ctx context.Context, userID string, deviceID string) (bool, error) {
	return r.q.IsSyncDeviceRevoked(ctx, db.IsSyncDeviceRevokedParams{
		UserID:   userID,
		DeviceID: deviceID,
	})
}

func (r *Repository) UpsertSyncDevice(ctx context.Context, params UpsertSyncDeviceInput) (SyncDeviceRecord, error) {
	row, err := r.q.UpsertSyncDevice(ctx, db.UpsertSyncDeviceParams(params))
	if err != nil {
		return SyncDeviceRecord{}, err
	}
	return mapSyncDeviceRecord(row), nil
}

func (r *Repository) GetSyncDevices(ctx context.Context, userID string) ([]SyncDeviceRecord, error) {
	rows, err := r.q.GetSyncDevices(ctx, userID)
	if err != nil {
		return nil, err
	}
	result := make([]SyncDeviceRecord, 0, len(rows))
	for _, row := range rows {
		result = append(result, mapSyncDeviceRecord(row))
	}
	return result, nil
}

func (r *Repository) RevokeSyncDevice(ctx context.Context, userID string, deviceID string) error {
	return r.q.RevokeSyncDevice(ctx, db.RevokeSyncDeviceParams{
		UserID:   userID,
		DeviceID: deviceID,
	})
}

func mapMessageFromAfterVersionRow(row db.GetMessagesAfterVersionRow) MessageRecord {
	return MessageRecord{
		ID:             row.ID,
		MessageID:      row.MessageID,
		ConversationID: row.ConversationID,
		Role:           row.Role,
		Content:        row.Content,
		IsStreaming:    row.IsStreaming,
		IsAgentStatus:  row.IsAgentStatus,
		ElapsedSeconds: row.ElapsedSeconds,
		CreatedAt:      fromPGTimestamp(row.CreatedAt),
		Error:          row.Error,
		Sources:        row.Sources,
		ToolEvents:     row.ToolEvents,
		AgentStatuses:  row.AgentStatuses,
		VectorClock:    row.VectorClock,
		SyncVersion:    row.SyncVersion,
		LastSyncedAt:   fromPGTimestamp(row.LastSyncedAt),
		DeviceID:       row.DeviceID,
		IsDeleted:      row.IsDeleted,
		UpdatedAt:      fromPGTimestamp(row.UpdatedAt),
		Rating:         row.Rating,
	}
}

func mapMessageFromByOrgAfterVersionRow(row db.GetMessagesByOrgAfterVersionRow) MessageRecord {
	return mapMessageFromAfterVersionRow(db.GetMessagesAfterVersionRow(row))
}

func mapMessageFromScopedRow(row db.GetMessageByMessageIDScopedRow) MessageRecord {
	return MessageRecord{
		ID:             row.ID,
		MessageID:      row.MessageID,
		ConversationID: row.ConversationID,
		Role:           row.Role,
		Content:        row.Content,
		IsStreaming:    row.IsStreaming,
		IsAgentStatus:  row.IsAgentStatus,
		ElapsedSeconds: row.ElapsedSeconds,
		CreatedAt:      fromPGTimestamp(row.CreatedAt),
		Error:          row.Error,
		Sources:        row.Sources,
		ToolEvents:     row.ToolEvents,
		AgentStatuses:  row.AgentStatuses,
		VectorClock:    row.VectorClock,
		SyncVersion:    row.SyncVersion,
		LastSyncedAt:   fromPGTimestamp(row.LastSyncedAt),
		DeviceID:       row.DeviceID,
		IsDeleted:      row.IsDeleted,
		UpdatedAt:      fromPGTimestamp(row.UpdatedAt),
		Rating:         ratingFromInterface(row.Rating),
		Trace:          traceFromInterface(row.Trace),
	}
}

func mapMessageFromCreateSyncRow(row db.CreateMessageSyncRow) MessageRecord {
	return mapMessageFromScopedRow(db.GetMessageByMessageIDScopedRow(row))
}

func mapConversationRecords(rows []db.Conversation) []ConversationRecord {
	result := make([]ConversationRecord, 0, len(rows))
	for _, row := range rows {
		result = append(result, mapConversationRecord(row))
	}
	return result
}

func mapConversationRecord(row db.Conversation) ConversationRecord {
	return ConversationRecord{
		ID: row.ID, Timestamp: fromPGTimestamp(row.Timestamp), UserID: row.UserID,
		OrganizationID: row.OrganizationID, UserInput: row.UserInput, Result: row.Result,
		ExecutionTime: row.ExecutionTime, Model: row.Model, AgentCount: row.AgentCount,
		ProjectID: row.ProjectID, IsPublic: row.IsPublic, ShareID: row.ShareID,
		VectorClock: row.VectorClock, SyncVersion: row.SyncVersion,
		LastSyncedAt: fromPGTimestamp(row.LastSyncedAt), DeviceID: row.DeviceID,
		IsDeleted: row.IsDeleted, UpdatedAt: fromPGTimestamp(row.UpdatedAt),
	}
}

func mapMessageRecord(row db.Message) MessageRecord {
	return MessageRecord{
		ID: row.ID, MessageID: row.MessageID, ConversationID: row.ConversationID,
		Role: row.Role, Content: row.Content, IsStreaming: row.IsStreaming,
		IsAgentStatus: row.IsAgentStatus, ElapsedSeconds: row.ElapsedSeconds,
		CreatedAt: fromPGTimestamp(row.CreatedAt), Error: row.Error, Sources: row.Sources,
		ToolEvents: row.ToolEvents, AgentStatuses: row.AgentStatuses, VectorClock: row.VectorClock,
		SyncVersion: row.SyncVersion, LastSyncedAt: fromPGTimestamp(row.LastSyncedAt),
		DeviceID: row.DeviceID, IsDeleted: row.IsDeleted, UpdatedAt: fromPGTimestamp(row.UpdatedAt),
		Rating: row.Rating, Trace: row.Trace,
	}
}

func mapSyncDeviceRecord(row db.SyncDevice) SyncDeviceRecord {
	return SyncDeviceRecord{
		ID: row.ID, UserID: row.UserID, DeviceID: row.DeviceID, DeviceName: row.DeviceName,
		UserAgent: row.UserAgent, LastSeenAt: fromPGTimestamp(row.LastSeenAt),
		CreatedAt: fromPGTimestamp(row.CreatedAt), IsRevoked: row.IsRevoked,
	}
}

func fromPGTimestamp(value pgtype.Timestamp) Timestamp {
	return Timestamp{Time: value.Time, Valid: value.Valid}
}

func toPGTimestamp(value Timestamp) pgtype.Timestamp {
	return pgtype.Timestamp{Time: value.Time, Valid: value.Valid}
}

func repositoryError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func ratingFromInterface(v any) int32 {
	switch value := v.(type) {
	case int32:
		return value
	case int64:
		if value >= math.MinInt32 && value <= math.MaxInt32 {
			return int32(value)
		}
	case int:
		value64 := int64(value)
		if value64 >= math.MinInt32 && value64 <= math.MaxInt32 {
			return int32(value64)
		}
	case float64:
		if math.IsNaN(value) || math.IsInf(value, 0) {
			break
		}
		if value >= math.MinInt32 && value <= math.MaxInt32 {
			return int32(value)
		}
	case []byte:
		parsed, err := strconv.ParseInt(string(value), 10, 32)
		if err == nil {
			return int32(parsed)
		}
	case string:
		parsed, err := strconv.ParseInt(value, 10, 32)
		if err == nil {
			return int32(parsed)
		}
	}
	slog.Warn("Invalid rating value from repository; using zero", "type", fmt.Sprintf("%T", v), "value", v)
	return 0
}

func traceFromInterface(v any) []byte {
	switch value := v.(type) {
	case nil:
		return nil
	case []byte:
		return value
	case string:
		return []byte(value)
	default:
		b, err := json.Marshal(value)
		if err != nil {
			return nil
		}
		return b
	}
}
