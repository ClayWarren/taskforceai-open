package memories

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"

	"github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/core/pkg/platform"
)

type Service interface {
	GetUserMemories(ctx context.Context, userID int32, orgID *int32) ([]MemoryRecord, error)
	GetFinancialMemories(ctx context.Context, userID int32, orgID *int32) ([]MemoryRecord, error)
	SaveMemory(ctx context.Context, userID int32, orgID *int32, content string, memoryType string) error
	SaveFinancialMemory(ctx context.Context, userID int32, orgID *int32, content string) error
	UpdateMemory(ctx context.Context, input UpdateMemoryInput) (MemoryRecord, error)
	DeleteMemory(ctx context.Context, id int32, userID int32, orgID *int32) error
	ExtractAndSaveMemories(ctx context.Context, userID int, orgID *int32, sourceConversationID *int32, userPrompt, assistantResponse string) error
}

type MemoryStore interface {
	GetUserMemories(ctx context.Context, userID int32) ([]MemoryRecord, error)
	GetUserMemoriesWithOrg(ctx context.Context, input GetUserMemoriesWithOrgInput) ([]MemoryRecord, error)
	DeleteMemory(ctx context.Context, input DeleteMemoryInput) error
	DeleteMemoryWithOrg(ctx context.Context, input DeleteMemoryWithOrgInput) error
	CreateMemory(ctx context.Context, input CreateMemoryInput) error
	UpdateMemory(ctx context.Context, input UpdateMemoryStoreInput) (MemoryRecord, error)
	UpdateMemoryWithOrg(ctx context.Context, input UpdateMemoryWithOrgStoreInput) (MemoryRecord, error)
}

type MemoryRecord struct {
	ID             int32           `json:"id"`
	UserID         int32           `json:"userId"`
	OrganizationID *int32          `json:"organizationId,omitempty"`
	Content        string          `json:"content"`
	Type           string          `json:"type"`
	Metadata       json.RawMessage `json:"metadata,omitempty"`
	CreatedAt      string          `json:"createdAt,omitempty"`
	UpdatedAt      string          `json:"updatedAt,omitempty"`
}

type GetUserMemoriesWithOrgInput struct {
	UserID         int32
	OrganizationID *int32
}

type DeleteMemoryInput struct {
	ID     int32
	UserID int32
}

type UpdateMemoryInput struct {
	ID             int32
	UserID         int32
	OrganizationID *int32
	Content        string
	Type           string
}

type UpdateMemoryStoreInput struct {
	ID       int32
	UserID   int32
	Content  string
	Type     string
	Metadata json.RawMessage
}

type UpdateMemoryWithOrgStoreInput struct {
	ID             int32
	UserID         int32
	OrganizationID *int32
	Content        string
	Type           string
	Metadata       json.RawMessage
}

type DeleteMemoryWithOrgInput struct {
	ID             int32
	UserID         int32
	OrganizationID *int32
}

type CreateMemoryInput struct {
	UserID         int32
	OrganizationID *int32
	Content        string
	Type           string
	Metadata       json.RawMessage
}

type MemoryService struct {
	store     MemoryStore
	cfg       config.Config
	extractor MemoryExtractor
}

type MemoryExtractor func(ctx context.Context, cfg config.Config, extractionPrompt string) (string, error)

func NewService(store MemoryStore, cfg config.Config) *MemoryService {
	return &MemoryService{
		store: store,
		cfg:   cfg,
	}
}

func NewServiceWithExtractor(store MemoryStore, cfg config.Config, extractor MemoryExtractor) *MemoryService {
	s := NewService(store, cfg)
	s.extractor = extractor
	return s
}

func (s *MemoryService) GetUserMemories(ctx context.Context, userID int32, orgID *int32) ([]MemoryRecord, error) {
	// Use org-filtered query for enterprise isolation when orgID is provided
	if orgID != nil {
		return s.store.GetUserMemoriesWithOrg(ctx, GetUserMemoriesWithOrgInput{
			UserID:         userID,
			OrganizationID: orgID,
		})
	}
	return s.store.GetUserMemories(ctx, userID)
}

func (s *MemoryService) GetFinancialMemories(ctx context.Context, userID int32, orgID *int32) ([]MemoryRecord, error) {
	memories, err := s.GetUserMemories(ctx, userID, orgID)
	if err != nil {
		return nil, err
	}
	financial := make([]MemoryRecord, 0, len(memories))
	for _, memory := range memories {
		if memory.Type == "finance" {
			financial = append(financial, memory)
		}
	}
	return financial, nil
}

