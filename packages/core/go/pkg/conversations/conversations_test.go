package conversations

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

// MockRepository is a mock implementation of ConversationRepository
type MockRepository struct {
	mock.Mock
}

func (m *MockRepository) ListConversations(ctx context.Context, userID string, orgID *int, limit, offset int) ([]ConversationRecord, int, error) {
	args := m.Called(ctx, userID, orgID, limit, offset)
	records, ok := args.Get(0).([]ConversationRecord)
	if !ok {
		return nil, 0, fmt.Errorf("unexpected conversations type: %T", args.Get(0))
	}
	return records, args.Int(1), args.Error(2)
}

func (m *MockRepository) GetConversation(ctx context.Context, userID string, orgID *int, conversationID int) (*ConversationRecord, error) {
	args := m.Called(ctx, userID, orgID, conversationID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	record, ok := args.Get(0).(*ConversationRecord)
	if !ok {
		return nil, fmt.Errorf("unexpected conversation type: %T", args.Get(0))
	}
	return record, args.Error(1)
}

func (m *MockRepository) CreateConversation(ctx context.Context, input ConversationCreateInput) (*ConversationRecord, error) {
	args := m.Called(ctx, input)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	record, ok := args.Get(0).(*ConversationRecord)
	if !ok {
		return nil, fmt.Errorf("unexpected created conversation type: %T", args.Get(0))
	}
	return record, args.Error(1)
}

func (m *MockRepository) UpdateConversation(ctx context.Context, userID string, orgID *int, conversationID int, update ConversationUpdatePayload) (bool, error) {
	args := m.Called(ctx, userID, orgID, conversationID, update)
	return args.Bool(0), args.Error(1)
}

func (m *MockRepository) DeleteConversation(ctx context.Context, userID string, orgID *int, conversationID int) (bool, error) {
	args := m.Called(ctx, userID, orgID, conversationID)
	return args.Bool(0), args.Error(1)
}

func TestGetConversation(t *testing.T) {
	mockRepo := new(MockRepository)
	service := NewConversationService(mockRepo)
	ctx := context.Background()

	t.Run("success", func(t *testing.T) {
		expectedRecord := &ConversationRecord{
			ID:        123,
			UserInput: "test input",
			Timestamp: time.Now(),
		}
		mockRepo.On("GetConversation", mock.Anything, "user1", (*int)(nil), 123).Return(expectedRecord, nil)

		result, err := service.GetConversation(ctx, "user1", nil, 123)

		require.NoError(t, err)
		assert.NotNil(t, result)
		assert.Equal(t, 123, result.ID)
		assert.Equal(t, "test input", result.UserInput)
		mockRepo.AssertExpectations(t)
	})

	t.Run("not found", func(t *testing.T) {
		mockRepo.On("GetConversation", mock.Anything, "user1", (*int)(nil), 999).Return((*ConversationRecord)(nil), errors.New("not found"))

		result, err := service.GetConversation(ctx, "user1", nil, 999)

		require.Error(t, err)
		assert.Nil(t, result)
	})

	t.Run("not found nil record", func(t *testing.T) {
		mockRepo.On("GetConversation", mock.Anything, "user1", (*int)(nil), 1001).Return((*ConversationRecord)(nil), nil)

		result, err := service.GetConversation(ctx, "user1", nil, 1001)

		require.ErrorIs(t, err, ErrConversationNotFound)
		assert.Nil(t, result)
	})
}

func TestCreateConversation(t *testing.T) {
	mockRepo := new(MockRepository)
	service := NewConversationService(mockRepo)
	ctx := context.Background()

	t.Run("success with sanitation", func(t *testing.T) {
		input := ConversationCreateInput{
			UserID:     "user1",
			UserInput:  "test input",
			AgentCount: 0, // Should default to 4
		}

		expectedInput := input
		expectedInput.AgentCount = 4 // Service logic defaults to 4

		createdRecord := &ConversationRecord{
			ID:         1,
			UserInput:  "test input",
			AgentCount: 4,
			Timestamp:  time.Now(),
		}

		mockRepo.On("CreateConversation", mock.Anything, expectedInput).Return(createdRecord, nil)

		result, err := service.CreateConversation(ctx, input)

		require.NoError(t, err)
		assert.NotNil(t, result)
		assert.Equal(t, 4, result.AgentCount)
		mockRepo.AssertExpectations(t)
	})

	t.Run("sanitizes optional fields and propagates errors", func(t *testing.T) {
		result := string(make([]byte, maxResultLength+10))
		model := string(make([]byte, maxModelLength+10))
		input := ConversationCreateInput{
			UserID:     "user2",
			UserInput:  string(make([]byte, maxTitleLength+10)),
			Result:     &result,
			Model:      &model,
			AgentCount: 2,
		}

		mockRepo.On("CreateConversation", mock.Anything, mock.MatchedBy(func(p ConversationCreateInput) bool {
			return len(p.UserInput) == maxTitleLength &&
				p.Result != nil && len(*p.Result) == maxResultLength &&
				p.Model != nil && len(*p.Model) == maxModelLength &&
				p.AgentCount == 2
		})).Return((*ConversationRecord)(nil), errors.New("create failed")).Once()

		view, err := service.CreateConversation(ctx, input)
		require.ErrorContains(t, err, "create failed")
		assert.Nil(t, view)
	})
}

func TestListConversations(t *testing.T) {
	mockRepo := new(MockRepository)
	service := NewConversationService(mockRepo)
	ctx := context.Background()

	t.Run("success", func(t *testing.T) {
		records := []ConversationRecord{
			{ID: 1, UserInput: "test 1"},
			{ID: 2, UserInput: "test 2"},
		}
		mockRepo.On("ListConversations", mock.Anything, "user1", (*int)(nil), 10, 0).Return(records, 2, nil)

		page, err := service.ListConversations(ctx, "user1", nil, 10, 0)

		require.NoError(t, err)
		assert.NotNil(t, page)
		assert.Len(t, page.Conversations, 2)
		assert.Equal(t, 2, page.Total)
		assert.False(t, page.HasMore)
	})

	t.Run("has more pages", func(t *testing.T) {
		records := []ConversationRecord{
			{ID: 1, UserInput: "test 1"},
		}
		mockRepo.On("ListConversations", mock.Anything, "user2", (*int)(nil), 1, 0).Return(records, 5, nil)

		page, err := service.ListConversations(ctx, "user2", nil, 1, 0)

		require.NoError(t, err)
		assert.True(t, page.HasMore)
	})

	t.Run("error", func(t *testing.T) {
		mockRepo.On("ListConversations", mock.Anything, "user3", (*int)(nil), 10, 0).Return([]ConversationRecord{}, 0, errors.New("db error"))

		page, err := service.ListConversations(ctx, "user3", nil, 10, 0)

		require.Error(t, err)
		assert.Nil(t, page)
	})
}

func TestUpdateConversation(t *testing.T) {
	mockRepo := new(MockRepository)
	service := NewConversationService(mockRepo)
	ctx := context.Background()

	t.Run("update title", func(t *testing.T) {
		title := "New Title"
		input := ConversationUpdateInput{Title: &title}

		mockRepo.On("UpdateConversation", mock.Anything, "user1", (*int)(nil), 1, mock.MatchedBy(func(p ConversationUpdatePayload) bool {
			return p.UserInput != nil && *p.UserInput == "New Title"
		})).Return(true, nil).Once()

		result, err := service.UpdateConversation(ctx, "user1", nil, 1, input)

		require.NoError(t, err)
		assert.True(t, result)
		mockRepo.AssertExpectations(t)
	})

	t.Run("update result", func(t *testing.T) {
		result := "New Result"
		input := ConversationUpdateInput{Result: &result}

		mockRepo.On("UpdateConversation", mock.Anything, "user1", (*int)(nil), 2, mock.MatchedBy(func(p ConversationUpdatePayload) bool {
			return p.Result != nil && *p.Result == "New Result"
		})).Return(true, nil).Once()

		res, err := service.UpdateConversation(ctx, "user1", nil, 2, input)

		require.NoError(t, err)
		assert.True(t, res)
	})

	t.Run("no fields to update", func(t *testing.T) {
		input := ConversationUpdateInput{}

		result, err := service.UpdateConversation(ctx, "user1", nil, 1, input)

		require.NoError(t, err)
		assert.False(t, result)
	})

	t.Run("empty title not updated", func(t *testing.T) {
		emptyTitle := ""
		input := ConversationUpdateInput{Title: &emptyTitle}

		result, err := service.UpdateConversation(ctx, "user1", nil, 1, input)

		require.NoError(t, err)
		assert.False(t, result)
	})

	t.Run("updates all non-empty fields", func(t *testing.T) {
		title := string(make([]byte, maxTitleLength+5))
		resultText := string(make([]byte, maxResultLength+5))
		execTime := 42
		model := string(make([]byte, maxModelLength+5))
		agentCount := 7

		mockRepo.On("UpdateConversation", mock.Anything, "user1", (*int)(nil), 3, mock.MatchedBy(func(p ConversationUpdatePayload) bool {
			return p.UserInput != nil && len(*p.UserInput) == maxTitleLength &&
				p.Result != nil && len(*p.Result) == maxResultLength &&
				p.ExecutionTime != nil && *p.ExecutionTime == execTime &&
				p.Model != nil && len(*p.Model) == maxModelLength &&
				p.AgentCount != nil && *p.AgentCount == agentCount
		})).Return(true, nil).Once()

		res, err := service.UpdateConversation(ctx, "user1", nil, 3, ConversationUpdateInput{
			Title:         &title,
			Result:        &resultText,
			ExecutionTime: &execTime,
			Model:         &model,
			AgentCount:    &agentCount,
		})

		require.NoError(t, err)
		assert.True(t, res)
	})

	t.Run("ignores empty model and non-positive agent count", func(t *testing.T) {
		model := ""
		agentCount := 0
		res, err := service.UpdateConversation(ctx, "user1", nil, 4, ConversationUpdateInput{
			Model:      &model,
			AgentCount: &agentCount,
		})

		require.NoError(t, err)
		assert.False(t, res)
	})

	t.Run("propagates update errors", func(t *testing.T) {
		resultText := "new result"
		mockRepo.On("UpdateConversation", mock.Anything, "user1", (*int)(nil), 5, mock.Anything).Return(false, errors.New("update failed")).Once()

		res, err := service.UpdateConversation(ctx, "user1", nil, 5, ConversationUpdateInput{Result: &resultText})

		require.ErrorContains(t, err, "update failed")
		assert.False(t, res)
	})
}

func TestDeleteConversation(t *testing.T) {
	mockRepo := new(MockRepository)
	service := NewConversationService(mockRepo)
	ctx := context.Background()

	t.Run("success", func(t *testing.T) {
		mockRepo.On("DeleteConversation", mock.Anything, "user1", (*int)(nil), 1).Return(true, nil).Once()

		result, err := service.DeleteConversation(ctx, "user1", nil, 1)

		require.NoError(t, err)
		assert.True(t, result)
	})

	t.Run("not found", func(t *testing.T) {
		mockRepo.On("DeleteConversation", mock.Anything, "user1", (*int)(nil), 999).Return(false, nil).Once()

		result, err := service.DeleteConversation(ctx, "user1", nil, 999)

		require.NoError(t, err)
		assert.False(t, result)
	})

	t.Run("error", func(t *testing.T) {
		mockRepo.On("DeleteConversation", mock.Anything, "user1", (*int)(nil), 500).Return(false, errors.New("db error")).Once()

		result, err := service.DeleteConversation(ctx, "user1", nil, 500)

		require.Error(t, err)
		assert.False(t, result)
	})
}

func TestSanitizeFunctions(t *testing.T) {
	t.Run("sanitizeTitle truncates", func(t *testing.T) {
		longTitle := string(make([]byte, 300))
		result := sanitizeTitle(longTitle)
		assert.Len(t, result, 200)
	})

	t.Run("sanitizeTitle preserves short", func(t *testing.T) {
		result := sanitizeTitle("short")
		assert.Equal(t, "short", result)
	})

	t.Run("sanitizeResult truncates", func(t *testing.T) {
		longResult := string(make([]byte, 3000))
		result := sanitizeResult(longResult)
		assert.Len(t, result, 2000)
	})

	t.Run("sanitizeModel truncates", func(t *testing.T) {
		longModel := string(make([]byte, 200))
		result := sanitizeModel(longModel)
		assert.Len(t, result, 120)
	})
}

func TestToApiView(t *testing.T) {
	t.Run("with all fields", func(t *testing.T) {
		result := "test result"
		execTime := 100
		model := "gpt-4"
		now := time.Now()

		record := &ConversationRecord{
			ID:            1,
			Timestamp:     now,
			UserInput:     "test input",
			Result:        &result,
			ExecutionTime: &execTime,
			Model:         &model,
			AgentCount:    4,
			AssistantSources: []SourceReference{
				{Title: "Source 1", URL: "https://example.com"},
			},
			AgentStatuses: []AgentStatusRecord{
				{Status: "completed"},
			},
		}

		view := toApiView(record)

		assert.Equal(t, 1, view.ID)
		assert.Equal(t, "test input", view.UserInput)
		assert.Equal(t, "test result", view.Result)
		assert.Equal(t, 100, view.ExecutionTime)
		assert.Equal(t, "gpt-4", view.Model)
		assert.Equal(t, 4, view.AgentCount)
		assert.Len(t, view.Sources, 1)
		assert.Len(t, view.AgentStatuses, 1)
	})

	t.Run("with nil fields", func(t *testing.T) {
		record := &ConversationRecord{
			ID:        1,
			Timestamp: time.Now(),
			UserInput: "test",
		}

		view := toApiView(record)

		assert.Empty(t, view.Result)
		assert.Equal(t, 0, view.ExecutionTime)
		assert.Empty(t, view.Model)
		assert.NotNil(t, view.Sources)
		assert.NotNil(t, view.AgentStatuses)
	})

	t.Run("compacts execution metadata for API responses", func(t *testing.T) {
		large := strings.Repeat("x", maxApiMetadataTextLength+100)
		statuses := make([]AgentStatusRecord, maxApiMetadataItems+1)
		toolEvents := make([]ToolUsageEventRecord, maxApiMetadataItems+1)
		for i := range statuses {
			statuses[i] = AgentStatusRecord{Status: "completed", Result: &large, Reasoning: &large}
			toolEvents[i] = ToolUsageEventRecord{
				ToolName:      "search",
				Arguments:     map[string]any{"secret": large},
				ResultPreview: large,
				Error:         large,
			}
		}
		record := &ConversationRecord{
			ID:            1,
			Timestamp:     time.Now(),
			UserInput:     "test",
			AgentStatuses: statuses,
			ToolEvents:    toolEvents,
		}

		view := toApiView(record)

		assert.Len(t, view.AgentStatuses, maxApiMetadataItems)
		assert.Len(t, view.ToolEvents, maxApiMetadataItems)
		assert.Nil(t, view.ToolEvents[0].Arguments)
		assert.LessOrEqual(t, len(*view.AgentStatuses[0].Result), maxApiMetadataTextLength+len("...[truncated]"))
		assert.LessOrEqual(t, len(view.ToolEvents[0].ResultPreview), maxApiMetadataTextLength+len("...[truncated]"))
	})

	t.Run("uses status sources as fallback", func(t *testing.T) {
		record := &ConversationRecord{
			ID:            1,
			Timestamp:     time.Now(),
			StatusSources: []SourceReference{{Title: "Status Source"}},
		}

		view := toApiView(record)

		assert.Len(t, view.Sources, 1)
		assert.Equal(t, "Status Source", view.Sources[0].Title)
	})
}

func TestToApiViewDefaultsNilMetadataSlices(t *testing.T) {
	view := toApiView(&ConversationRecord{
		ID:        1,
		Timestamp: time.Unix(0, 0).UTC(),
		UserInput: "hello",
	})

	assert.NotNil(t, view.AgentStatuses)
	assert.Empty(t, view.AgentStatuses)
	assert.NotNil(t, view.ToolEvents)
	assert.Empty(t, view.ToolEvents)
}

func TestTruncateMetadataTextKeepsShortValues(t *testing.T) {
	assert.Equal(t, "short", truncateMetadataText("short"))
}

func TestConversationStructs(t *testing.T) {
	t.Run("ConversationApiView", func(t *testing.T) {
		view := ConversationApiView{
			ID:            1,
			Timestamp:     "2023-01-01T00:00:00Z",
			UserInput:     "test",
			Result:        "result",
			ExecutionTime: 100,
			Model:         "gpt-4",
			AgentCount:    4,
			Sources:       []SourceReference{},
			AgentStatuses: []AgentStatusRecord{},
		}

		assert.Equal(t, 1, view.ID)
	})

	t.Run("ConversationsPage", func(t *testing.T) {
		page := ConversationsPage{
			Conversations: []ConversationApiView{},
			Total:         100,
			Limit:         10,
			Offset:        0,
			HasMore:       true,
		}

		assert.True(t, page.HasMore)
	})

	t.Run("SourceReference", func(t *testing.T) {
		snippet := "test snippet"
		src := SourceReference{
			Title:   "Test",
			URL:     "https://example.com",
			Snippet: &snippet,
		}

		assert.Equal(t, "Test", src.Title)
	})

	t.Run("AgentStatusRecord", func(t *testing.T) {
		agentID := 1
		progress := 0.5
		result := "done"
		status := AgentStatusRecord{
			Status:   "running",
			AgentID:  &agentID,
			Progress: &progress,
			Result:   &result,
		}

		assert.Equal(t, "running", status.Status)
	})
}
