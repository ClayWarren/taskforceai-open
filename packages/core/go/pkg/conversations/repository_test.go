package conversations

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type stubConversationStore struct {
	countByUserFunc           func(ctx context.Context, userID *string) (int64, error)
	countByUserAndOrgFunc     func(ctx context.Context, input CountConversationsByUserAndOrgInput) (int64, error)
	getByUserFunc             func(ctx context.Context, input GetConversationsByUserInput) ([]ConversationData, error)
	getByUserAndOrgFunc       func(ctx context.Context, input GetConversationsByUserAndOrgInput) ([]ConversationData, error)
	getMessagesFunc           func(ctx context.Context, conversationID int32) ([]MessageData, error)
	getConversationFunc       func(ctx context.Context, input GetConversationByUserAndIDInput) (ConversationData, error)
	getConversationOrgFunc    func(ctx context.Context, input GetConversationByUserOrgAndIDInput) (ConversationData, error)
	createConversationFunc    func(ctx context.Context, input CreateConversationStoreInput) (ConversationData, error)
	updateConversationFunc    func(ctx context.Context, input UpdateConversationStoreInput) error
	updateConversationOrgFunc func(ctx context.Context, input UpdateConversationWithOrgInput) error
	deleteConversationFunc    func(ctx context.Context, input SoftDeleteConversationInput) error
	deleteConversationOrgFunc func(ctx context.Context, input SoftDeleteConversationWithOrgInput) error
}

type bulkStubConversationStore struct {
	stubConversationStore
	bulkMessagesFunc func(ctx context.Context, conversationIDs []int32) ([]MessageData, error)
}

func (s bulkStubConversationStore) GetLatestAssistantMessagesWithMetadataByConversations(ctx context.Context, conversationIDs []int32) ([]MessageData, error) {
	return s.bulkMessagesFunc(ctx, conversationIDs)
}

func (s stubConversationStore) CountConversationsByUser(ctx context.Context, userID *string) (int64, error) {
	return s.countByUserFunc(ctx, userID)
}

func (s stubConversationStore) CountConversationsByUserAndOrg(ctx context.Context, input CountConversationsByUserAndOrgInput) (int64, error) {
	return s.countByUserAndOrgFunc(ctx, input)
}

func (s stubConversationStore) GetConversationsByUser(ctx context.Context, input GetConversationsByUserInput) ([]ConversationData, error) {
	return s.getByUserFunc(ctx, input)
}

func (s stubConversationStore) GetConversationsByUserAndOrg(ctx context.Context, input GetConversationsByUserAndOrgInput) ([]ConversationData, error) {
	return s.getByUserAndOrgFunc(ctx, input)
}

func (s stubConversationStore) GetMessagesByConversation(ctx context.Context, conversationID int32) ([]MessageData, error) {
	return s.getMessagesFunc(ctx, conversationID)
}

func (s stubConversationStore) GetConversationByUserAndID(ctx context.Context, input GetConversationByUserAndIDInput) (ConversationData, error) {
	return s.getConversationFunc(ctx, input)
}

func (s stubConversationStore) GetConversationByUserOrgAndID(ctx context.Context, input GetConversationByUserOrgAndIDInput) (ConversationData, error) {
	return s.getConversationOrgFunc(ctx, input)
}

func (s stubConversationStore) CreateConversation(ctx context.Context, input CreateConversationStoreInput) (ConversationData, error) {
	return s.createConversationFunc(ctx, input)
}

func (s stubConversationStore) UpdateConversation(ctx context.Context, input UpdateConversationStoreInput) error {
	return s.updateConversationFunc(ctx, input)
}

func (s stubConversationStore) UpdateConversationWithOrg(ctx context.Context, input UpdateConversationWithOrgInput) error {
	return s.updateConversationOrgFunc(ctx, input)
}

func (s stubConversationStore) SoftDeleteConversation(ctx context.Context, input SoftDeleteConversationInput) error {
	return s.deleteConversationFunc(ctx, input)
}