func (s *MemoryService) SaveMemory(ctx context.Context, userID int32, orgID *int32, content string, memoryType string) error {
	return s.saveMemory(ctx, userID, orgID, content, memoryType, "user_edit", "memory")
}

func (s *MemoryService) SaveFinancialMemory(ctx context.Context, userID int32, orgID *int32, content string) error {
	return s.saveMemory(ctx, userID, orgID, content, "finance", "finance", "financial memory")
}

func (s *MemoryService) saveMemory(ctx context.Context, userID int32, orgID *int32, content, memoryType, source, invalidKind string) error {
	sanitized, ok := sanitizeMemoryContent(content, memoryType)
	if !ok {
		return fmt.Errorf("invalid %s", invalidKind)
	}
	existing := s.existingMemoryFingerprints(ctx, userID, orgID)
	if _, ok := existing[memoryFingerprint(sanitized.Content, sanitized.Type)]; ok {
		return nil
	}
	return s.store.CreateMemory(ctx, CreateMemoryInput{
		UserID:         userID,
		OrganizationID: orgID,
		Content:        sanitized.Content,
		Type:           sanitized.Type,
		Metadata:       sourceMetadata(source),
	})
}

func (s *MemoryService) UpdateMemory(ctx context.Context, input UpdateMemoryInput) (MemoryRecord, error) {
	sanitized, ok := sanitizeMemoryContent(input.Content, input.Type)
	if !ok {
		return MemoryRecord{}, fmt.Errorf("invalid memory")
	}

	metadata := sourceMetadata("user_edit")
	if input.OrganizationID != nil {
		return s.store.UpdateMemoryWithOrg(ctx, UpdateMemoryWithOrgStoreInput{
			ID:             input.ID,
			UserID:         input.UserID,
			OrganizationID: input.OrganizationID,
			Content:        sanitized.Content,
			Type:           sanitized.Type,
			Metadata:       metadata,
		})
	}
	return s.store.UpdateMemory(ctx, UpdateMemoryStoreInput{
		ID:       input.ID,
		UserID:   input.UserID,
		Content:  sanitized.Content,
		Type:     sanitized.Type,
		Metadata: metadata,
	})
}

func (s *MemoryService) DeleteMemory(ctx context.Context, id int32, userID int32, orgID *int32) error {
	// Use org-filtered query for enterprise isolation when orgID is provided
	if orgID != nil {
		return s.store.DeleteMemoryWithOrg(ctx, DeleteMemoryWithOrgInput{
			ID:             id,
			UserID:         userID,
			OrganizationID: orgID,
		})
	}
	return s.store.DeleteMemory(ctx, DeleteMemoryInput{
		ID:     id,
		UserID: userID,
	})
}

type ExtractedMemory struct {
	Content string `json:"content"`
	Type    string `json:"type"` // fact, preference
}

const maxMemoryContentLength = 280

func sanitizeFinancialMemoryContent(content string) (string, bool) {
	sanitized := strings.Join(strings.Fields(content), " ")
	if sanitized == "" || len(sanitized) > maxMemoryContentLength {
		return "", false
	}
	lower := strings.ToLower(sanitized)
	sensitivePatterns := []string{
		"account number",
		"routing number",
		"social security",
		"ssn",
		"password",
		"pin ",
		"full card",
		"credit card number",
	}
	for _, pattern := range sensitivePatterns {
		if strings.Contains(lower, pattern) {
			return "", false
		}
	}
	return sanitized, true
}

func sanitizeExtractedMemory(m ExtractedMemory) (ExtractedMemory, bool) {
	memoryType := strings.ToLower(strings.TrimSpace(m.Type))
	if memoryType != "fact" && memoryType != "preference" {
		return ExtractedMemory{}, false
	}

	content := strings.Join(strings.Fields(m.Content), " ")
	if content == "" || len(content) > maxMemoryContentLength {
		return ExtractedMemory{}, false
	}

	lower := strings.ToLower(content)
	suspiciousPatterns := []string{
		"ignore previous",
		"follow these instructions",
		"system instruction",
		"developer message",
		"tool call",
		"search_web",
		"execute_code",
		"[user memory/context]",
		"```",
	}
	for _, pattern := range suspiciousPatterns {
		if strings.Contains(lower, pattern) {
			return ExtractedMemory{}, false
		}
	}

	return ExtractedMemory{Content: content, Type: memoryType}, true
}

