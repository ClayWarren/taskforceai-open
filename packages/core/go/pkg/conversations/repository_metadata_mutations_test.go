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

func TestPgConversationRepositoryListAndGetWithMetadata(t *testing.T) {
	userID := "user-1"
	orgID32 := int32(7)
	execTime := 3.8
	model := "model-a"
	trace := []byte(`{"steps":[{"action":{"metadata":{"source":"doc-a"}}}],"agent_statuses":[{"status":"completed"}]}`)
	store := &recordingConversationStore{
		conversations: []ConversationData{{
			ID:             1,
			Timestamp:      time.Unix(10, 0),
			UserID:         &userID,
			OrganizationID: &orgID32,
			UserInput:      "hello",
			Result:         &model,
			ExecutionTime:  &execTime,
			Model:          &model,
			AgentCount:     2,
		}},
		messages: map[int32][]MessageData{1: {
			{Role: "user", Trace: []byte(`{}`)},
			{Role: "assistant", Trace: trace},
		}},
	}
	repo := NewConversationRepository(store)

	records, total, err := repo.ListConversations(context.Background(), userID, nil, math.MaxInt32+1, math.MaxInt32+1)
	require.NoError(t, err)
	assert.Equal(t, 1, total)
	require.Len(t, records, 1)
	assert.Equal(t, "doc-a", records[0].AssistantSources[0].Title)
	assert.Equal(t, "completed", records[0].AgentStatuses[0].Status)

	orgID := 7
	record, err := repo.GetConversation(context.Background(), userID, &orgID, 1)
	require.NoError(t, err)
	require.NotNil(t, record)
	assert.Equal(t, orgID, *record.OrganizationID)
	assert.Equal(t, 3, *record.ExecutionTime)
}

func TestPgConversationRepositoryCreateUpdateDeleteBranches(t *testing.T) {
	userID := "user-1"
	model := "model-a"
	orgID := 7
	store := &recordingConversationStore{
		conversations: []ConversationData{{ID: 4, UserID: &userID, UserInput: "old", AgentCount: 1}},
		messages:      map[int32][]MessageData{},
	}
	repo := NewConversationRepository(store)

	created, err := repo.CreateConversation(context.Background(), ConversationCreateInput{
		UserID:         userID,
		OrganizationID: &orgID,
		UserInput:      "new",
		Model:          &model,
		AgentCount:     math.MaxInt32 + 10,
	})
	require.NoError(t, err)
	assert.Equal(t, 10, created.ID)
	assert.Equal(t, int32(math.MaxInt32), store.lastCreateInput.AgentCount)

	updatedInput := "updated"
	execTime := 11
	agentCount := math.MaxInt32 + 100
	ok, err := repo.UpdateConversation(context.Background(), userID, &orgID, 4, ConversationUpdatePayload{
		UserInput:     &updatedInput,
		ExecutionTime: &execTime,
		Model:         &model,
		AgentCount:    &agentCount,
	})
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, int32(math.MaxInt32), *store.lastUpdateOrgInput.AgentCount)
	assert.Equal(t, float64(execTime), *store.lastUpdateOrgInput.ExecutionTime)

	ok, err = repo.DeleteConversation(context.Background(), userID, &orgID, 4)
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, int32(orgID), *store.lastDeleteOrgInput.OrganizationID)

	ok, err = repo.UpdateConversation(context.Background(), userID, nil, 4, ConversationUpdatePayload{})
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, int32(4), store.lastUpdateInput.ID)

	ok, err = repo.DeleteConversation(context.Background(), userID, nil, 4)
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, int32(4), store.lastDeleteInput.ID)
}

func TestPgConversationRepositoryErrors(t *testing.T) {
	repo := NewConversationRepository(&recordingConversationStore{err: errors.New("boom")})
	_, _, err := repo.ListConversations(context.Background(), "user", nil, 1, 0)
	require.Error(t, err)
	_, err = repo.GetConversation(context.Background(), "user", nil, 1)
	require.Error(t, err)
	_, err = repo.CreateConversation(context.Background(), ConversationCreateInput{UserID: "user", AgentCount: 1})
	require.Error(t, err)
	ok, err := repo.UpdateConversation(context.Background(), "user", nil, 1, ConversationUpdatePayload{})
	require.Error(t, err)
	assert.False(t, ok)
	ok, err = repo.DeleteConversation(context.Background(), "user", nil, 1)
	require.Error(t, err)
	assert.False(t, ok)

	emptyRepo := NewConversationRepository(&recordingConversationStore{messages: map[int32][]MessageData{}})
	record, err := emptyRepo.GetConversation(context.Background(), "user", nil, 1)
	require.ErrorIs(t, err, ErrConversationNotFound)
	assert.Nil(t, record)
	ok, err = emptyRepo.UpdateConversation(context.Background(), "user", nil, 1, ConversationUpdatePayload{})
	require.NoError(t, err)
	assert.False(t, ok)
	ok, err = emptyRepo.DeleteConversation(context.Background(), "user", nil, 1)
	require.NoError(t, err)
	assert.False(t, ok)

	_, _, err = emptyRepo.ListConversations(context.Background(), "user", nil, math.MinInt32-1, 0)
	assert.Error(t, err)
}
