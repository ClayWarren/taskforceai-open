package sync

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

func parseTimestampStrict(v string) (time.Time, error) {
	t, err := time.Parse(time.RFC3339, v)
	if err != nil {
		return time.Time{}, err
	}
	return t, nil
}

func parseOptionalTimestamp(fieldName, raw string) (int64, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return 0, nil
	}

	parsed, err := parseTimestampStrict(trimmed)
	if err != nil {
		return 0, fmt.Errorf("invalid %s: %w", fieldName, err)
	}
	return parsed.UnixMilli(), nil
}

func toMessageRole(role string) MessageRole {
	r := MessageRole(role)
	if r == RoleUser || r == RoleAssistant || r == RoleSystem {
		return r
	}
	return RoleAssistant
}

// ApplyPullResponse applies a pull response from the server to local storage.
func ApplyPullResponse(s SyncStorage, r SyncPullResponse) error {
	if err := applyPulledConversations(s, r.Conversations); err != nil {
		return err
	}
	if err := applyPulledMessages(s, r.Messages); err != nil {
		return err
	}
	if err := applyPulledDeletions(s, r.Deletions); err != nil {
		return err
	}
	return s.SetLastSyncVersion(r.LatestVersion)
}

func applyPulledConversations(s SyncStorage, conversations []ConversationSyncPayload) error {
	for _, c := range conversations {
		if c.IsDeleted {
			idStr := resolveConversationID(c)
			if idStr != "" {
				if err := s.DeleteConversation(idStr); err != nil {
					return err
				}
			}
			continue
		}

		if c.ID == nil {
			return fmt.Errorf("conversation id is required for non-deleted conversation")
		}

		createdAt, err := parseOptionalTimestamp("conversation timestamp", c.Timestamp)
		if err != nil {
			return err
		}
		updatedAt, err := parseOptionalTimestamp("conversation updatedAt", c.UpdatedAt)
		if err != nil {
			return err
		}
		lastSyncedAt, err := parseOptionalTimestamp("conversation lastSyncedAt", c.LastSyncedAt)
		if err != nil {
			return err
		}

		sc := StorageConversation{
			ConversationID: fmt.Sprintf("remote-%v", *c.ID),
			Title:          c.UserInput,
			CreatedAt:      createdAt,
			UpdatedAt:      updatedAt,
			SyncVersion:    c.SyncVersion,
			LastSyncedAt:   lastSyncedAt,
			IsDeleted:      c.IsDeleted,
			DeviceID:       c.DeviceID,
		}
		titleRunes := []rune(sc.Title)
		if len(titleRunes) > 120 {
			sc.Title = string(titleRunes[:120])
		}
		if sc.Title == "" {
			sc.Title = "Remote Conversation"
		}
		if c.Result != "" {
			previewRunes := []rune(c.Result)
			if len(previewRunes) > 240 {
				previewRunes = previewRunes[:240]
			}
			previewStr := string(previewRunes)
			sc.LastMessagePreview = &previewStr
		}

		if err := s.UpsertConversation(sc); err != nil {
			return err
		}
	}
	return nil
}

func applyPulledMessages(s SyncStorage, messages []MessageSyncPayload) error {
	for _, m := range messages {
		if m.IsDeleted {
			if err := s.DeleteMessage(m.MessageID); err != nil {
				return err
			}
			continue
		}

		if m.ConversationID == 0 {
			return fmt.Errorf("conversation id is required for message")
		}

		createdAt, err := parseOptionalTimestamp("message createdAt", m.CreatedAt)
		if err != nil {
			return err
		}
		updatedAt, err := parseOptionalTimestamp("message updatedAt", m.UpdatedAt)
		if err != nil {
			return err
		}
		lastSyncedAt, err := parseOptionalTimestamp("message lastSyncedAt", m.LastSyncedAt)
		if err != nil {
			return err
		}

		sm := StorageMessage{
			MessageID:      m.MessageID,
			ConversationID: fmt.Sprintf("remote-%v", m.ConversationID),
			Content:        m.Content,
			Role:           toMessageRole(m.Role),
			IsStreaming:    m.IsStreaming,
			IsAgentStatus:  m.IsAgentStatus,
			CreatedAt:      createdAt,
			UpdatedAt:      updatedAt,
			SyncVersion:    m.SyncVersion,
			LastSyncedAt:   lastSyncedAt,
			IsDeleted:      m.IsDeleted,
			DeviceID:       m.DeviceID,
		}
		if m.Error != "" {
			errStr := m.Error
			sm.Error = &errStr
		}

		val := m.ElapsedSeconds
		sm.ElapsedSeconds = &val

		if err := s.UpsertMessage(sm); err != nil {
			return err
		}
	}
	return nil
}

func applyPulledDeletions(s SyncStorage, deletions []DeletionRecord) error {
	for _, d := range deletions {
		switch d.Type {
		case "conversation":
			if err := s.DeleteConversation(d.ID); err != nil {
				return err
			}
		case "message":
			if err := s.DeleteMessage(d.ID); err != nil {
				return err
			}
		}
	}
	return nil
}