func sanitizeMemoryContent(content, memoryType string) (ExtractedMemory, bool) {
	normalizedType := strings.ToLower(strings.TrimSpace(memoryType))
	if normalizedType == "finance" {
		sanitized, ok := sanitizeFinancialMemoryContent(content)
		if !ok {
			return ExtractedMemory{}, false
		}
		return ExtractedMemory{Content: sanitized, Type: normalizedType}, true
	}
	return sanitizeExtractedMemory(ExtractedMemory{Content: content, Type: normalizedType})
}

func memoryFingerprint(content, memoryType string) string {
	normalizedContent := strings.ToLower(strings.Join(strings.Fields(content), " "))
	normalizedType := strings.ToLower(strings.TrimSpace(memoryType))
	return normalizedType + "\x00" + normalizedContent
}

func (s *MemoryService) existingMemoryFingerprints(ctx context.Context, userID int32, orgID *int32) map[string]struct{} {
	existing := make(map[string]struct{})
	memories, err := s.GetUserMemories(ctx, userID, orgID)
	if err != nil {
		platform.GetLogger().Warn("Could not load existing memories for deduplication", "userId", userID, "error", err)
		return existing
	}
	for _, memory := range memories {
		existing[memoryFingerprint(memory.Content, memory.Type)] = struct{}{}
	}
	return existing
}

func sourceMetadata(source string) json.RawMessage {
	data, err := marshalMemoryJSON(map[string]string{"source": source})
	if err != nil {
		return nil
	}
	return data
}

func extractedMemoryMetadata(sourceConversationID *int32) json.RawMessage {
	if sourceConversationID == nil {
		return nil
	}
	metadata := map[string]any{
		"source":                 "task_completion",
		"source_conversation_id": *sourceConversationID,
	}
	data, err := marshalMemoryJSON(metadata)
	if err != nil {
		return nil
	}
	return data
}

var marshalMemoryJSON = json.Marshal

func int32UserID(userID int) (int32, error) {
	if userID < math.MinInt32 || userID > math.MaxInt32 {
		return 0, fmt.Errorf("user_id exceeds int32 range")
	}
	return int32(userID), nil
}

func (s *MemoryService) ExtractAndSaveMemories(ctx context.Context, userID int, orgID *int32, sourceConversationID *int32, userPrompt, assistantResponse string) error {
	userID32, err := int32UserID(userID)
	if err != nil {
		return err
	}

	extractionPrompt := fmt.Sprintf(`Analyze the following interaction and extract any personal facts, preferences, or long-term context about the user that should be remembered for future sessions.
Only extract NEW and SIGNIFICANT information.
Ignore temporary context or meta-talk about the AI.

User: %s
Assistant: %s

Return a JSON array of objects with "content" and "type" (either "fact" or "preference").
If nothing significant is found, return an empty array [].
Example: [{"content": "User prefers dark mode", "type": "preference"}, {"content": "User lives in New York", "type": "fact"}]`, userPrompt, assistantResponse)

	extractor := s.extractor
	if extractor == nil {
		return fmt.Errorf("memory extractor is not configured")
	}
	respContent, err := extractor(ctx, s.cfg, extractionPrompt)
	if err != nil {
		return err
	}

	if strings.TrimSpace(respContent) == "" {
		return nil
	}

	content := respContent
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")
	content = strings.TrimSpace(content)

	if content == "" || content == "[]" {
		return nil
	}

	var extracted []ExtractedMemory
	if err := json.Unmarshal([]byte(content), &extracted); err != nil {
		return fmt.Errorf("failed to parse extracted memories: %w (content: %s)", err, content)
	}

	metadata := extractedMemoryMetadata(sourceConversationID)
	existing := s.existingMemoryFingerprints(ctx, userID32, orgID)
	for _, m := range extracted {
		sanitized, ok := sanitizeExtractedMemory(m)
		if !ok {
			platform.GetLogger().Warn("Skipped unsafe extracted memory", "userId", userID)
			continue
		}
		fingerprint := memoryFingerprint(sanitized.Content, sanitized.Type)
		if _, ok := existing[fingerprint]; ok {
			continue
		}

		err := s.store.CreateMemory(ctx, CreateMemoryInput{
			UserID:         userID32,
			OrganizationID: orgID,
			Content:        sanitized.Content,
			Type:           sanitized.Type,
			Metadata:       metadata,
		})
		if err != nil {
			platform.GetLogger().Error("Failed to save memory", "userId", userID, "error", err)
			continue
		}
		existing[fingerprint] = struct{}{}
	}

	return nil
}
