// Package conversations adapts sqlc persistence and telemetry details to the
// conversation ports owned by core.
package conversations

import (
	"context"
	"errors"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	conversationspkg "github.com/TaskForceAI/core/pkg/conversations"
	"github.com/jackc/pgx/v5"
)

// Store adapts generated database queries to the core conversation store port.
type Store struct {
	q *db.Queries
}

// NewStore constructs a conversation store backed by generated database queries.
func NewStore(q *db.Queries) *Store {
	return &Store{q: q}
}

func (a Store) CountConversationsByUser(ctx context.Context, userID *string) (int64, error) {
	return a.q.CountConversationsByUser(ctx, userID)
}

func (a Store) CountConversationsByUserAndOrg(ctx context.Context, input conversationspkg.CountConversationsByUserAndOrgInput) (int64, error) {
	return a.q.CountConversationsByUserAndOrg(ctx, db.CountConversationsByUserAndOrgParams{
		UserID:         input.UserID,
		OrganizationID: input.OrganizationID,
	})
}

func (a Store) GetConversationsByUser(ctx context.Context, input conversationspkg.GetConversationsByUserInput) ([]conversationspkg.ConversationData, error) {
	rows, err := a.q.GetConversationsByUser(ctx, db.GetConversationsByUserParams{
		UserID: input.UserID,
		Limit:  input.Limit,
		Offset: input.Offset,
	})
	if err != nil {
		return nil, err
	}
	return mapConversationRows(rows), nil
}

func (a Store) GetConversationsByUserAndOrg(ctx context.Context, input conversationspkg.GetConversationsByUserAndOrgInput) ([]conversationspkg.ConversationData, error) {
	rows, err := a.q.GetConversationsByUserAndOrg(ctx, db.GetConversationsByUserAndOrgParams{
		UserID:         input.UserID,
		OrganizationID: input.OrganizationID,
		Limit:          input.Limit,
		Offset:         input.Offset,
	})
	if err != nil {
		return nil, err
	}
	return mapConversationRows(rows), nil
}

func (a Store) GetMessagesByConversation(ctx context.Context, conversationID int32) ([]conversationspkg.MessageData, error) {
	rows, err := a.q.GetMessagesByConversation(ctx, conversationID)
	if err != nil {
		return nil, err
	}
	return mapConversationMessageRows(rows), nil
}

func (a Store) GetLatestAssistantMessagesWithMetadataByConversations(ctx context.Context, conversationIDs []int32) ([]conversationspkg.MessageData, error) {
	rows, err := a.q.GetLatestAssistantMessagesWithMetadataByConversations(ctx, conversationIDs)
	if err != nil {
		return nil, err
	}
	return mapConversationMessageRows(rows), nil
}

func (a Store) GetConversationByUserAndID(ctx context.Context, input conversationspkg.GetConversationByUserAndIDInput) (conversationspkg.ConversationData, error) {
	row, err := a.q.GetConversationByUserAndID(ctx, db.GetConversationByUserAndIDParams{
		ID:     input.ID,
		UserID: input.UserID,
	})
	if err != nil {
		return conversationspkg.ConversationData{}, mapConversationStoreError(err)
	}
	return mapConversationRow(row), nil
}

func (a Store) GetConversationByUserOrgAndID(ctx context.Context, input conversationspkg.GetConversationByUserOrgAndIDInput) (conversationspkg.ConversationData, error) {
	row, err := a.q.GetConversationByUserOrgAndID(ctx, db.GetConversationByUserOrgAndIDParams{
		ID:             input.ID,
		UserID:         input.UserID,
		OrganizationID: input.OrganizationID,
	})
	if err != nil {
		return conversationspkg.ConversationData{}, mapConversationStoreError(err)
	}
	return mapConversationRow(row), nil
}

func (a Store) CreateConversation(ctx context.Context, input conversationspkg.CreateConversationStoreInput) (conversationspkg.ConversationData, error) {
	row, err := a.q.CreateConversation(ctx, db.CreateConversationParams{
		UserID:         input.UserID,
		OrganizationID: input.OrganizationID,
		UserInput:      input.UserInput,
		Model:          input.Model,
		AgentCount:     input.AgentCount,
		DeviceID:       input.DeviceID,
		ProjectID:      input.ProjectID,
	})
	if err != nil {
		return conversationspkg.ConversationData{}, err
	}
	return mapConversationRow(row), nil
}

func (a Store) UpdateConversation(ctx context.Context, input conversationspkg.UpdateConversationStoreInput) error {
	return a.q.UpdateConversation(ctx, db.UpdateConversationParams{
		UserInput:      input.UserInput,
		OrganizationID: input.OrganizationID,
		Result:         input.Result,
		ExecutionTime:  input.ExecutionTime,
		Model:          input.Model,
		AgentCount:     input.AgentCount,
		ID:             input.ID,
		UserID:         input.UserID,
	})
}

func (a Store) UpdateConversationWithOrg(ctx context.Context, input conversationspkg.UpdateConversationWithOrgInput) error {
	return a.q.UpdateConversationWithOrg(ctx, db.UpdateConversationWithOrgParams{
		UserInput:      input.UserInput,
		Result:         input.Result,
		ExecutionTime:  input.ExecutionTime,
		Model:          input.Model,
		AgentCount:     input.AgentCount,
		ID:             input.ID,
		UserID:         input.UserID,
		OrganizationID: input.OrganizationID,
	})
}

func (a Store) SoftDeleteConversation(ctx context.Context, input conversationspkg.SoftDeleteConversationInput) error {
	return a.q.SoftDeleteConversation(ctx, db.SoftDeleteConversationParams{
		ID:     input.ID,
		UserID: input.UserID,
	})
}

func (a Store) SoftDeleteConversationWithOrg(ctx context.Context, input conversationspkg.SoftDeleteConversationWithOrgInput) error {
	return a.q.SoftDeleteConversationWithOrg(ctx, db.SoftDeleteConversationWithOrgParams{
		ID:             input.ID,
		UserID:         input.UserID,
		OrganizationID: input.OrganizationID,
	})
}

func mapConversationRows(rows []db.Conversation) []conversationspkg.ConversationData {
	out := make([]conversationspkg.ConversationData, len(rows))
	for i := range rows {
		out[i] = mapConversationRow(rows[i])
	}
	return out
}

func mapConversationRow(row db.Conversation) conversationspkg.ConversationData {
	timestamp := time.Time{}
	if row.Timestamp.Valid {
		timestamp = row.Timestamp.Time
	}
	return conversationspkg.ConversationData{
		ID:             row.ID,
		Timestamp:      timestamp,
		UserID:         row.UserID,
		OrganizationID: row.OrganizationID,
		ProjectID:      row.ProjectID,
		UserInput:      row.UserInput,
		Result:         row.Result,
		ExecutionTime:  row.ExecutionTime,
		Model:          row.Model,
		AgentCount:     row.AgentCount,
	}
}

func mapConversationMessageRows(rows []db.Message) []conversationspkg.MessageData {
	out := make([]conversationspkg.MessageData, len(rows))
	for i := range rows {
		out[i] = conversationspkg.MessageData{
			ID:             rows[i].ID,
			ConversationID: rows[i].ConversationID,
			Role:           rows[i].Role,
			Sources:        rows[i].Sources,
			ToolEvents:     rows[i].ToolEvents,
			AgentStatuses:  rows[i].AgentStatuses,
			Trace:          rows[i].Trace,
		}
	}
	return out
}

func mapConversationStoreError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return conversationspkg.ErrConversationRecordNotFound
	}
	return err
}
