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

type mockUsageRepository struct {
	mock.Mock
}

func (m *mockUsageRepository) CreateTokenUsage(ctx context.Context, rows []TokenUsageRow) error {
	args := m.Called(ctx, rows)
	return args.Error(0)
}

func (m *mockUsageRepository) CreateToolUsage(ctx context.Context, rows []ToolUsageRow) error {
	args := m.Called(ctx, rows)
	return args.Error(0)
}

func TestComputeModelCostUSD(t *testing.T) {
	t.Run("Default cost when model not found", func(t *testing.T) {
		cost := ComputeModelCostUSD("unknown-model", 1000, 1000, "")
		assert.InDelta(t, 0.02, cost, 1e-12)
	})

	t.Run("Base model cost", func(t *testing.T) {
		cost := ComputeModelCostUSD("xai/grok-4.5", 1000, 1000, "")
		assert.InDelta(t, 0.02, cost, 1e-12)
	})

	t.Run("Case insensitive model lookup", func(t *testing.T) {
		cost := ComputeModelCostUSD("ZAI/GLM-5.2", 1000, 1000, "")
		assert.InDelta(t, 0.006, cost, 1e-12)
	})

	t.Run("Global cost overrides", func(t *testing.T) {
		overrides := `{"unknown-model": {"prompt": 1.0, "completion": 2.0}}`
		cost := ComputeModelCostUSD("unknown-model", 1000, 1000, overrides)
		assert.InDelta(t, 0.003, cost, 1e-12)
	})

	t.Run("Global cost overrides with case insensitive lookup", func(t *testing.T) {
		overrides := `{"MY-MODEL": {"prompt": 1.0, "completion": 2.0}}`
		cost := ComputeModelCostUSD("my-model", 1000, 1000, overrides)
		assert.InDelta(t, 0.003, cost, 1e-12)
	})

	t.Run("Partial token usage", func(t *testing.T) {
		cost := ComputeModelCostUSD("xai/grok-4.5", 500, 250, "")
		assert.InDelta(t, 0.00625, cost, 1e-12)
	})

	t.Run("Malformed overrides fallback to defaults", func(t *testing.T) {
		overrides := `invalid json`
		cost := ComputeModelCostUSD("xai/grok-4.5", 1000, 1000, overrides)
		assert.InDelta(t, 0.02, cost, 1e-12)
	})

	t.Run("Zero tokens results in zero cost", func(t *testing.T) {
		cost := ComputeModelCostUSD("any-model", 0, 0, "")
		assert.Equal(t, 0.0, cost)
	})
}

func TestTokenUsageRecorder_RecordTokenUsage_Empty(t *testing.T) {
	mockRepo := new(mockUsageRepository)
	recorder := NewTokenUsageRecorder(mockRepo, slog.Default())

	err := recorder.RecordTokenUsage(context.Background(), RecordTokenUsageParams{
		TaskID:  "task-1",
		Records: []TokenUsageRecord{},
	})

	require.NoError(t, err)
	mockRepo.AssertNotCalled(t, "CreateTokenUsage")
}

func TestTokenUsageRecorder_RecordTokenUsage_ZeroTokens(t *testing.T) {
	mockRepo := new(mockUsageRepository)
	recorder := NewTokenUsageRecorder(mockRepo, slog.Default())

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
	mockRepo := new(mockUsageRepository)
	recorder := NewTokenUsageRecorder(mockRepo, slog.Default())
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
	mockRepo := new(mockUsageRepository)
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
	mockRepo := new(mockUsageRepository)
	recorder := NewTokenUsageRecorder(mockRepo, slog.Default())
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
	mockRepo := new(mockUsageRepository)
	recorder := NewTokenUsageRecorder(mockRepo, slog.Default())
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
	mockRepo := new(mockUsageRepository)
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
	mockRepo := new(mockUsageRepository)
	recorder := NewToolUsageRecorder(mockRepo, slog.Default())

	err := recorder.RecordToolUsage(context.Background(), RecordToolUsageParams{
		TaskID:  "task-1",
		Records: []ToolUsageRecord{},
	})

	require.NoError(t, err)
	mockRepo.AssertNotCalled(t, "CreateToolUsage")
}

