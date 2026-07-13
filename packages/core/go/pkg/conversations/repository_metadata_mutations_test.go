package conversations

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type recordingConversationStore struct {
	conversations []ConversationData
	messages      map[int32][]MessageData
	err           error

	lastCreateInput    CreateConversationStoreInput
	lastUpdateInput    UpdateConversationStoreInput
	lastUpdateOrgInput UpdateConversationWithOrgInput
	lastDeleteInput    SoftDeleteConversationInput
	lastDeleteOrgInput SoftDeleteConversationWithOrgInput
}

func (s *recordingConversationStore) CountConversationsByUser(context.Context, *string) (int64, error) {
	return int64(len(s.conversations)), s.err
}

func (s *recordingConversationStore) CountConversationsByUserAndOrg(context.Context, CountConversationsByUserAndOrgInput) (int64, error) {
	return int64(len(s.conversations)), s.err
}

func (s *recordingConversationStore) GetConversationsByUser(context.Context, GetConversationsByUserInput) ([]ConversationData, error) {
	return s.conversations, s.err
}

func (s *recordingConversationStore) GetConversationsByUserAndOrg(context.Context, GetConversationsByUserAndOrgInput) ([]ConversationData, error) {
	return s.conversations, s.err
}

func (s *recordingConversationStore) GetMessagesByConversation(_ context.Context, conversationID int32) ([]MessageData, error) {
	return s.messages[conversationID], nil
}

func (s *recordingConversationStore) GetConversationByUserAndID(context.Context, GetConversationByUserAndIDInput) (ConversationData, error) {
	if s.err != nil {
		return ConversationData{}, s.err
	}
	if len(s.conversations) == 0 {
		return ConversationData{}, ErrConversationRecordNotFound
	}
	return s.conversations[0], nil
}

func (s *recordingConversationStore) GetConversationByUserOrgAndID(context.Context, GetConversationByUserOrgAndIDInput) (ConversationData, error) {
	return s.GetConversationByUserAndID(context.Background(), GetConversationByUserAndIDInput{})
}

func (s *recordingConversationStore) CreateConversation(_ context.Context, input CreateConversationStoreInput) (ConversationData, error) {
	s.lastCreateInput = input
	if s.err != nil {
		return ConversationData{}, s.err
	}
	return ConversationData{
		ID:         10,
		UserID:     input.UserID,
		UserInput:  input.UserInput,
		Model:      input.Model,
		AgentCount: input.AgentCount,
	}, nil
}

func (s *recordingConversationStore) UpdateConversation(_ context.Context, input UpdateConversationStoreInput) error {
	s.lastUpdateInput = input
	return s.err
}

func (s *recordingConversationStore) UpdateConversationWithOrg(_ context.Context, input UpdateConversationWithOrgInput) error {
	s.lastUpdateOrgInput = input
	return s.err
}

func (s *recordingConversationStore) SoftDeleteConversation(_ context.Context, input SoftDeleteConversationInput) error {
	s.lastDeleteInput = input
	return s.err
}

func (s *recordingConversationStore) SoftDeleteConversationWithOrg(_ context.Context, input SoftDeleteConversationWithOrgInput) error {
	s.lastDeleteOrgInput = input
	return s.err
}

func TestPgConversationRepositoryMetadataAndScopedMutations(t *testing.T) {
	userID, orgID, orgID32 := "user-1", 7, int32(7)
	execTime := 3.8
	store := &recordingConversationStore{
		conversations: []ConversationData{{
			ID: 1, Timestamp: time.Unix(10, 0), UserID: &userID, OrganizationID: &orgID32,
			UserInput: "hello", ExecutionTime: &execTime, AgentCount: 2,
		}},
		messages: map[int32][]MessageData{1: {
			{Role: "user", Trace: []byte(`{}`)},
			{Role: "assistant", Sources: []byte(`[{"title":"doc-a"}]`)},
		}},
	}
	repo := NewConversationRepository(store)

	records, _, err := repo.ListConversations(context.Background(), userID, nil, 10, 0)
	require.NoError(t, err)
	require.Len(t, records, 1)
	assert.Equal(t, "doc-a", records[0].AssistantSources[0].Title)

	record, err := repo.GetConversation(context.Background(), userID, &orgID, 1)
	require.NoError(t, err)
	assert.Equal(t, orgID, *record.OrganizationID)

	_, err = repo.CreateConversation(context.Background(), ConversationCreateInput{
		UserID: userID, OrganizationID: &orgID, UserInput: "new", AgentCount: 2,
	})
	require.NoError(t, err)
	assert.Equal(t, orgID32, *store.lastCreateInput.OrganizationID)

	updatedInput, elapsed := "updated", 11
	ok, err := repo.UpdateConversation(context.Background(), userID, &orgID, 1, ConversationUpdatePayload{
		UserInput: &updatedInput, ExecutionTime: &elapsed,
	})
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, float64(elapsed), *store.lastUpdateOrgInput.ExecutionTime)

	ok, err = repo.DeleteConversation(context.Background(), userID, &orgID, 1)
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, orgID32, *store.lastDeleteOrgInput.OrganizationID)
}

func TestPgConversationRepositoryMissingMutationTargets(t *testing.T) {
	_, _, err := NewConversationRepository(stubConversationStore{}).
		ListConversations(context.Background(), "user", nil, math.MinInt32-1, 0)
	require.Error(t, err)

	repo := NewConversationRepository(&recordingConversationStore{messages: map[int32][]MessageData{}})
	ok, err := repo.UpdateConversation(context.Background(), "user", nil, 1, ConversationUpdatePayload{})
	require.NoError(t, err)
	assert.False(t, ok)
	ok, err = repo.DeleteConversation(context.Background(), "user", nil, 1)
	require.NoError(t, err)
	assert.False(t, ok)

	repo = NewConversationRepository(&errorConversationStore{getErr: errors.New("lookup failed")})
	_, err = repo.UpdateConversation(context.Background(), "user", nil, 1, ConversationUpdatePayload{})
	require.Error(t, err)
	_, err = repo.DeleteConversation(context.Background(), "user", nil, 1)
	require.Error(t, err)
}