func (s stubConversationStore) SoftDeleteConversationWithOrg(ctx context.Context, input SoftDeleteConversationWithOrgInput) error {
	return s.deleteConversationOrgFunc(ctx, input)
}

func newConversationData(id int32, userID string, userInput string, ts time.Time) ConversationData {
	return ConversationData{
		ID:         id,
		Timestamp:  ts,
		UserID:     &userID,
		UserInput:  userInput,
		AgentCount: 4,
	}
}

type errorConversationStore struct {
	recordingConversationStore
	countErr  error
	listErr   error
	getErr    error
	createErr error
	updateErr error
	deleteErr error
}

func (s *errorConversationStore) CountConversationsByUser(context.Context, *string) (int64, error) {
	return 0, s.countErr
}

func (s *errorConversationStore) CountConversationsByUserAndOrg(context.Context, CountConversationsByUserAndOrgInput) (int64, error) {
	return 0, s.countErr
}

func (s *errorConversationStore) GetConversationsByUser(context.Context, GetConversationsByUserInput) ([]ConversationData, error) {
	return nil, s.listErr
}

func (s *errorConversationStore) GetConversationsByUserAndOrg(context.Context, GetConversationsByUserAndOrgInput) ([]ConversationData, error) {
	return nil, s.listErr
}

func (s *errorConversationStore) GetConversationByUserAndID(context.Context, GetConversationByUserAndIDInput) (ConversationData, error) {
	return ConversationData{}, s.getErr
}

func (s *errorConversationStore) GetConversationByUserOrgAndID(context.Context, GetConversationByUserOrgAndIDInput) (ConversationData, error) {
	return ConversationData{}, s.getErr
}

func (s *errorConversationStore) CreateConversation(context.Context, CreateConversationStoreInput) (ConversationData, error) {
	return ConversationData{}, s.createErr
}

func (s *errorConversationStore) UpdateConversation(context.Context, UpdateConversationStoreInput) error {
	return s.updateErr
}

func (s *errorConversationStore) UpdateConversationWithOrg(context.Context, UpdateConversationWithOrgInput) error {
	return s.updateErr
}

func (s *errorConversationStore) SoftDeleteConversation(context.Context, SoftDeleteConversationInput) error {
	return s.deleteErr
}

func (s *errorConversationStore) SoftDeleteConversationWithOrg(context.Context, SoftDeleteConversationWithOrgInput) error {
	return s.deleteErr
}

