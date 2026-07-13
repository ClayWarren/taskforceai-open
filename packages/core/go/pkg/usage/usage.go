// Package usage owns product usage-recording policy.
package usage

import (
	"context"
	"encoding/json"
	"log/slog"
	"math"
	"strings"

	corepayments "github.com/TaskForceAI/core/pkg/payments"
)

type ModelCost = corepayments.ModelCost

var DefaultModelCost = corepayments.DefaultModelCost

var BaseModelCosts = corepayments.BaseModelCosts

func ComputeModelCostUSD(modelID string, promptTokens, completionTokens int, overrideJSON string) float64 {
	return corepayments.ComputeModelCostUSD(modelID, promptTokens, completionTokens, overrideJSON)
}

type TokenUsageRow struct {
	TaskID           string  `json:"taskId"`
	ConversationID   *int    `json:"conversationId"`
	UserID           *string `json:"userId"`
	OrganizationID   *int    `json:"organizationId"`
	Plan             *string `json:"plan"`
	Model            string  `json:"model"`
	Stage            string  `json:"stage"`
	PromptTokens     int     `json:"promptTokens"`
	CompletionTokens int     `json:"completionTokens"`
	TotalTokens      int     `json:"totalTokens"`
	CostMicros       int     `json:"costMicros"`
	Metadata         []byte  `json:"metadata,omitempty"`
}

type ToolUsageMetadata struct {
	AgentID       *string `json:"agentId"`
	AgentLabel    *string `json:"agentLabel"`
	ResultPreview *string `json:"resultPreview"`
}

type ToolUsageRow struct {
	TaskID         string            `json:"taskId"`
	ConversationID *int              `json:"conversationId"`
	UserID         *string           `json:"userId"`
	OrganizationID *int              `json:"organizationId"`
	Plan           *string           `json:"plan"`
	ToolName       string            `json:"toolName"`
	Success        bool              `json:"success"`
	DurationMs     int               `json:"durationMs"`
	Error          *string           `json:"error"`
	Metadata       ToolUsageMetadata `json:"metadata"`
}

type Repository interface {
	CreateTokenUsage(ctx context.Context, rows []TokenUsageRow) error
	CreateToolUsage(ctx context.Context, rows []ToolUsageRow) error
}

type EventRow struct {
	TaskID         *string
	ConversationID *int
	UserID         *string
	OrganizationID *int
	Plan           *string
	Source         string
	Modality       string
	Operation      string
	Model          *string
	Quantity       float64
	Unit           string
	CostMicros     int64
	Metadata       []byte
}

type EventRepository interface {
	CreateUsageEvents(ctx context.Context, rows []EventRow) error
}

// UsageRepository preserves the historical public name while the policy now
// lives in core.
type UsageRepository = Repository

type TokenUsageRecord struct {
	Model            string
	Stage            string
	PromptTokens     int
	CompletionTokens int
	TotalTokens      int
	CachedTokens     int
}

type RecordTokenUsageParams struct {
	TaskID         string
	ConversationID *int
	UserID         *string
	OrganizationID *int
	Plan           *string
	Records        []TokenUsageRecord
	OverrideCosts  string
	Source         string
}

type TokenUsageRecorder struct {
	repo   Repository
	logger *slog.Logger
}

func NewTokenUsageRecorder(repo Repository, logger *slog.Logger) *TokenUsageRecorder {
	if logger == nil {
		logger = slog.Default()
	}
	return &TokenUsageRecorder{repo: repo, logger: logger}
}

