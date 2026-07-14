// Package conversations provides conversation management.
package conversations

import (
	"context"
	"errors"
	"log/slog"
	"time"
)

const (
	maxTitleLength           = 200
	maxResultLength          = 2000
	maxModelLength           = 120
	maxApiMetadataTextLength = 1000
	maxApiMetadataItems      = 50
)

var ErrConversationNotFound = errors.New("conversation not found")

// SourceReference represents a source reference (imported from shared types)
type SourceReference struct {
	Title   string  `json:"title,omitempty"`
	URL     string  `json:"url,omitempty"`
	Snippet *string `json:"snippet,omitempty"`
}

// AgentStatusRecord represents the status of an agent in a conversation
type AgentStatusRecord struct {
	Status    string   `json:"status"`
	AgentID   *int     `json:"agent_id,omitempty"`
	Progress  *float64 `json:"progress,omitempty"`
	Result    *string  `json:"result,omitempty"`
	Reasoning *string  `json:"reasoning,omitempty"`
	Model     string   `json:"model,omitempty"`
}

// ToolUsageEventRecord represents a persisted tool event for a conversation.
type ToolUsageEventRecord struct {
	Timestamp     string                 `json:"timestamp,omitempty"`
	AgentID       *int                   `json:"agentId,omitempty"`
	AgentLabel    string                 `json:"agentLabel"`
	ToolName      string                 `json:"toolName"`
	Arguments     any                    `json:"arguments,omitempty"`
	Success       bool                   `json:"success"`
	DurationMs    int64                  `json:"durationMs"`
	ResultPreview string                 `json:"resultPreview,omitempty"`
	Error         string                 `json:"error,omitempty"`
	Sources       []SourceReference      `json:"sources,omitempty"`
	GeneratedFile *GeneratedFileArtifact `json:"generatedFile,omitempty"`
}

type GeneratedFileArtifact struct {
	Filename    string `json:"filename"`
	Filepath    string `json:"filepath,omitempty"`
	MimeType    string `json:"mimeType,omitempty"`
	Bytes       int64  `json:"bytes,omitempty"`
	FileID      string `json:"fileId,omitempty"`
	ArtifactID  string `json:"artifactId,omitempty"`
	DownloadURL string `json:"downloadUrl,omitempty"`
}

// ConversationRecord represents a stored conversation
type ConversationRecord struct {
	ID               int
	Timestamp        time.Time
	UserID           *string
	OrganizationID   *int
	ProjectID        *int
	UserInput        string
	Result           *string
	ExecutionTime    *int
	Model            *string
	AgentCount       int
	AssistantSources []SourceReference
	StatusSources    []SourceReference
	AgentStatuses    []AgentStatusRecord
	ToolEvents       []ToolUsageEventRecord
}

// ConversationCreateInput is the input for creating a conversation
type ConversationCreateInput struct {
	UserID         string
	OrganizationID *int
	UserInput      string
	Result         *string
	ExecutionTime  *int
	Model          *string
	AgentCount     int
}

// ConversationUpdatePayload is the payload for updating a conversation
type ConversationUpdatePayload struct {
	UserInput     *string
	Result        *string
	ExecutionTime *int
	Model         *string
	AgentCount    *int
}

// ConversationRepository defines storage operations for conversations
type ConversationRepository interface {
	ListConversations(ctx context.Context, userID string, orgID *int, limit, offset int) ([]ConversationRecord, int, error)
	GetConversation(ctx context.Context, userID string, orgID *int, conversationID int) (*ConversationRecord, error)
	CreateConversation(ctx context.Context, input ConversationCreateInput) (*ConversationRecord, error)
	UpdateConversation(ctx context.Context, userID string, orgID *int, conversationID int, update ConversationUpdatePayload) (bool, error)
	DeleteConversation(ctx context.Context, userID string, orgID *int, conversationID int) (bool, error)
}

// ConversationApiView is the API representation of a conversation
type ConversationApiView struct {
	ID            int                    `json:"id"`
	Timestamp     string                 `json:"timestamp"`
	UserInput     string                 `json:"user_input"`
	Result        string                 `json:"result"`
	ExecutionTime int                    `json:"execution_time"`
	Model         string                 `json:"model"`
	AgentCount    int                    `json:"agent_count"`
	ProjectID     *int                   `json:"projectId,omitempty"`
	Sources       []SourceReference      `json:"sources"`
	AgentStatuses []AgentStatusRecord    `json:"agentStatuses"`
	ToolEvents    []ToolUsageEventRecord `json:"toolEvents"`
}