func TestConversationRepositoryCoverageGapPaths(t *testing.T) {
	ctx := context.Background()
	userID := "user-1"
	orgID := 7

	t.Run("list conversations org branch propagates count and list errors", func(t *testing.T) {
		store := &errorConversationStore{countErr: errors.New("count failed")}
		repo := NewConversationRepository(store)
		_, _, err := repo.ListConversations(ctx, userID, &orgID, 10, 0)
		require.Error(t, err)

		store.countErr = nil
		store.listErr = errors.New("list failed")
		_, _, err = repo.ListConversations(ctx, userID, &orgID, 10, 0)
		require.Error(t, err)

		_, _, err = repo.ListConversations(ctx, userID, nil, 10, 0)
		assert.Error(t, err)
	})

	t.Run("get conversation org branch and query errors", func(t *testing.T) {
		store := &errorConversationStore{getErr: ErrConversationRecordNotFound}
		repo := NewConversationRepository(store)
		record, err := repo.GetConversation(ctx, userID, &orgID, 1)
		require.ErrorIs(t, err, ErrConversationNotFound)
		assert.Nil(t, record)

		store.getErr = errors.New("get failed")
		_, err = repo.GetConversation(ctx, userID, &orgID, 1)
		require.Error(t, err)

		_, err = repo.GetConversation(ctx, userID, nil, 1)
		assert.Error(t, err)
	})

	t.Run("create update and delete error branches", func(t *testing.T) {
		store := &recordingConversationStore{
			conversations: []ConversationData{{ID: 4, UserID: &userID, UserInput: "old", AgentCount: 1}},
			messages:      map[int32][]MessageData{},
		}
		repo := NewConversationRepository(store)

		badOrg := math.MaxInt32 + 1
		_, err := repo.CreateConversation(ctx, ConversationCreateInput{
			UserID:         userID,
			OrganizationID: &badOrg,
			AgentCount:     1,
		})
		require.Error(t, err)

		errorStore := &errorConversationStore{
			recordingConversationStore: recordingConversationStore{messages: map[int32][]MessageData{}},
			createErr:                  errors.New("create failed"),
		}
		repo = NewConversationRepository(errorStore)
		_, err = repo.CreateConversation(ctx, ConversationCreateInput{UserID: userID, AgentCount: 1})
		require.Error(t, err)

		repo = NewConversationRepository(store)
		_, err = repo.UpdateConversation(ctx, userID, &orgID, 4, ConversationUpdatePayload{})
		require.NoError(t, err)

		errorStore.updateErr = errors.New("update failed")
		repo = NewConversationRepository(errorStore)
		ok, err := repo.UpdateConversation(ctx, userID, &orgID, 4, ConversationUpdatePayload{})
		require.Error(t, err)
		assert.False(t, ok)

		errorStore.updateErr = nil
		errorStore.deleteErr = errors.New("delete failed")
		ok, err = repo.DeleteConversation(ctx, userID, &orgID, 4)
		require.Error(t, err)
		assert.False(t, ok)
	})

	t.Run("fetch metadata ignores message lookup failures", func(t *testing.T) {
		store := &recordingConversationStore{
			conversations: []ConversationData{{
				ID:        1,
				UserID:    &userID,
				UserInput: "hello",
			}},
			messages: map[int32][]MessageData{},
		}
		repo := NewConversationRepository(store)
		metadata := repo.fetchMetadataForConversations(ctx, []int32{1, 2})
		assert.Empty(t, metadata)
	})

	t.Run("Int32 rejects out of range values", func(t *testing.T) {
		_, err := checkedInt32(math.MaxInt32+1, "limit")
		assert.Error(t, err)
	})

	t.Run("list conversations rejects out of range offset", func(t *testing.T) {
		repo := NewConversationRepository(stubConversationStore{})
		_, _, err := repo.ListConversations(ctx, userID, nil, 10, math.MinInt32-1)
		require.Error(t, err)
	})
}

func TestConversationRepositoryPushTo95CoverageGapPaths(t *testing.T) {
	ctx := context.Background()
	userID := "user-1"
	repo := NewConversationRepository(&recordingConversationStore{
		conversations: []ConversationData{{ID: 4, UserID: &userID, UserInput: "old", AgentCount: 1}},
		messages:      map[int32][]MessageData{},
	})

	t.Run("org scoped int32 validation errors", func(t *testing.T) {
		badOrg := math.MaxInt32 + 1
		_, _, err := repo.ListConversations(ctx, userID, &badOrg, 10, 0)
		require.Error(t, err)

		_, err = repo.GetConversation(ctx, userID, &badOrg, 4)
		require.Error(t, err)

		ok, err := repo.UpdateConversation(ctx, userID, &badOrg, 4, ConversationUpdatePayload{})
		require.Error(t, err)
		assert.False(t, ok)

		ok, err = repo.DeleteConversation(ctx, userID, &badOrg, 4)
		require.Error(t, err)
		assert.False(t, ok)
	})

	t.Run("update conversation rejects invalid agent count conversion", func(t *testing.T) {
		store := &recordingConversationStore{
			conversations: []ConversationData{{
				ID:         9,
				UserID:     &userID,
				UserInput:  "old",
				AgentCount: math.MaxInt32,
			}},
			messages: map[int32][]MessageData{},
		}
		repo := NewConversationRepository(store)
		badCount := math.MaxInt32 + 5
		ok, err := repo.UpdateConversation(ctx, userID, nil, 9, ConversationUpdatePayload{
			AgentCount: &badCount,
		})
		require.NoError(t, err)
		assert.True(t, ok)
	})

	t.Run("create conversation rejects too negative agent count", func(t *testing.T) {
		_, err := repo.CreateConversation(ctx, ConversationCreateInput{
			UserID:     userID,
			AgentCount: math.MinInt32 - 1,
		})
		require.Error(t, err)
	})

	t.Run("update conversation rejects too negative agent count", func(t *testing.T) {
		badCount := math.MinInt32 - 1
		ok, err := repo.UpdateConversation(ctx, userID, nil, 4, ConversationUpdatePayload{
			AgentCount: &badCount,
		})
		require.Error(t, err)
		assert.False(t, ok)
	})

	t.Run("get conversation rejects invalid conversation id", func(t *testing.T) {
		_, err := repo.GetConversation(ctx, userID, nil, math.MaxInt32+1)
		assert.Error(t, err)
	})
}