// BuildPushPayload constructs a push request payload from pending local changes.
func BuildPushPayload(p []PendingChange, deviceID string) SyncPushRequest {
	req := SyncPushRequest{
		DeviceID: deviceID,
	}

	for _, ch := range p {
		if ch.Type == "deletion" || ch.Operation == "delete" {
			req.Deletions = append(req.Deletions, DeletionRecord{
				Type:      deletionTypeForChange(ch),
				ID:        ch.EntityID,
				DeletedAt: time.UnixMilli(ch.CreatedAt).UTC().Format(time.RFC3339),
			})
			continue
		}

		if ch.Type == "conversation" {
			now := time.Now().UTC().Format(time.RFC3339)
			prompt := extractPrompt(ch.Data)
			req.Conversations = append(req.Conversations, ConversationSyncPayload{
				LocalID:      ch.EntityID,
				Timestamp:    time.UnixMilli(ch.CreatedAt).UTC().Format(time.RFC3339),
				UserInput:    prompt,
				SyncVersion:  0,
				LastSyncedAt: now,
				DeviceID:     deviceID,
				IsDeleted:    false,
				UpdatedAt:    now,
			})
			continue
		}

		if ch.Type == "message" {
			payload, ok := toMessagePayload(ch, deviceID)
			if ok {
				req.Messages = append(req.Messages, payload)
			}
		}
	}

	return req
}

func resolveConversationID(c ConversationSyncPayload) string {
	if c.ID != nil {
		return fmt.Sprintf("remote-%v", *c.ID)
	}
	return c.LocalID
}

func extractPrompt(data any) string {
	if m, ok := data.(map[string]any); ok {
		if p, ok := m["prompt"].(string); ok {
			return p
		}
		return ""
	}

	b, err := json.Marshal(data)
	if err != nil {
		return ""
	}

	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return ""
	}

	if p, ok := m["prompt"].(string); ok {
		return p
	}
	return ""
}

func toMessagePayload(ch PendingChange, deviceID string) (MessageSyncPayload, bool) {
	data, ok := ch.Data.(map[string]any)
	if !ok {
		return MessageSyncPayload{}, false
	}

	messageID := ch.EntityID
	if v, ok := data["messageId"].(string); ok && strings.TrimSpace(v) != "" {
		messageID = strings.TrimSpace(v)
	}
	if messageID == "" {
		return MessageSyncPayload{}, false
	}

	content, _ := data["content"].(string)
	if strings.TrimSpace(content) == "" && !boolValue(data["isDeleted"]) {
		return MessageSyncPayload{}, false
	}

	role := "assistant"
	if v, ok := data["role"].(string); ok && strings.TrimSpace(v) != "" {
		role = strings.TrimSpace(v)
	}

	conversationID, ok := toSyncID(data["conversationId"])
	if !ok || conversationID <= 0 {
		return MessageSyncPayload{}, false
	}

	nowMillis := time.Now().UTC().UnixMilli()
	payload := MessageSyncPayload{
		MessageID:      messageID,
		ConversationID: conversationID,
		Role:           role,
		Content:        content,
		IsStreaming:    boolValue(data["isStreaming"]),
		IsAgentStatus:  boolValue(data["isAgentStatus"]),
		CreatedAt:      toISOTimestamp(data["createdAt"], ch.CreatedAt),
		SyncVersion:    intValue(data["syncVersion"], 0),
		LastSyncedAt:   toISOTimestamp(data["lastSyncedAt"], nowMillis),
		DeviceID:       deviceID,
		IsDeleted:      boolValue(data["isDeleted"]),
		UpdatedAt:      toISOTimestamp(data["updatedAt"], nowMillis),
	}
	applyOptionalMessagePayloadFields(&payload, data)

	return payload, true
}

func applyOptionalMessagePayloadFields(payload *MessageSyncPayload, data map[string]any) {
	if v, ok := data["conversationLocalId"].(string); ok && strings.TrimSpace(v) != "" {
		payload.ConversationLocalID = strings.TrimSpace(v)
	}
	if v, ok := data["elapsedSeconds"].(float64); ok && !math.IsNaN(v) && !math.IsInf(v, 0) {
		payload.ElapsedSeconds = v
	}
	if v, ok := data["error"].(string); ok && strings.TrimSpace(v) != "" {
		payload.Error = strings.TrimSpace(v)
	}
	if v, exists := data["sources"]; exists {
		payload.Sources = v
	}
	if v, exists := data["toolEvents"]; exists {
		payload.ToolEvents = v
	}
	if v, exists := data["agentStatuses"]; exists {
		payload.AgentStatuses = v
	}
}

func boolValue(v any) bool {
	b, ok := v.(bool)
	return ok && b
}

func intValue(v any, fallback int) int {
	if n, ok := numericInt64(v); ok {
		return int(n)
	}
	return fallback
}