func TestToolUsageRecorder_RecordToolUsage_Success(t *testing.T) {
	mockRepo := new(mockUsageRepository)
	recorder := NewToolUsageRecorder(mockRepo, slog.Default())
	ctx := context.Background()

	userID := "user-123"
	plan := "pro"
	convID := 42
	agentID := "agent-1"
	agentLabel := "Researcher"
	output := "Found results"

	mockRepo.On("CreateToolUsage", ctx, mock.MatchedBy(func(rows []ToolUsageRow) bool {
		if len(rows) != 1 {
			return false
		}
		row := rows[0]
		return row.TaskID == "task-1" &&
			row.ToolName == "web_search" &&
			row.Success &&
			row.DurationMs == 1500 &&
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
			{ToolName: "web_search", Success: true, Duration: 1500, AgentID: &agentID, AgentLabel: &agentLabel, Output: &output},
		},
	})

	require.NoError(t, err)
	mockRepo.AssertExpectations(t)
}

func TestToolUsageRecorder_RecordToolUsage_WithError(t *testing.T) {
	mockRepo := new(mockUsageRepository)
	recorder := NewToolUsageRecorder(mockRepo, slog.Default())
	ctx := context.Background()

	errorMsg := "tool failed"
	mockRepo.On("CreateToolUsage", ctx, mock.MatchedBy(func(rows []ToolUsageRow) bool {
		if len(rows) != 1 {
			return false
		}
		row := rows[0]
		return row.ToolName == "api_call" &&
			!row.Success &&
			row.Error != nil &&
			*row.Error == errorMsg
	})).Return(nil).Once()

	err := recorder.RecordToolUsage(ctx, RecordToolUsageParams{
		TaskID: "task-1",
		Records: []ToolUsageRecord{
			{ToolName: "api_call", Success: false, Duration: 500, Error: &errorMsg},
		},
	})

	require.NoError(t, err)
	mockRepo.AssertExpectations(t)
}

func TestToolUsageRecorder_RecordToolUsage_RepositoryError(t *testing.T) {
	mockRepo := new(mockUsageRepository)
	recorder := NewToolUsageRecorder(mockRepo, slog.Default())
	ctx := context.Background()

	mockRepo.On("CreateToolUsage", ctx, mock.Anything).Return(assert.AnError).Once()

	err := recorder.RecordToolUsage(ctx, RecordToolUsageParams{
		TaskID: "task-1",
		Records: []ToolUsageRecord{
			{ToolName: "test_tool", Success: true, Duration: 100},
		},
	})

	require.Error(t, err)
	mockRepo.AssertExpectations(t)
}

func TestToolUsageRecorder_RecordToolUsage_NilLoggerRepositoryError(t *testing.T) {
	mockRepo := new(mockUsageRepository)
	recorder := NewToolUsageRecorder(mockRepo, nil)
	ctx := context.Background()

	mockRepo.On("CreateToolUsage", ctx, mock.Anything).Return(assert.AnError).Once()

	err := recorder.RecordToolUsage(ctx, RecordToolUsageParams{
		TaskID: "task-1",
		Records: []ToolUsageRecord{
			{ToolName: "test_tool", Success: true, Duration: 100},
		},
	})

	require.Error(t, err)
	mockRepo.AssertExpectations(t)
}

func TestToolUsageRecorder_RecordToolUsage_MultipleRecords(t *testing.T) {
	mockRepo := new(mockUsageRepository)
	recorder := NewToolUsageRecorder(mockRepo, slog.Default())
	ctx := context.Background()

	mockRepo.On("CreateToolUsage", ctx, mock.MatchedBy(func(rows []ToolUsageRow) bool {
		return len(rows) == 3
	})).Return(nil).Once()

	err := recorder.RecordToolUsage(ctx, RecordToolUsageParams{
		TaskID: "task-1",
		Records: []ToolUsageRecord{
			{ToolName: "tool1", Success: true, Duration: 100},
			{ToolName: "tool2", Success: false, Duration: 200},
			{ToolName: "tool3", Success: true, Duration: 300},
		},
	})

	require.NoError(t, err)
	mockRepo.AssertExpectations(t)
}