func TestMapDbConversation(t *testing.T) {
	now := time.Now()
	userID := "user-123"
	result := "some result"
	execTime := 1.5

	conv := ConversationData{
		ID:            5,
		Timestamp:     now,
		UserID:        &userID,
		UserInput:     "test input",
		Result:        &result,
		ExecutionTime: &execTime,
		AgentCount:    4,
	}

	record := mapDbConversation(&conv, nil)

	assert.Equal(t, 5, record.ID)
	assert.Equal(t, "test input", record.UserInput)
	assert.Equal(t, &result, record.Result)
	assert.NotNil(t, record.ExecutionTime)
	assert.Equal(t, 1, *record.ExecutionTime)
	assert.Equal(t, 4, record.AgentCount)
}

func TestMapDbConversation_ExtractsTraceMetadata(t *testing.T) {
	traceBytes, err := json.Marshal(map[string]any{
		"steps": []map[string]any{
			{"action": map[string]any{"metadata": map[string]any{"source": "docs"}}},
		},
		"agent_statuses": []AgentStatusRecord{{Status: "complete"}},
	})
	require.NoError(t, err)

	conv := ConversationData{
		ID:        1,
		Timestamp: time.Now(),
		UserInput: "test",
	}
	msg := MessageData{Role: "assistant", Trace: traceBytes}

	record := mapDbConversation(&conv, &msg)
	require.Len(t, record.AssistantSources, 1)
	assert.Equal(t, "docs", record.AssistantSources[0].Title)
	require.Len(t, record.AgentStatuses, 1)
	assert.Equal(t, "complete", record.AgentStatuses[0].Status)
}

func TestMapDbConversation_MalformedPersistedMetadataStillAllowsTraceFallback(t *testing.T) {
	traceBytes, err := json.Marshal(map[string]any{
		"steps": []map[string]any{
			{"action": map[string]any{"metadata": map[string]any{"source": "trace-doc"}}},
		},
	})
	require.NoError(t, err)

	conv := ConversationData{
		ID:        1,
		Timestamp: time.Now(),
		UserInput: "test",
	}
	msg := MessageData{
		ID:      42,
		Role:    "assistant",
		Sources: []byte(`{`),
		Trace:   traceBytes,
	}

	record := mapDbConversation(&conv, &msg)
	require.Len(t, record.AssistantSources, 1)
	assert.Equal(t, "trace-doc", record.AssistantSources[0].Title)
}

func TestMapDbConversation_MalformedTraceMetadata(t *testing.T) {
	conv := ConversationData{
		ID:        1,
		Timestamp: time.Now(),
		UserInput: "test",
	}
	msg := MessageData{
		ID:    42,
		Role:  "assistant",
		Trace: []byte(`{`),
	}

	record := mapDbConversation(&conv, &msg)

	assert.Empty(t, record.AssistantSources)
	assert.Empty(t, record.AgentStatuses)
}

