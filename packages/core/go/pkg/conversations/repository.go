package conversations

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"time"
)

// Ensure implementation satisfies interface
var _ ConversationRepository = (*PgConversationRepository)(nil)

var ErrConversationRecordNotFound = errors.New("conversation record not found")

type ConversationStore interface {
	CountConversationsByUser(ctx context.Context, userID *string) (int64, error)
	CountConversationsByUserAndOrg(ctx context.Context, input CountConversationsByUserAndOrgInput) (int64, error)
	GetConversationsByUser(ctx context.Context, input GetConversationsByUserInput) ([]ConversationData, error)
	GetConversationsByUserAndOrg(ctx context.Context, input GetConversationsByUserAndOrgInput) ([]ConversationData, error)
	GetMessagesByConversation(ctx context.Context, conversationID int32) ([]MessageData, error)
	GetConversationByUserAndID(ctx context.Context, input GetConversationByUserAndIDInput) (ConversationData, error)
	GetConversationByUserOrgAndID(ctx context.Context, input GetConversationByUserOrgAndIDInput) (ConversationData, error)
	CreateConversation(ctx context.Context, input CreateConversationStoreInput) (ConversationData, error)
	UpdateConversation(ctx context.Context, input UpdateConversationStoreInput) error
	UpdateConversationWithOrg(ctx context.Context, input UpdateConversationWithOrgInput) error
	SoftDeleteConversation(ctx context.Context, input SoftDeleteConversationInput) error
	SoftDeleteConversationWithOrg(ctx context.Context, input SoftDeleteConversationWithOrgInput) error
}

type bulkConversationMetadataStore interface {
	GetLatestAssistantMessagesWithMetadataByConversations(ctx context.Context, conversationIds []int32) ([]MessageData, error)
}

type CountConversationsByUserAndOrgInput struct {
	UserID         *string
	OrganizationID *int32
}

type GetConversationsByUserInput struct {
	UserID *string
	Limit  int32
	Offset int32
}

type GetConversationsByUserAndOrgInput struct {
	UserID         *string
	OrganizationID *int32
	Limit          int32
	Offset         int32
}

type GetConversationByUserAndIDInput struct {
	ID     int32
	UserID *string
}

type GetConversationByUserOrgAndIDInput struct {
	ID             int32
	UserID         *string
	OrganizationID *int32
}

type CreateConversationStoreInput struct {
	UserID         *string
	OrganizationID *int32
	UserInput      string
	Model          *string
	AgentCount     int32
	DeviceID       *string
	ProjectID      *int32
}

type UpdateConversationStoreInput struct {
	UserInput      *string
	OrganizationID *int32
	Result         *string
	ExecutionTime  *float64
	Model          *string
	AgentCount     *int32
	ID             int32
	UserID         *string
}

type UpdateConversationWithOrgInput struct {
	UserInput      *string
	Result         *string
	ExecutionTime  *float64
	Model          *string
	AgentCount     *int32
	ID             int32
	UserID         *string
	OrganizationID *int32
}

type SoftDeleteConversationInput struct {
	ID     int32
	UserID *string
}

type SoftDeleteConversationWithOrgInput struct {
	ID             int32
	UserID         *string
	OrganizationID *int32
}

type ConversationData struct {
	ID             int32
	Timestamp      time.Time
	UserID         *string
	OrganizationID *int32
	UserInput      string
	Result         *string
	ExecutionTime  *float64
	Model          *string
	AgentCount     int32
}

type MessageData struct {
	ID             int32
	ConversationID int32
	Role           string
	Sources        []byte
	ToolEvents     []byte
	AgentStatuses  []byte
	Trace          []byte
}

type PgConversationRepository struct {
	store ConversationStore
}

func NewConversationRepository(store ConversationStore) *PgConversationRepository {
	return &PgConversationRepository{store: store}
}