// ConversationsPage represents a paginated list of conversations
type ConversationsPage struct {
	Conversations []ConversationApiView `json:"conversations"`
	Total         int                   `json:"total"`
	Limit         int                   `json:"limit"`
	Offset        int                   `json:"offset"`
	HasMore       bool                  `json:"has_more"`
}

// ConversationUpdateInput is the input for updating a conversation
type ConversationUpdateInput struct {
	Title         *string
	Result        *string
	ExecutionTime *int
	Model         *string
	AgentCount    *int
}

// Service defines operations for conversations
type Service interface {
	ListConversations(ctx context.Context, userID string, orgID *int, limit, offset int) (*ConversationsPage, error)
	GetConversation(ctx context.Context, userID string, orgID *int, conversationID int) (*ConversationApiView, error)
	CreateConversation(ctx context.Context, input ConversationCreateInput) (*ConversationApiView, error)
	UpdateConversation(ctx context.Context, userID string, orgID *int, conversationID int, input ConversationUpdateInput) (bool, error)
	DeleteConversation(ctx context.Context, userID string, orgID *int, conversationID int) (bool, error)
}

// ConversationService handles conversation operations
type ConversationService struct {
	repo ConversationRepository
}

// NewConversationService creates a new conversation service
func NewConversationService(repo ConversationRepository) *ConversationService {
	return &ConversationService{repo: repo}
}

func truncateString(s string, maxLength int) string {
	if len(s) > maxLength {
		return s[:maxLength]
	}
	return s
}

func sanitizeTitle(s string) string  { return truncateString(s, maxTitleLength) }
func sanitizeResult(s string) string { return truncateString(s, maxResultLength) }
func sanitizeModel(s string) string  { return truncateString(s, maxModelLength) }

func toApiView(record *ConversationRecord) ConversationApiView {
	sources := record.AssistantSources
	if len(sources) == 0 {
		sources = record.StatusSources
	}
	if sources == nil {
		sources = []SourceReference{}
	}

	result := ""
	if record.Result != nil {
		result = *record.Result
	}
	execTime := 0
	if record.ExecutionTime != nil {
		execTime = *record.ExecutionTime
	}
	model := ""
	if record.Model != nil {
		model = *record.Model
	}

	statuses := compactAgentStatusesForAPI(record.AgentStatuses)
	toolEvents := compactToolEventsForAPI(record.ToolEvents)

	return ConversationApiView{
		ID:            record.ID,
		Timestamp:     record.Timestamp.Format(time.RFC3339),
		UserInput:     record.UserInput,
		Result:        result,
		ExecutionTime: execTime,
		Model:         model,
		AgentCount:    record.AgentCount,
		ProjectID:     record.ProjectID,
		Sources:       sources,
		AgentStatuses: statuses,
		ToolEvents:    toolEvents,
	}
}

func compactAgentStatusesForAPI(statuses []AgentStatusRecord) []AgentStatusRecord {
	if len(statuses) > maxApiMetadataItems {
		statuses = statuses[len(statuses)-maxApiMetadataItems:]
	}
	out := make([]AgentStatusRecord, len(statuses))
	for i, status := range statuses {
		out[i] = status
		if out[i].Result != nil {
			result := truncateMetadataText(*out[i].Result)
			out[i].Result = &result
		}
		if out[i].Reasoning != nil {
			reasoning := truncateMetadataText(*out[i].Reasoning)
			out[i].Reasoning = &reasoning
		}
	}
	return out
}

func compactToolEventsForAPI(events []ToolUsageEventRecord) []ToolUsageEventRecord {
	if len(events) > maxApiMetadataItems {
		events = events[len(events)-maxApiMetadataItems:]
	}
	out := make([]ToolUsageEventRecord, len(events))
	for i, event := range events {
		out[i] = event
		out[i].Arguments = nil
		out[i].ResultPreview = truncateMetadataText(out[i].ResultPreview)
		out[i].Error = truncateMetadataText(out[i].Error)
	}
	return out
}

func truncateMetadataText(value string) string {
	if len(value) <= maxApiMetadataTextLength {
		return value
	}
	return value[:maxApiMetadataTextLength] + "...[truncated]"
}

