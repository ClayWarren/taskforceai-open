// Package memories adapts sqlc persistence details to the memory port owned by core.
package memories

import (
	"context"
	"time"

	"github.com/TaskForceAI/adapters/pkg/collections"
	"github.com/TaskForceAI/adapters/pkg/db"
	corememories "github.com/TaskForceAI/core/pkg/memories"
	"github.com/jackc/pgx/v5/pgtype"
)

// Store adapts generated database queries to the core memory store port.
type Store struct {
	q *db.Queries
}

// NewStore constructs a memory store backed by generated database queries.
func NewStore(q *db.Queries) *Store {
	return &Store{q: q}
}

var _ corememories.MemoryStore = (*Store)(nil)

func (s Store) GetUserMemories(ctx context.Context, userID int32) ([]corememories.MemoryRecord, error) {
	rows, err := s.q.GetUserMemories(ctx, userID)
	if err != nil {
		return nil, err
	}
	return mapMemoryRows(rows), nil
}

func (s Store) GetUserMemoriesWithOrg(ctx context.Context, input corememories.GetUserMemoriesWithOrgInput) ([]corememories.MemoryRecord, error) {
	rows, err := s.q.GetUserMemoriesWithOrg(ctx, db.GetUserMemoriesWithOrgParams{
		UserID:         input.UserID,
		OrganizationID: input.OrganizationID,
	})
	if err != nil {
		return nil, err
	}
	return mapMemoryRows(rows), nil
}

func (s Store) DeleteMemory(ctx context.Context, input corememories.DeleteMemoryInput) error {
	return s.q.DeleteMemory(ctx, db.DeleteMemoryParams{
		ID:     input.ID,
		UserID: input.UserID,
	})
}

func (s Store) DeleteMemoryWithOrg(ctx context.Context, input corememories.DeleteMemoryWithOrgInput) error {
	return s.q.DeleteMemoryWithOrg(ctx, db.DeleteMemoryWithOrgParams{
		ID:             input.ID,
		UserID:         input.UserID,
		OrganizationID: input.OrganizationID,
	})
}

func (s Store) CreateMemory(ctx context.Context, input corememories.CreateMemoryInput) error {
	_, err := s.q.CreateMemory(ctx, db.CreateMemoryParams{
		UserID:         input.UserID,
		OrganizationID: input.OrganizationID,
		Content:        input.Content,
		Type:           input.Type,
		Metadata:       input.Metadata,
	})
	return err
}

func (s Store) UpdateMemory(ctx context.Context, input corememories.UpdateMemoryStoreInput) (corememories.MemoryRecord, error) {
	row, err := s.q.UpdateMemory(ctx, db.UpdateMemoryParams{
		ID:       input.ID,
		UserID:   input.UserID,
		Content:  input.Content,
		Type:     input.Type,
		Metadata: input.Metadata,
	})
	if err != nil {
		return corememories.MemoryRecord{}, err
	}
	return mapMemoryRow(row), nil
}

func (s Store) UpdateMemoryWithOrg(ctx context.Context, input corememories.UpdateMemoryWithOrgStoreInput) (corememories.MemoryRecord, error) {
	row, err := s.q.UpdateMemoryWithOrg(ctx, db.UpdateMemoryWithOrgParams{
		ID:             input.ID,
		UserID:         input.UserID,
		OrganizationID: input.OrganizationID,
		Content:        input.Content,
		Type:           input.Type,
		Metadata:       input.Metadata,
	})
	if err != nil {
		return corememories.MemoryRecord{}, err
	}
	return mapMemoryRow(row), nil
}

func mapMemoryRows(rows []db.Memory) []corememories.MemoryRecord {
	return collections.Map(rows, mapMemoryRow)
}

func mapMemoryRow(row db.Memory) corememories.MemoryRecord {
	return corememories.MemoryRecord{
		ID:             row.ID,
		UserID:         row.UserID,
		OrganizationID: row.OrganizationID,
		Content:        row.Content,
		Type:           row.Type,
		Metadata:       row.Metadata,
		CreatedAt:      timestampString(row.CreatedAt),
		UpdatedAt:      timestampString(row.UpdatedAt),
	}
}

func timestampString(timestamp pgtype.Timestamp) string {
	if !timestamp.Valid {
		return ""
	}
	return timestamp.Time.UTC().Format(time.RFC3339)
}