func (s *TokenUsageRecorder) RecordTokenUsage(ctx context.Context, params RecordTokenUsageParams) error {
	if len(params.Records) == 0 {
		return nil
	}

	rows := make([]TokenUsageRow, 0, len(params.Records))
	for _, rec := range params.Records {
		if rec.TotalTokens <= 0 {
			continue
		}

		billablePromptTokens := rec.PromptTokens
		if rec.CachedTokens > 0 {
			billablePromptTokens = max(0, rec.PromptTokens-rec.CachedTokens)
		}
		costUSD := corepayments.ComputeModelCostWithCacheUSD(rec.Model, rec.PromptTokens, rec.CompletionTokens, rec.CachedTokens, params.OverrideCosts)

		rows = append(rows, TokenUsageRow{
			TaskID:           params.TaskID,
			ConversationID:   params.ConversationID,
			UserID:           params.UserID,
			OrganizationID:   params.OrganizationID,
			Plan:             params.Plan,
			Model:            rec.Model,
			Stage:            rec.Stage,
			PromptTokens:     rec.PromptTokens,
			CompletionTokens: rec.CompletionTokens,
			TotalTokens:      rec.TotalTokens,
			CostMicros:       int(math.Round(costUSD * 1_000_000)),
			Metadata:         tokenUsageMetadata(rec, billablePromptTokens),
		})
	}

	if len(rows) == 0 {
		return nil
	}

	if err := s.repo.CreateTokenUsage(ctx, rows); err != nil {
		s.logger.Warn("Failed to record token usage", "taskId", params.TaskID, "error", err)
		return err
	}
	if events, ok := s.repo.(EventRepository); ok {
		eventRows := make([]EventRow, 0, len(rows))
		for i := range rows {
			row := &rows[i]
			model := row.Model
			taskID := row.TaskID
			eventRows = append(eventRows, EventRow{
				TaskID: &taskID, ConversationID: row.ConversationID, UserID: row.UserID,
				OrganizationID: row.OrganizationID, Plan: row.Plan, Source: normalizedUsageSource(params.Source),
				Modality: "text", Operation: row.Stage, Model: &model,
				Quantity: float64(row.TotalTokens), Unit: "tokens", CostMicros: int64(row.CostMicros),
				Metadata: row.Metadata,
			})
		}
		if err := events.CreateUsageEvents(ctx, eventRows); err != nil {
			s.logger.Warn("Failed to record text usage events", "taskId", params.TaskID, "error", err)
			return err
		}
	}
	return nil
}

func normalizedUsageSource(source string) string {
	if source = strings.TrimSpace(source); source != "" {
		return source
	}
	return "task"
}

func tokenUsageMetadata(rec TokenUsageRecord, billablePromptTokens int) []byte {
	if rec.CachedTokens <= 0 && billablePromptTokens == rec.PromptTokens {
		return nil
	}
	data, _ := json.Marshal(map[string]int{ //nolint:errchkjson // Integer map values are always JSON-encodable.
		"cachedPromptTokens":   rec.CachedTokens,
		"billablePromptTokens": billablePromptTokens,
	})
	return data
}

type ToolUsageRecord struct {
	ToolName   string
	Success    bool
	Duration   int
	Error      *string
	AgentID    *string
	AgentLabel *string
	Output     *string
}

type RecordToolUsageParams struct {
	TaskID         string
	ConversationID *int
	UserID         *string
	OrganizationID *int
	Plan           *string
	Records        []ToolUsageRecord
}

type ToolUsageRecorder struct {
	repo   Repository
	logger *slog.Logger
}

func NewToolUsageRecorder(repo Repository, logger *slog.Logger) *ToolUsageRecorder {
	if logger == nil {
		logger = slog.Default()
	}
	return &ToolUsageRecorder{repo: repo, logger: logger}
}

func (s *ToolUsageRecorder) RecordToolUsage(ctx context.Context, params RecordToolUsageParams) error {
	if len(params.Records) == 0 {
		return nil
	}

	rows := make([]ToolUsageRow, 0, len(params.Records))
	for _, rec := range params.Records {
		rows = append(rows, ToolUsageRow{
			TaskID:         params.TaskID,
			ConversationID: params.ConversationID,
			UserID:         params.UserID,
			OrganizationID: params.OrganizationID,
			Plan:           params.Plan,
			ToolName:       rec.ToolName,
			Success:        rec.Success,
			DurationMs:     rec.Duration,
			Error:          rec.Error,
			Metadata: ToolUsageMetadata{
				AgentID:       rec.AgentID,
				AgentLabel:    rec.AgentLabel,
				ResultPreview: rec.Output,
			},
		})
	}

	if err := s.repo.CreateToolUsage(ctx, rows); err != nil {
		s.logger.Warn("Failed to record tool usage", "taskId", params.TaskID, "error", err)
		return err
	}
	return nil
}