// ListConversations returns a paginated list of conversations
func (s *ConversationService) ListConversations(ctx context.Context, userID string, orgID *int, limit, offset int) (*ConversationsPage, error) {
	ctx, span := startSpan(ctx, "conversations.ListConversations", StringAttribute("user_id", userID))
	var spanErr error
	defer func() { span.Finish(spanErr) }()

	records, total, err := s.repo.ListConversations(ctx, userID, orgID, limit, offset)
	if err != nil {
		spanErr = err
		slog.Error("Failed to list conversations", "userID", userID, "error", err)
		return nil, err
	}

	views := make([]ConversationApiView, len(records))
	for i := range records {
		views[i] = toApiView(&records[i])
	}

	return &ConversationsPage{
		Conversations: views,
		Total:         total,
		Limit:         limit,
		Offset:        offset,
		HasMore:       offset+len(views) < total,
	}, nil
}

// GetConversation returns a single conversation
func (s *ConversationService) GetConversation(ctx context.Context, userID string, orgID *int, conversationID int) (*ConversationApiView, error) {
	ctx, span := startSpan(ctx, "conversations.GetConversation", StringAttribute("user_id", userID), IntAttribute("conversation_id", conversationID))
	var spanErr error
	defer func() { span.Finish(spanErr) }()

	record, err := s.repo.GetConversation(ctx, userID, orgID, conversationID)
	if err != nil {
		spanErr = err
		slog.Error("Failed to get conversation", "userID", userID, "conversationID", conversationID, "error", err)
		return nil, err
	}
	if record == nil {
		return nil, ErrConversationNotFound
	}
	view := toApiView(record)
	return &view, nil
}

// CreateConversation creates a new conversation
func (s *ConversationService) CreateConversation(ctx context.Context, input ConversationCreateInput) (*ConversationApiView, error) {
	ctx, span := startSpan(ctx, "conversations.CreateConversation", StringAttribute("user_id", input.UserID))
	var spanErr error
	defer func() { span.Finish(spanErr) }()

	// Normalize input
	input.UserInput = sanitizeTitle(input.UserInput)
	if input.Result != nil {
		r := sanitizeResult(*input.Result)
		input.Result = &r
	}
	if input.Model != nil {
		m := sanitizeModel(*input.Model)
		input.Model = &m
	}
	if input.AgentCount <= 0 {
		input.AgentCount = 4
	}

	record, err := s.repo.CreateConversation(ctx, input)
	if err != nil {
		spanErr = err
		slog.Error("Failed to create conversation", "userID", input.UserID, "error", err)
		return nil, err
	}

	RecordConversationCreated(ctx, input.UserID)
	view := toApiView(record)
	return &view, nil
}

// UpdateConversation updates an existing conversation
func (s *ConversationService) UpdateConversation(ctx context.Context, userID string, orgID *int, conversationID int, input ConversationUpdateInput) (bool, error) {
	payload := ConversationUpdatePayload{}
	hasFields := false

	if input.Title != nil && *input.Title != "" {
		v := sanitizeTitle(*input.Title)
		payload.UserInput = &v
		hasFields = true
	}
	if input.Result != nil {
		v := sanitizeResult(*input.Result)
		payload.Result = &v
		hasFields = true
	}
	if input.ExecutionTime != nil {
		payload.ExecutionTime = input.ExecutionTime
		hasFields = true
	}
	if input.Model != nil && *input.Model != "" {
		v := sanitizeModel(*input.Model)
		payload.Model = &v
		hasFields = true
	}
	if input.AgentCount != nil && *input.AgentCount > 0 {
		payload.AgentCount = input.AgentCount
		hasFields = true
	}

	if !hasFields {
		return false, nil
	}

	ok, err := s.repo.UpdateConversation(ctx, userID, orgID, conversationID, payload)
	if err != nil {
		slog.Error("Failed to update conversation", "userID", userID, "conversationID", conversationID, "error", err)
	}
	return ok, err
}

// DeleteConversation deletes a conversation
func (s *ConversationService) DeleteConversation(ctx context.Context, userID string, orgID *int, conversationID int) (bool, error) {
	ok, err := s.repo.DeleteConversation(ctx, userID, orgID, conversationID)
	if err != nil {
		slog.Error("Failed to delete conversation", "userID", userID, "conversationID", conversationID, "error", err)
	}
	return ok, err
}