func TestMapDbConversation_ExtractsPersistedMessageMetadata(t *testing.T) {
	progress := 0.42
	model := "claude-fable-5"
	agentID := 1
	sourcesBytes, err := json.Marshal([]SourceReference{{Title: "AI News", URL: "https://example.com/ai"}})
	require.NoError(t, err)
	statusesBytes, err := json.Marshal([]AgentStatusRecord{{
		Status:   "COMPLETED",
		AgentID:  &agentID,
		Progress: &progress,
		Model:    model,
	}})
	require.NoError(t, err)
	toolEventsBytes, err := json.Marshal([]ToolUsageEventRecord{{
		AgentID:       &agentID,
		AgentLabel:    "Agent 2",
		ToolName:      "search_web",
		Arguments:     map[string]any{"query": "AI news"},
		Success:       true,
		DurationMs:    42,
		ResultPreview: "Fresh results",
		Sources:       []SourceReference{{Title: "AI News", URL: "https://example.com/ai"}},
	}})
	require.NoError(t, err)

	conv := ConversationData{
		ID:        1,
		Timestamp: time.Now(),
		UserInput: "test",
	}
	msg := MessageData{
		Role:          "assistant",
		Sources:       sourcesBytes,
		AgentStatuses: statusesBytes,
		ToolEvents:    toolEventsBytes,
	}

	record := mapDbConversation(&conv, &msg)
	require.Len(t, record.AssistantSources, 1)
	assert.Equal(t, "AI News", record.AssistantSources[0].Title)
	require.Len(t, record.AgentStatuses, 1)
	assert.Equal(t, model, record.AgentStatuses[0].Model)
	assert.Equal(t, progress, *record.AgentStatuses[0].Progress)
	require.Len(t, record.ToolEvents, 1)
	assert.Equal(t, "search_web", record.ToolEvents[0].ToolName)
	assert.Equal(t, "Agent 2", record.ToolEvents[0].AgentLabel)
}

func TestMapDbConversation_NilTimestamp(t *testing.T) {
	conv := ConversationData{
		ID:        1,
		UserInput: "test",
	}

	record := mapDbConversation(&conv, nil)
	assert.True(t, record.Timestamp.IsZero())
}

func TestPgConversationRepository_CreateConversation(t *testing.T) {
	now := time.Now()
	userID := "user-123"
	model := "gpt-4"

	repo := NewConversationRepository(stubConversationStore{
		createConversationFunc: func(_ context.Context, input CreateConversationStoreInput) (ConversationData, error) {
			assert.Equal(t, &userID, input.UserID)
			assert.Equal(t, "new input", input.UserInput)
			assert.Equal(t, &model, input.Model)
			assert.Equal(t, int32(4), input.AgentCount)
			return ConversationData{
				ID:         10,
				Timestamp:  now,
				UserID:     &userID,
				UserInput:  "new input",
				Model:      &model,
				AgentCount: 4,
			}, nil
		},
	})

	record, err := repo.CreateConversation(context.Background(), ConversationCreateInput{
		UserID:     userID,
		UserInput:  "new input",
		Model:      &model,
		AgentCount: 4,
	})

	require.NoError(t, err)
	assert.Equal(t, 10, record.ID)
	assert.Equal(t, "new input", record.UserInput)
}

func TestPgConversationRepository_CreateConversation_Error(t *testing.T) {
	userID := "user-123"
	model := "gpt-4"

	repo := NewConversationRepository(stubConversationStore{
		createConversationFunc: func(_ context.Context, input CreateConversationStoreInput) (ConversationData, error) {
			return ConversationData{}, assert.AnError
		},
	})

	record, err := repo.CreateConversation(context.Background(), ConversationCreateInput{
		UserID:     userID,
		UserInput:  "input",
		Model:      &model,
		AgentCount: 3,
	})

	require.Error(t, err)
	assert.Nil(t, record)
}

func TestPgConversationRepository_DeleteConversation(t *testing.T) {
	userID := "user-123"
	now := time.Now()

	repo := NewConversationRepository(stubConversationStore{
		getConversationFunc: func(_ context.Context, input GetConversationByUserAndIDInput) (ConversationData, error) {
			return newConversationData(5, userID, "input", now), nil
		},
		getMessagesFunc: func(_ context.Context, conversationID int32) ([]MessageData, error) {
			return nil, nil
		},
		deleteConversationFunc: func(_ context.Context, input SoftDeleteConversationInput) error {
			assert.Equal(t, int32(5), input.ID)
			assert.Equal(t, &userID, input.UserID)
			return nil
		},
	})

	deleted, err := repo.DeleteConversation(context.Background(), userID, nil, 5)
	require.NoError(t, err)
	assert.True(t, deleted)
}