func (r *PgConversationRepository) ListConversations(ctx context.Context, userID string, orgID *int, limit, offset int) ([]ConversationRecord, int, error) {
	limit = capInt32(limit)
	offset = capInt32(offset)
	limit32, err := checkedInt32(limit, "limit")
	if err != nil {
		return nil, 0, err
	}
	offset32, err := checkedInt32(offset, "offset")
	if err != nil {
		return nil, 0, err
	}

	var total int64
	var convs []ConversationData
	var queryErr error

	// Use org-filtered queries for enterprise isolation when orgID is provided
	if orgID != nil {
		orgID32, convErr := checkedInt32(*orgID, "organization_id")
		if convErr != nil {
			return nil, 0, convErr
		}
		total, queryErr = r.store.CountConversationsByUserAndOrg(ctx, CountConversationsByUserAndOrgInput{
			UserID:         &userID,
			OrganizationID: &orgID32,
		})
		if queryErr != nil {
			return nil, 0, queryErr
		}

		convs, queryErr = r.store.GetConversationsByUserAndOrg(ctx, GetConversationsByUserAndOrgInput{
			UserID:         &userID,
			OrganizationID: &orgID32,
			Limit:          limit32,
			Offset:         offset32,
		})
	} else {
		total, queryErr = r.store.CountConversationsByUser(ctx, &userID)
		if queryErr != nil {
			return nil, 0, queryErr
		}

		convs, queryErr = r.store.GetConversationsByUser(ctx, GetConversationsByUserInput{
			UserID: &userID,
			Limit:  limit32,
			Offset: offset32,
		})
	}
	if queryErr != nil {
		return nil, 0, queryErr
	}

	records := make([]ConversationRecord, len(convs))
	if len(convs) > 0 {
		convIDs := make([]int32, len(convs))
		for i, c := range convs {
			convIDs[i] = c.ID
		}

		metadataMap := r.fetchMetadataForConversations(ctx, convIDs)
		for i, c := range convs {
			records[i] = mapDbConversation(&c, metadataMap[c.ID])
		}
	}

	return records, int(total), nil
}

func (r *PgConversationRepository) fetchMetadataForConversations(ctx context.Context, convIDs []int32) map[int32]*MessageData {
	messages := make(map[int32]*MessageData)
	if bulkStore, ok := r.store.(bulkConversationMetadataStore); ok {
		rows, err := bulkStore.GetLatestAssistantMessagesWithMetadataByConversations(ctx, convIDs)
		if err == nil {
			for i := range rows {
				messages[rows[i].ConversationID] = &rows[i]
			}
			return messages
		}
	}

	for _, id := range convIDs {
		msgs, err := r.store.GetMessagesByConversation(ctx, id)
		if err == nil && len(msgs) > 0 {
			// Find the last assistant message
			for i := len(msgs) - 1; i >= 0; i-- {
				if msgs[i].Role == "assistant" && messageHasConversationMetadata(&msgs[i]) {
					messages[id] = &msgs[i]
					break
				}
			}
		}
	}
	return messages
}

func (r *PgConversationRepository) GetConversation(ctx context.Context, userID string, orgID *int, conversationID int) (*ConversationRecord, error) {
	conversationID32, err := checkedInt32(conversationID, "conversation_id")
	if err != nil {
		return nil, err
	}

	var conv ConversationData
	var queryErr error

	// Use org-filtered query for enterprise isolation when orgID is provided
	if orgID != nil {
		orgID32, convErr := checkedInt32(*orgID, "organization_id")
		if convErr != nil {
			return nil, convErr
		}
		conv, queryErr = r.store.GetConversationByUserOrgAndID(ctx, GetConversationByUserOrgAndIDInput{
			ID:             conversationID32,
			UserID:         &userID,
			OrganizationID: &orgID32,
		})
	} else {
		conv, queryErr = r.store.GetConversationByUserAndID(ctx, GetConversationByUserAndIDInput{
			ID:     conversationID32,
			UserID: &userID,
		})
	}
	if queryErr != nil {
		if errors.Is(queryErr, ErrConversationRecordNotFound) {
			return nil, ErrConversationNotFound
		}
		return nil, queryErr
	}

	msgs, _ := r.store.GetMessagesByConversation(ctx, conv.ID)
	if msgs == nil {
		msgs = []MessageData{}
	}
	var latestAssistant *MessageData
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Role == "assistant" && messageHasConversationMetadata(&msgs[i]) {
			latestAssistant = &msgs[i]
			break
		}
	}

	record := mapDbConversation(&conv, latestAssistant)
	return &record, nil
}

