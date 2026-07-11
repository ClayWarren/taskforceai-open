package usage

import (
	"context"
	"encoding/json"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

// MockUsageRepository implements UsageRepository for testing
type MockUsageRepository struct {
	mock.Mock
}

func (m *MockUsageRepository) CreateTokenUsage(ctx context.Context, rows []TokenUsageRow) error {
	args := m.Called(ctx, rows)
	return args.Error(0)
}

func (m *MockUsageRepository) CreateToolUsage(ctx context.Context, rows []ToolUsageRow) error {
	args := m.Called(ctx, rows)
	return args.Error(0)
}

func TestTokenUsageRecorder_RecordTokenUsage_Empty(t *testing.T) {
	mockRepo := new(MockUsageRepository)
	logger := slog.Default()
	recorder := NewTokenUsageRecorder(mockRepo, logger)

	err := recorder.RecordTokenUsage(context.Background(), RecordTokenUsageParams{
		TaskID:  "task-1",
		Records: []TokenUsageRecord{},
	})

	require.NoError(t, err)
	mockRepo.AssertNotCalled(t, "CreateTokenUsage")
}

func TestTokenUsageRecorder_RecordTokenUsage_ZeroTokens(t *testing.T) {
	mockRepo := new(MockUsageRepository)
	logger := slog.Default()
	recorder := NewTokenUsageRecorder(mockRepo, logger)

	err := recorder.RecordTokenUsage(context.Background(), RecordTokenUsageParams{
		TaskID: "task-1",
		Records: []TokenUsageRecord{
			{Model: "gpt-4", Stage: "main", TotalTokens: 0},
		},
	})

	require.NoError(t, err)
	mockRepo.AssertNotCalled(t, "CreateTokenUsage")
}

func TestTokenUsageRecorder_RecordTokenUsage_Success(t *testing.T) {
	mockRepo := new(MockUsageRepository)
	logger := slog.Default()
	recorder := NewTokenUsageRecorder(mockRepo, logger)
	ctx := context.Background()

	userID := "user-123"
	plan := "pro"
	convID := 42

	mockRepo.On("CreateTokenUsage", ctx, mock.MatchedBy(func(rows []TokenUsageRow) bool {
		if len(rows) != 1 {
			return false
		}
		row := rows[0]
		return row.TaskID == "task-1" &&
			row.Model == "xai/grok-4.5" &&
			row.Stage == "main" &&
			row.PromptTokens == 100 &&
			row.CompletionTokens == 50 &&
			row.TotalTokens == 150 &&
			row.CostMicros > 0 &&
			*row.UserID == userID &&
			*row.Plan == plan &&
			*row.ConversationID == convID
	})).Return(nil).Once()

	err := recorder.RecordTokenUsage(ctx, RecordTokenUsageParams{
		TaskID:         "task-1",
		ConversationID: &convID,
		UserID:         &userID,
		Plan:           &plan,
		Records: []TokenUsageRecord{
			{
				Model:            "xai/grok-4.5",
				Stage:            "main",
				PromptTokens:     100,
				CompletionTokens: 50,
				TotalTokens:      150,
			},
		},
	})

	require.NoError(t, err)
	mockRepo.AssertExpectations(t)
}

func TestTokenUsageRecorder_RecordTokenUsage_AccountsForCachedPromptTokens(t *testing.T) {
	mockRepo := new(MockUsageRepository)
	recorder := NewTokenUsageRecorder(mockRepo, slog.Default())
	ctx := context.Background()

	mockRepo.On("CreateTokenUsage", ctx, mock.MatchedBy(func(rows []TokenUsageRow) bool {
		if len(rows) != 1 {
			return false
		}
		row := rows[0]
		var metadata map[string]int
		if err := json.Unmarshal(row.Metadata, &metadata); err != nil {
			return false
		}
		return row.PromptTokens == 1000 &&
			row.CompletionTokens == 100 &&
			row.CostMicros == 6_000 &&
			metadata["cachedPromptTokens"] == 400 &&
			metadata["billablePromptTokens"] == 600
	})).Return(nil).Once()

	err := recorder.RecordTokenUsage(ctx, RecordTokenUsageParams{
		TaskID:        "task-1",
		OverrideCosts: `{"cache-test-model":{"prompt":10,"completion":0}}`,
		Records: []TokenUsageRecord{
			{
				Model:            "cache-test-model",
				Stage:            "main",
				PromptTokens:     1000,
				CompletionTokens: 100,
				TotalTokens:      1100,
				CachedTokens:     400,
			},
		},
	})

	require.NoError(t, err)
	mockRepo.AssertExpectations(t)
}

func TestTokenUsageRecorder_RecordTokenUsage_MultipleRecords(t *testing.T) {
	mockRepo := new(MockUsageRepository)
	logger := slog.Default()
	recorder := NewTokenUsageRecorder(mockRepo, logger)
	ctx := context.Background()

	mockRepo.On("CreateTokenUsage", ctx, mock.MatchedBy(func(rows []TokenUsageRow) bool {
		return len(rows) == 2
	})).Return(nil).Once()

	err := recorder.RecordTokenUsage(ctx, RecordTokenUsageParams{
		TaskID: "task-1",
		Records: []TokenUsageRecord{
			{Model: "gpt-4", Stage: "planning", PromptTokens: 50, CompletionTokens: 25, TotalTokens: 75},
			{Model: "gpt-4", Stage: "execution", PromptTokens: 100, CompletionTokens: 50, TotalTokens: 150},
		},
	})

	require.NoError(t, err)
	mockRepo.AssertExpectations(t)
}

func TestTokenUsageRecorder_RecordTokenUsage_RepositoryError(t *testing.T) {
	mockRepo := new(MockUsageRepository)
	logger := slog.Default()
	recorder := NewTokenUsageRecorder(mockRepo, logger)
	ctx := context.Background()

	mockRepo.On("CreateTokenUsage", ctx, mock.Anything).Return(assert.AnError).Once()

	err := recorder.RecordTokenUsage(ctx, RecordTokenUsageParams{
		TaskID: "task-1",
		Records: []TokenUsageRecord{
			{Model: "gpt-4", Stage: "main", PromptTokens: 100, CompletionTokens: 50, TotalTokens: 150},
		},
	})

	require.Error(t, err)
	mockRepo.AssertExpectations(t)
}

func TestTokenUsageRecorder_RecordTokenUsage_NilLoggerRepositoryError(t *testing.T) {
	mockRepo := new(MockUsageRepository)
	recorder := NewTokenUsageRecorder(mockRepo, nil)
	ctx := context.Background()

	mockRepo.On("CreateTokenUsage", ctx, mock.Anything).Return(assert.AnError).Once()

	err := recorder.RecordTokenUsage(ctx, RecordTokenUsageParams{
		TaskID: "task-1",
		Records: []TokenUsageRecord{
			{Model: "gpt-4", Stage: "main", PromptTokens: 100, CompletionTokens: 50, TotalTokens: 150},
		},
	})

	require.Error(t, err)
	mockRepo.AssertExpectations(t)
}

func TestToolUsageRecorder_RecordToolUsage_Empty(t *testing.T) {
	mockRepo := new(MockUsageRepository)
	logger := slog.Default()
	recorder := NewToolUsageRecorder(mockRepo, logger)

	err := recorder.RecordToolUsage(context.Background(), RecordToolUsageParams{
		TaskID:  "task-1",
		Records: []ToolUsageRecord{},
	})

	require.NoError(t, err)
	mockRepo.AssertNotCalled(t, "CreateToolUsage")
}

func TestToolUsageRecorder_RecordToolUsage_Success(t *testing.T) {
	mockRepo := new(MockUsageRepository)
	logger := slog.Default()
	recorder := NewToolUsageRecorder(mockRepo, logger)
	ctx := context.Background()

	userID := "user-123"
	plan := "pro"
	convID := 42
	agentID := "agent-1"
	agentLabel := "Code Agent"
	output := "result preview"

	mockRepo.On("CreateToolUsage", ctx, mock.MatchedBy(func(rows []ToolUsageRow) bool {
		if len(rows) != 1 {
			return false
		}
		row := rows[0]
		return row.TaskID == "task-1" &&
			row.ToolName == "code_execution" &&
			row.Success == true &&
			row.DurationMs == 1500 &&
			row.Error == nil &&
			*row.UserID == userID &&
			*row.Plan == plan &&
			*row.ConversationID == convID &&
			*row.Metadata.AgentID == agentID &&
			*row.Metadata.AgentLabel == agentLabel &&
			*row.Metadata.ResultPreview == output
	})).Return(nil).Once()

	err := recorder.RecordToolUsage(ctx, RecordToolUsageParams{
		TaskID:         "task-1",
		ConversationID: &convID,
		UserID:         &userID,
		Plan:           &plan,
		Records: []ToolUsageRecord{
			{
				ToolName:   "code_execution",
				Success:    true,
				Duration:   1500,
				Error:      nil,
				AgentID:    &agentID,
				AgentLabel: &agentLabel,
				Output:     &output,
			},
		},
	})

	require.NoError(t, err)
	mockRepo.AssertExpectations(t)
}

func TestToolUsageRecorder_RecordToolUsage_WithError(t *testing.T) {
	mockRepo := new(MockUsageRepository)
	logger := slog.Default()
	recorder := NewToolUsageRecorder(mockRepo, logger)
	ctx := context.Background()

	errMsg := "timeout exceeded"

	mockRepo.On("CreateToolUsage", ctx, mock.MatchedBy(func(rows []ToolUsageRow) bool {
		if len(rows) != 1 {
			return false
		}
		row := rows[0]
		return row.ToolName == "web_search" &&
			row.Success == false &&
			*row.Error == errMsg
	})).Return(nil).Once()

	err := recorder.RecordToolUsage(ctx, RecordToolUsageParams{
		TaskID: "task-1",
		Records: []ToolUsageRecord{
			{
				ToolName: "web_search",
				Success:  false,
				Duration: 5000,
				Error:    &errMsg,
			},
		},
	})

	require.NoError(t, err)
	mockRepo.AssertExpectations(t)
}

func TestToolUsageRecorder_RecordToolUsage_RepositoryError(t *testing.T) {
	mockRepo := new(MockUsageRepository)
	logger := slog.Default()
	recorder := NewToolUsageRecorder(mockRepo, logger)
	ctx := context.Background()

	mockRepo.On("CreateToolUsage", ctx, mock.Anything).Return(assert.AnError).Once()

	err := recorder.RecordToolUsage(ctx, RecordToolUsageParams{
		TaskID: "task-1",
		Records: []ToolUsageRecord{
			{ToolName: "code_execution", Success: true, Duration: 100},
		},
	})

	require.Error(t, err)
	mockRepo.AssertExpectations(t)
}

func TestToolUsageRecorder_RecordToolUsage_NilLoggerRepositoryError(t *testing.T) {
	mockRepo := new(MockUsageRepository)
	recorder := NewToolUsageRecorder(mockRepo, nil)
	ctx := context.Background()

	mockRepo.On("CreateToolUsage", ctx, mock.Anything).Return(assert.AnError).Once()

	err := recorder.RecordToolUsage(ctx, RecordToolUsageParams{
		TaskID: "task-1",
		Records: []ToolUsageRecord{
			{ToolName: "code_execution", Success: true, Duration: 100},
		},
	})

	require.Error(t, err)
	mockRepo.AssertExpectations(t)
}

func TestToolUsageRecorder_RecordToolUsage_MultipleRecords(t *testing.T) {
	mockRepo := new(MockUsageRepository)
	logger := slog.Default()
	recorder := NewToolUsageRecorder(mockRepo, logger)
	ctx := context.Background()

	mockRepo.On("CreateToolUsage", ctx, mock.MatchedBy(func(rows []ToolUsageRow) bool {
		return len(rows) == 3
	})).Return(nil).Once()

	err := recorder.RecordToolUsage(ctx, RecordToolUsageParams{
		TaskID: "task-1",
		Records: []ToolUsageRecord{
			{ToolName: "code_execution", Success: true, Duration: 100},
			{ToolName: "web_search", Success: true, Duration: 200},
			{ToolName: "file_read", Success: false, Duration: 50},
		},
	})

	require.NoError(t, err)
	mockRepo.AssertExpectations(t)
}