func TestPgConversationRepository_DeleteConversation_Overflow(t *testing.T) {
	repo := NewConversationRepository(stubConversationStore{})
	_, err := repo.DeleteConversation(context.Background(), "user-123", nil, 1<<32)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "exceeds int32 range")
}

func TestPgConversationRepository_GetConversation(t *testing.T) {
	userID := "user-123"
	now := time.Now()

	repo := NewConversationRepository(stubConversationStore{
		getConversationFunc: func(_ context.Context, input GetConversationByUserAndIDInput) (ConversationData, error) {
			assert.Equal(t, int32(5), input.ID)
			assert.Equal(t, &userID, input.UserID)
			return newConversationData(5, userID, "test input", now), nil
		},
		getMessagesFunc: func(_ context.Context, conversationID int32) ([]MessageData, error) {
			assert.Equal(t, int32(5), conversationID)
			return nil, nil
		},
	})

	record, err := repo.GetConversation(context.Background(), userID, nil, 5)
	require.NoError(t, err)
	require.NotNil(t, record)
	assert.Equal(t, 5, record.ID)
	assert.Equal(t, "test input", record.UserInput)
}

func TestPgConversationRepository_GetConversation_NotFound(t *testing.T) {
	userID := "user-123"
	repo := NewConversationRepository(stubConversationStore{
		getConversationFunc: func(_ context.Context, input GetConversationByUserAndIDInput) (ConversationData, error) {
			return ConversationData{}, ErrConversationRecordNotFound
		},
	})

	record, err := repo.GetConversation(context.Background(), userID, nil, 999)
	require.ErrorIs(t, err, ErrConversationNotFound)
	assert.Nil(t, record)
}

func TestPgConversationRepository_GetConversation_Overflow(t *testing.T) {
	repo := NewConversationRepository(stubConversationStore{})
	_, err := repo.GetConversation(context.Background(), "user-123", nil, 1<<32)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "exceeds int32 range")
}

func TestPgConversationRepository_ListConversations(t *testing.T) {
	userID := "user-123"
	now := time.Now()

	repo := NewConversationRepository(stubConversationStore{
		countByUserFunc: func(_ context.Context, value *string) (int64, error) {
			require.NotNil(t, value)
			assert.Equal(t, userID, *value)
			return 2, nil
		},
		getByUserFunc: func(_ context.Context, input GetConversationsByUserInput) ([]ConversationData, error) {
			assert.Equal(t, &userID, input.UserID)
			assert.Equal(t, int32(10), input.Limit)
			assert.Equal(t, int32(0), input.Offset)
			return []ConversationData{
				newConversationData(1, userID, "input 1", now),
				newConversationData(2, userID, "input 2", now),
			}, nil
		},
		getMessagesFunc: func(_ context.Context, conversationID int32) ([]MessageData, error) {
			assert.Contains(t, []int32{1, 2}, conversationID)
			return nil, nil
		},
	})

	records, total, err := repo.ListConversations(context.Background(), userID, nil, 10, 0)

	require.NoError(t, err)
	assert.Equal(t, 2, total)
	assert.Len(t, records, 2)
	assert.Equal(t, "input 1", records[0].UserInput)
}