func (r *PgConversationRepository) CreateConversation(ctx context.Context, input ConversationCreateInput) (*ConversationRecord, error) {
	input.AgentCount = capInt32(input.AgentCount)
	agentCount32, err := checkedInt32(input.AgentCount, "agent_count")
	if err != nil {
		return nil, err
	}

	var orgIDPtr *int32
	if input.OrganizationID != nil {
		orgID32, convErr := checkedInt32(*input.OrganizationID, "organization_id")
		if convErr != nil {
			return nil, convErr
		}
		orgIDPtr = &orgID32
	}

	conv, err := r.store.CreateConversation(ctx, CreateConversationStoreInput{
		UserID:         &input.UserID,
		OrganizationID: orgIDPtr,
		UserInput:      input.UserInput,
		Model:          input.Model,
		AgentCount:     agentCount32,
		DeviceID:       nil,
	})
	if err != nil {
		return nil, err
	}

	record := mapDbConversation(&conv, nil)
	return &record, nil
}

func (r *PgConversationRepository) UpdateConversation(ctx context.Context, userID string, orgID *int, conversationID int, update ConversationUpdatePayload) (bool, error) {
	conversationID32, err := checkedInt32(conversationID, "conversation_id")
	if err != nil {
		return false, err
	}
	var orgID32 *int32
	if orgID != nil {
		convertedOrgID, convErr := checkedInt32(*orgID, "organization_id")
		if convErr != nil {
			return false, convErr
		}
		orgID32 = &convertedOrgID
	}

	// Security check: Verify owner and org
	existing, err := r.GetConversation(ctx, userID, orgID, conversationID)
	if errors.Is(err, ErrConversationNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	// Build update params from existing values so omitted fields remain unchanged.
	userInput := existing.UserInput
	if update.UserInput != nil {
		userInput = *update.UserInput
	}
	userInputPtr := &userInput

	agentCount := int32(existing.AgentCount) // #nosec G115 -- existing counts originate from int32 database rows.
	if update.AgentCount != nil {
		count := *update.AgentCount
		count = capInt32(count)
		converted, convertErr := checkedInt32(count, "agent_count")
		if convertErr != nil {
			return false, convertErr
		}
		agentCount = converted
	}
	agentCountPtr := &agentCount

	var execTime *float64
	if update.ExecutionTime != nil {
		et := float64(*update.ExecutionTime)
		execTime = &et
	}

	// Use org-filtered query for enterprise isolation when orgID is provided
	if orgID != nil {
		err = r.store.UpdateConversationWithOrg(ctx, UpdateConversationWithOrgInput{
			ID:             conversationID32,
			UserInput:      userInputPtr,
			Result:         update.Result,
			ExecutionTime:  execTime,
			Model:          update.Model,
			AgentCount:     agentCountPtr,
			UserID:         &userID,
			OrganizationID: orgID32,
		})
	} else {
		err = r.store.UpdateConversation(ctx, UpdateConversationStoreInput{
			ID:            conversationID32,
			UserInput:     userInputPtr,
			Result:        update.Result,
			ExecutionTime: execTime,
			Model:         update.Model,
			AgentCount:    agentCountPtr,
			UserID:        &userID,
		})
	}
	if err != nil {
		return false, err
	}

	return true, nil
}

func (r *PgConversationRepository) DeleteConversation(ctx context.Context, userID string, orgID *int, conversationID int) (bool, error) {
	conversationID32, err := checkedInt32(conversationID, "conversation_id")
	if err != nil {
		return false, err
	}
	var orgID32 *int32
	if orgID != nil {
		convertedOrgID, convErr := checkedInt32(*orgID, "organization_id")
		if convErr != nil {
			return false, convErr
		}
		orgID32 = &convertedOrgID
	}

	// Security check
	_, err = r.GetConversation(ctx, userID, orgID, conversationID)
	if errors.Is(err, ErrConversationNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	// Use org-filtered query for enterprise isolation when orgID is provided
	if orgID != nil {
		err = r.store.SoftDeleteConversationWithOrg(ctx, SoftDeleteConversationWithOrgInput{
			ID:             conversationID32,
			UserID:         &userID,
			OrganizationID: orgID32,
		})
	} else {
		err = r.store.SoftDeleteConversation(ctx, SoftDeleteConversationInput{
			ID:     conversationID32,
			UserID: &userID,
		})
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func mapDbConversation(c *ConversationData, m *MessageData) ConversationRecord {
	ts := c.Timestamp

	var execTime *int
	if c.ExecutionTime != nil {
		et := int(*c.ExecutionTime)
		execTime = &et
	}

	var orgID *int
	if c.OrganizationID != nil {
		val := int(*c.OrganizationID)
		orgID = &val
	}

	assistantSources := []SourceReference{}
	statusSources := []SourceReference{}
	agentStatuses := []AgentStatusRecord{}
	toolEvents := []ToolUsageEventRecord{}

	if m != nil {
		decodeJSONField("message.sources", m.ID, m.Sources, &assistantSources)
		decodeJSONField("message.agent_statuses", m.ID, m.AgentStatuses, &agentStatuses)
		decodeJSONField("message.tool_events", m.ID, m.ToolEvents, &toolEvents)
	}

	if m != nil && len(assistantSources) == 0 && len(agentStatuses) == 0 && m.Trace != nil {
		var trace struct {
			Steps []struct {
				Action struct {
					Metadata map[string]any `json:"metadata"`
				} `json:"action"`
			} `json:"steps"`
			AgentStatuses []AgentStatusRecord `json:"agent_statuses"`
		}
		if err := json.Unmarshal(m.Trace, &trace); err == nil {
			agentStatuses = trace.AgentStatuses
			// Extract sources from steps (simplified)
			for _, step := range trace.Steps {
				if src, ok := step.Action.Metadata["source"].(string); ok {
					assistantSources = append(assistantSources, SourceReference{Title: src})
				}
			}
		} else {
			slog.Warn(
				"Failed to decode conversation trace metadata",
				"messageID", m.ID,
				"error", err,
			)
		}
	}

	return ConversationRecord{
		ID:               int(c.ID),
		Timestamp:        ts,
		UserID:           c.UserID,
		OrganizationID:   orgID,
		UserInput:        c.UserInput,
		Result:           c.Result,
		ExecutionTime:    execTime,
		Model:            c.Model,
		AgentCount:       int(c.AgentCount),
		AssistantSources: assistantSources,
		StatusSources:    statusSources,
		AgentStatuses:    agentStatuses,
		ToolEvents:       toolEvents,
	}
}

func messageHasConversationMetadata(m *MessageData) bool {
	return m.Trace != nil || len(m.Sources) > 0 || len(m.AgentStatuses) > 0 || len(m.ToolEvents) > 0
}

func decodeJSONField[T any](field string, messageID int32, data []byte, target *T) {
	if len(data) == 0 {
		return
	}
	if err := json.Unmarshal(data, target); err != nil {
		slog.Warn(
			"Failed to decode conversation metadata field",
			"field", field,
			"messageID", messageID,
			"error", err,
		)
	}
}

func capInt32(value int) int {
	if value > math.MaxInt32 {
		return math.MaxInt32
	}
	return value
}

func checkedInt32(value int, name string) (int32, error) {
	if value < math.MinInt32 || value > math.MaxInt32 {
		return 0, fmt.Errorf("%s exceeds int32 range", name)
	}
	return int32(value), nil
}