func toISOTimestamp(v any, fallbackMillis int64) string {
	if millis, ok := numericInt64(v); ok {
		return time.UnixMilli(millis).UTC().Format(time.RFC3339)
	}
	if value, ok := v.(string); ok {
		parsed, err := parseTimestampStrict(strings.TrimSpace(value))
		if err == nil {
			return parsed.UTC().Format(time.RFC3339)
		}
	}

	return time.UnixMilli(fallbackMillis).UTC().Format(time.RFC3339)
}

func toSyncID(v any) (int, bool) {
	if value, ok := numericInt64(v); ok {
		if value > 0 {
			return int(value), true
		}
		return 0, false
	}
	if value, ok := v.(string); ok {
		return stringSyncID(value)
	}
	return 0, false
}

func numericInt64(v any) (int64, bool) {
	switch value := v.(type) {
	case int:
		return int64(value), true
	case int8:
		return int64(value), true
	case int16:
		return int64(value), true
	case int32:
		return int64(value), true
	case int64:
		return value, true
	case float32:
		return finiteInt64(float64(value))
	case float64:
		return finiteInt64(value)
	}
	return 0, false
}

func finiteInt64(value float64) (int64, bool) {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, false
	}
	return int64(value), true
}

func stringSyncID(value string) (int, bool) {
	candidate := strings.TrimPrefix(strings.TrimSpace(value), "remote-")
	parsed, err := strconv.Atoi(candidate)
	if err != nil || parsed <= 0 {
		return 0, false
	}
	return parsed, true
}

func deletionTypeForChange(ch PendingChange) string {
	switch ch.Type {
	case "message":
		return "message"
	case "conversation":
		return "conversation"
	}

	if data, ok := ch.Data.(map[string]any); ok {
		if rawType, ok := data["type"].(string); ok {
			switch rawType {
			case "message":
				return "message"
			case "conversation":
				return "conversation"
			}
		}
	}

	return "conversation"
}

// MapConflicts converts a push response's conflicts into ConflictInfo.
func MapConflicts(r SyncPushResponse) []ConflictInfo {
	res := make([]ConflictInfo, len(r.Conflicts))
	for i, c := range r.Conflicts {
		res[i] = ConflictInfo{
			Type:          c.Type,
			ID:            c.ID,
			LocalVersion:  c.ClientVersion,
			ServerVersion: c.ServerVersion,
			Reason:        c.Reason,
		}
	}
	return res
}

// ApplyConversationIDMappings updates local conversation IDs with their permanent remote counterparts.
func ApplyConversationIDMappings(s SyncStorage, m map[string]int) error {
	for localID, serverID := range m {
		res := s.GetConversation(localID)
		if res.Ok {
			updated := res.Value
			updated.ConversationID = fmt.Sprintf("remote-%v", serverID)
			if err := s.UpsertConversation(updated); err != nil {
				return err
			}

			// Update associated messages
			messages, err := s.GetMessages(localID)
			if err != nil {
				return err
			}
			for _, msg := range messages {
				msg.ConversationID = updated.ConversationID
				if err := s.UpsertMessage(msg); err != nil {
					return err
				}
			}

			if err := s.DeleteConversation(localID); err != nil {
				return err
			}
		}
	}
	return nil
}

// ClearAcceptedPendingChanges removes pending changes that have been successfully pushed.
func ClearAcceptedPendingChanges(s SyncStorage, p []PendingChange, accepted []string) error {
	removedIDs := make(map[int]struct{})

	for _, id := range accepted {
		parts := strings.SplitN(id, ":", 2)
		entityID := id
		acceptedType := ""
		isTypedID := false
		if len(parts) == 2 && parts[0] != "" && parts[1] != "" {
			acceptedType = parts[0]
			entityID = parts[1]
			isTypedID = true
		}

		if !isTypedID && hasAmbiguousPendingTypes(p, entityID) {
			continue
		}

		for _, ch := range p {
			typeMatches := !isTypedID || ch.Type == acceptedType ||
				acceptedType == "deletion" && isDeletionPendingChange(ch)
			if ch.EntityID == entityID && typeMatches && ch.ID != nil {
				if _, alreadyRemoved := removedIDs[*ch.ID]; alreadyRemoved {
					continue
				}
				if err := s.RemovePendingChange(*ch.ID); err != nil {
					return err
				}
				removedIDs[*ch.ID] = struct{}{}
			}
		}
	}
	return nil
}

func isDeletionPendingChange(ch PendingChange) bool {
	return ch.Type == "deletion" || ch.Operation == "delete"
}

func hasAmbiguousPendingTypes(p []PendingChange, entityID string) bool {
	types := make(map[string]struct{})
	for _, ch := range p {
		if ch.ID == nil || ch.EntityID != entityID {
			continue
		}
		types[ch.Type] = struct{}{}
		if len(types) > 1 {
			return true
		}
	}
	return false
}