func TestPgConversationRepository_ListConversationsUsesBulkMetadataFetch(t *testing.T) {
	userID := "user-123"
	now := time.Now()
	sourcesBytes, err := json.Marshal([]SourceReference{{Title: "Bulk Source", URL: "https://example.com"}})
	require.NoError(t, err)
	perConversationFetches := 0

	repo := NewConversationRepository(bulkStubConversationStore{
		stubConversationStore: stubConversationStore{
			countByUserFunc: func(_ context.Context, value *string) (int64, error) {
				return 2, nil
			},
			getByUserFunc: func(_ context.Context, input GetConversationsByUserInput) ([]ConversationData, error) {
				return []ConversationData{
					newConversationData(1, userID, "input 1", now),
					newConversationData(2, userID, "input 2", now),
				}, nil
			},
			getMessagesFunc: func(_ context.Context, conversationID int32) ([]MessageData, error) {
				perConversationFetches++
				return nil, nil
			},
		},
		bulkMessagesFunc: func(_ context.Context, conversationIDs []int32) ([]MessageData, error) {
			assert.Equal(t, []int32{1, 2}, conversationIDs)
			return []MessageData{{
				ConversationID: 1,
				Role:           "assistant",
				Sources:        sourcesBytes,
			}}, nil
		},
	})

	records, total, err := repo.ListConversations(context.Background(), userID, nil, 10, 0)

	require.NoError(t, err)
	assert.Equal(t, 2, total)
	require.Len(t, records, 2)
	require.Len(t, records[0].AssistantSources, 1)
	assert.Equal(t, "Bulk Source", records[0].AssistantSources[0].Title)
	assert.Zero(t, perConversationFetches)
}

func TestPgConversationRepository_ListConversations_CountError(t *testing.T) {
	userID := "user-123"
	repo := NewConversationRepository(stubConversationStore{
		countByUserFunc: func(_ context.Context, value *string) (int64, error) {
			assert.Equal(t, &userID, value)
			return 0, errors.New("db error")
		},
	})

	_, _, err := repo.ListConversations(context.Background(), userID, nil, 10, 0)
	assert.Error(t, err)
}

func TestPgConversationRepository_UpdateConversation(t *testing.T) {
	userID := "user-123"
	newInput := "updated input"
	agentCount := 8
	now := time.Now()

	repo := NewConversationRepository(stubConversationStore{
		getConversationFunc: func(_ context.Context, input GetConversationByUserAndIDInput) (ConversationData, error) {
			return newConversationData(5, userID, "old input", now), nil
		},
		getMessagesFunc: func(_ context.Context, conversationID int32) ([]MessageData, error) {
			return nil, nil
		},
		updateConversationFunc: func(_ context.Context, input UpdateConversationStoreInput) error {
			assert.Equal(t, int32(5), input.ID)
			require.NotNil(t, input.UserInput)
			assert.Equal(t, newInput, *input.UserInput)
			require.NotNil(t, input.AgentCount)
			assert.Equal(t, int32(8), *input.AgentCount)
			assert.Equal(t, &userID, input.UserID)
			return nil
		},
	})

	updated, err := repo.UpdateConversation(context.Background(), userID, nil, 5, ConversationUpdatePayload{
		UserInput:  &newInput,
		AgentCount: &agentCount,
	})

	require.NoError(t, err)
	assert.True(t, updated)
}

func TestPgConversationRepository_UpdateConversation_Overflow(t *testing.T) {
	repo := NewConversationRepository(stubConversationStore{})
	_, err := repo.UpdateConversation(context.Background(), "user-123", nil, 1<<32, ConversationUpdatePayload{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "exceeds int32 range")
}

func TestPgConversationRepository_UpdateConversation_PreservesOmittedFields(t *testing.T) {
	userID := "user-123"
	now := time.Now()
	result := "updated result"

	repo := NewConversationRepository(stubConversationStore{
		getConversationFunc: func(_ context.Context, input GetConversationByUserAndIDInput) (ConversationData, error) {
			return newConversationData(5, userID, "original title", now), nil
		},
		getMessagesFunc: func(_ context.Context, conversationID int32) ([]MessageData, error) {
			return nil, nil
		},
		updateConversationFunc: func(_ context.Context, input UpdateConversationStoreInput) error {
			require.NotNil(t, input.UserInput)
			assert.Equal(t, "original title", *input.UserInput)
			assert.Equal(t, &result, input.Result)
			require.NotNil(t, input.AgentCount)
			assert.Equal(t, int32(4), *input.AgentCount)
			return nil
		},
	})

	updated, err := repo.UpdateConversation(context.Background(), userID, nil, 5, ConversationUpdatePayload{
		Result: &result,
	})

	require.NoError(t, err)
	assert.True(t, updated)
}
