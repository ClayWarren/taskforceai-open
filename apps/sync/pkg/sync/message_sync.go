package sync

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"reflect"
)

func (s *Service) syncMessages(
	ctx context.Context,
	repo SyncRepository,
	userID string,
	deviceID string,
	activeDevices map[string]struct{},
	currentVersion int32,
	organizationID *int32,
	strategy ResolutionStrategy,
	messages []MessageSyncPayload,
) (int32, []ConflictRecord, []string, error) {
	conflicts := []ConflictRecord{}
	accepted := []string{}
	version := currentVersion

	for _, incoming := range messages {
		existing, err := repo.GetMessageVersionScoped(ctx, incoming.MessageID, userID, organizationID)

		if err != nil {
			if errors.Is(err, ErrNotFound) {
				var err error
				version, err = s.handleNewMessage(ctx, repo, userID, deviceID, version, organizationID, incoming, &accepted)
				if err != nil {
					return version, conflicts, accepted, err
				}
				continue
			}
			slog.Error("Failed to get message version during sync", "error", err, "messageId", incoming.MessageID, "userId", userID)
			return version, conflicts, accepted, fmt.Errorf("get message version: %w", err)
		}

		serverVC, clientVC := DecodeVectorClock(existing.VectorClock), DecodeVectorClock(incoming.VectorClock)
		causality := compareSyncPayload(serverVC, clientVC, existing.SyncVersion, incoming.SyncVersion)
		if causality == After {
			conflicts = s.appendConflict(ctx, conflicts, "message", incoming.MessageID, "server_newer", existing.SyncVersion, incoming.SyncVersion)
			continue
		}

		prepared, outcome, prepareErr := s.prepareMessageUpdate(ctx, repo, incoming, userID, organizationID, causality, strategy)
		if prepareErr != nil {
			return version, conflicts, accepted, prepareErr
		}
		if outcome == "accepted" {
			accepted = append(accepted, fmt.Sprintf("message:%s", incoming.MessageID))
			continue
		}
		if outcome != "" {
			conflicts = s.appendConflict(ctx, conflicts, "message", incoming.MessageID, outcome, existing.SyncVersion, incoming.SyncVersion)
			continue
		}
		incoming = prepared

		// Sequential update
		version, err = nextSyncVersion(ctx, repo, version)
		if err != nil {
			return version, conflicts, accepted, err
		}
		incoming.VectorClock = s.acceptedVectorClock(clientVC, serverVC, deviceID, activeDevices)
		if err := s.updateMessage(ctx, repo, userID, deviceID, version, organizationID, incoming); err != nil {
			slog.Error("Failed to update message during sync", "error", err, "messageId", incoming.MessageID)
			return version, conflicts, accepted, err
		}
		accepted = append(accepted, fmt.Sprintf("message:%s", incoming.MessageID))
	}
	return version, conflicts, accepted, nil
}

func (s *Service) prepareMessageUpdate(ctx context.Context, repo SyncRepository, incoming MessageSyncPayload, userID string, organizationID *int32, causality ComparisonResult, strategy ResolutionStrategy) (MessageSyncPayload, string, error) {
	needsFullMessage := (causality == Concurrent && strategy == StrategyAutoMerge && s.resolver != nil) || len(incoming.Patches) > 0
	var fullMessage *MessageRecord
	if needsFullMessage {
		loaded, err := repo.GetMessageByMessageIDScoped(ctx, incoming.MessageID, userID, organizationID)
		if err != nil {
			slog.Error("Failed to load full message for sync", "error", err, "messageId", incoming.MessageID)
			return incoming, "", fmt.Errorf("get message: %w", err)
		}
		fullMessage = &loaded
	}
	if causality == Concurrent && strategy == StrategyServerWins {
		s.recordResolution(ctx, strategy)
		return incoming, "accepted", nil
	}
	if len(incoming.Patches) > 0 {
		patched, err := s.handleMessagePatchWithMessage(ctx, repo, incoming, userID, organizationID, fullMessage)
		if err != nil {
			slog.Error("Failed to handle message patch", "error", err, "messageId", incoming.MessageID)
			return incoming, "", err
		}
		patched.Patches = nil
		incoming = patched
	}
	if causality != Concurrent {
		return incoming, "", nil
	}
	return s.resolveConcurrentMessage(ctx, repo, incoming, userID, organizationID, strategy, fullMessage)
}

func (s *Service) resolveConcurrentMessage(ctx context.Context, repo SyncRepository, incoming MessageSyncPayload, userID string, organizationID *int32, strategy ResolutionStrategy, fullMessage *MessageRecord) (MessageSyncPayload, string, error) {
	switch strategy {
	case StrategyClientWins:
		s.recordResolution(ctx, strategy)
		return incoming, "", nil
	case StrategyAutoMerge:
		resolved, ok, err := s.resolveMessageConflictWithMessage(ctx, repo, incoming, userID, organizationID, strategy, fullMessage)
		if err != nil {
			slog.Error("Failed to resolve message conflict", "error", err, "messageId", incoming.MessageID)
			return incoming, "", err
		}
		if !ok {
			return incoming, "concurrent_update", nil
		}
		return resolved, "", nil
	default:
		return incoming, "", fmt.Errorf("unsupported resolution strategy: %s", strategy)
	}
}

func (s *Service) resolveMessageConflictWithMessage(
	ctx context.Context,
	repo SyncRepository,
	incoming MessageSyncPayload,
	userID string,
	organizationID *int32,
	strategy ResolutionStrategy,
	serverMessage *MessageRecord,
) (MessageSyncPayload, bool, error) {
	if strategy != StrategyAutoMerge || s.resolver == nil {
		return incoming, false, nil
	}

	fullMsg := serverMessage
	if fullMsg == nil {
		loadedMessage, err := repo.GetMessageByMessageIDScoped(ctx, incoming.MessageID, userID, organizationID)
		if err != nil {
			return incoming, false, fmt.Errorf("get message: %w", err)
		}
		fullMsg = &loadedMessage
	}

	serverPayload := messagePayloadFromRecord(fullMsg)

	resolved, err := s.resolver.ResolveMessage(serverPayload, incoming)
	if err != nil {
		if s.telemetry != nil {
			s.telemetry.RecordResolution(ctx, strategy, false, 0)
		}
		return incoming, false, fmt.Errorf("resolve message conflict: %w", err)
	}
	if s.telemetry != nil {
		s.telemetry.RecordResolution(ctx, strategy, true, 0)
	}
	return resolved, true, nil
}

func (s *Service) handleMessagePatchWithMessage(
	ctx context.Context,
	repo SyncRepository,
	incoming MessageSyncPayload,
	userID string,
	organizationID *int32,
	serverMessage *MessageRecord,
) (MessageSyncPayload, error) {
	fullMsg := serverMessage
	if fullMsg == nil {
		loadedMessage, err := repo.GetMessageByMessageIDScoped(ctx, incoming.MessageID, userID, organizationID)
		if err != nil {
			return incoming, fmt.Errorf("get message: %w", err)
		}
		fullMsg = &loadedMessage
	}

	currentPayload := messagePayloadFromRecord(fullMsg)

	patchedBytes, err := s.applyPatch(currentPayload, incoming.Patches)
	if err != nil {
		return incoming, fmt.Errorf("apply message patch: %w", err)
	}

	var patched MessageSyncPayload
	err = json.Unmarshal(patchedBytes, &patched)
	if err != nil {
		return incoming, fmt.Errorf("unmarshal patched message: %w", err)
	}
	// Preserve immutable identity fields from persisted state.
	patched.MessageID = currentPayload.MessageID
	patched.ConversationID = currentPayload.ConversationID
	return patched, nil
}

func messagePayloadFromRecord(msg *MessageRecord) MessageSyncPayload {
	return MessageSyncPayload{
		MessageID:        msg.MessageID,
		ConversationID:   msg.ConversationID,
		Role:             msg.Role,
		Content:          msg.Content,
		IsStreaming:      msg.IsStreaming,
		IsAgentStatus:    msg.IsAgentStatus,
		ElapsedSeconds:   msg.ElapsedSeconds,
		CreatedAt:        msg.CreatedAt.Time,
		Error:            msg.Error,
		Sources:          jsonColumnValue(msg.Sources),
		ToolEvents:       jsonColumnValue(msg.ToolEvents),
		AgentStatuses:    jsonColumnValue(msg.AgentStatuses),
		Trace:            jsonColumnValue(msg.Trace),
		SyncVersion:      msg.SyncVersion,
		VectorClock:      msg.VectorClock,
		LastSyncedAt:     msg.LastSyncedAt.Time,
		DeviceID:         msg.DeviceID,
		IsDeleted:        msg.IsDeleted,
		ContentTruncated: false,
		UpdatedAt:        msg.UpdatedAt.Time,
	}
}

func (s *Service) updateMessage(
	ctx context.Context,
	repo SyncRepository,
	userID string,
	deviceID string,
	version int32,
	organizationID *int32,
	incoming MessageSyncPayload,
) error {
	payload, err := serializeMessagePayload(incoming)
	if err != nil {
		return err
	}

	err = repo.UpdateMessageSync(ctx, UpdateMessageInput{
		MessageID:      incoming.MessageID,
		Content:        incoming.Content,
		IsStreaming:    incoming.IsStreaming,
		IsAgentStatus:  incoming.IsAgentStatus,
		ElapsedSeconds: incoming.ElapsedSeconds,
		Error:          incoming.Error,
		Sources:        payload.Sources,
		ToolEvents:     payload.ToolEvents,
		AgentStatuses:  payload.AgentStatuses,
		SyncVersion:    version,
		VectorClock:    incoming.VectorClock,
		DeviceID:       &deviceID,
		IsDeleted:      incoming.IsDeleted,
		UserID:         &userID,
		OrganizationID: organizationID,
		Trace:          payload.Trace,
	})
	if err != nil {
		return fmt.Errorf("update message during sync: %w", err)
	}
	return nil
}

func (s *Service) createMessage(
	ctx context.Context,
	repo SyncRepository,
	userID string,
	deviceID string,
	version int32,
	organizationID *int32,
	incoming MessageSyncPayload,
) error {
	// A soft-deleted conversation returns a row, so we must explicitly check IsDeleted.
	if organizationID != nil {
		if err := s.validateParentConversationWithOrg(ctx, repo, incoming.ConversationID, userID, *organizationID); err != nil {
			return err
		}
	} else {
		if err := s.validateParentConversation(ctx, repo, incoming.ConversationID, userID); err != nil {
			return err
		}
	}

	payload, err := serializeMessagePayload(incoming)
	if err != nil {
		return err
	}

	_, err = repo.CreateMessageSync(ctx, CreateMessageInput{
		MessageID:      incoming.MessageID,
		ConversationID: incoming.ConversationID,
		Role:           incoming.Role,
		Content:        incoming.Content,
		IsStreaming:    incoming.IsStreaming,
		IsAgentStatus:  incoming.IsAgentStatus,
		ElapsedSeconds: incoming.ElapsedSeconds,
		Error:          incoming.Error,
		Sources:        payload.Sources,
		ToolEvents:     payload.ToolEvents,
		AgentStatuses:  payload.AgentStatuses,
		SyncVersion:    version,
		VectorClock:    incoming.VectorClock,
		DeviceID:       &deviceID,
		IsDeleted:      incoming.IsDeleted,
		CreatedAt:      Timestamp{Time: incoming.CreatedAt, Valid: true},
		Trace:          payload.Trace,
	})
	if err != nil {
		return fmt.Errorf("create message during sync: %w", err)
	}
	return nil
}

type serializedMessagePayload struct {
	Sources       []byte
	ToolEvents    []byte
	AgentStatuses []byte
	Trace         []byte
}

func serializeMessagePayload(incoming MessageSyncPayload) (serializedMessagePayload, error) {
	sourcesJSON, err := marshalMessageJSON(incoming.Sources)
	if err != nil {
		return serializedMessagePayload{}, fmt.Errorf("marshal message sources: %w", err)
	}
	toolEventsJSON, err := marshalMessageJSON(incoming.ToolEvents)
	if err != nil {
		return serializedMessagePayload{}, fmt.Errorf("marshal tool events: %w", err)
	}
	agentStatusesJSON, err := marshalMessageJSON(incoming.AgentStatuses)
	if err != nil {
		return serializedMessagePayload{}, fmt.Errorf("marshal agent statuses: %w", err)
	}
	var traceJSON []byte
	if incoming.Trace != nil {
		traceJSON, err = json.Marshal(incoming.Trace)
		if err != nil {
			return serializedMessagePayload{}, fmt.Errorf("marshal trace: %w", err)
		}
	}
	return serializedMessagePayload{
		Sources:       sourcesJSON,
		ToolEvents:    toolEventsJSON,
		AgentStatuses: agentStatusesJSON,
		Trace:         traceJSON,
	}, nil
}

var messageJSONNull = []byte("null")

func marshalMessageJSON(value any) ([]byte, error) {
	if isNilJSONValue(value) {
		return messageJSONNull, nil
	}
	return json.Marshal(value)
}

func isNilJSONValue(value any) bool {
	if value == nil {
		return true
	}
	v := reflect.ValueOf(value)
	switch v.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice:
		return v.IsNil()
	default:
		return false
	}
}

func (s *Service) handleNewMessage(ctx context.Context, repo SyncRepository, userID string, deviceID string, version int32, organizationID *int32, incoming MessageSyncPayload, accepted *[]string) (int32, error) {
	if organizationID != nil {
		if _, crossOrgErr := repo.GetMessageVersion(ctx, incoming.MessageID); crossOrgErr == nil {
			slog.Warn("Cross-org message access rejected", "messageId", incoming.MessageID, "userId", userID, "orgId", *organizationID)
			return version, fmt.Errorf("message %s does not belong to org %d", incoming.MessageID, *organizationID)
		} else if !errors.Is(crossOrgErr, ErrNotFound) {
			return version, fmt.Errorf("verify org message uniqueness: %w", crossOrgErr)
		}
	}
	var err error
	version, err = nextSyncVersion(ctx, repo, version)
	if err != nil {
		return version, err
	}
	incoming.VectorClock = initialVectorClock(deviceID)
	if createErr := s.createMessage(ctx, repo, userID, deviceID, version, organizationID, incoming); createErr != nil {
		slog.Error("Failed to create message during sync", "error", createErr, "messageId", incoming.MessageID, "userId", userID)
		return version, createErr
	}
	*accepted = append(*accepted, fmt.Sprintf("message:%s", incoming.MessageID))
	return version, nil
}

func (s *Service) validateParentConversationWithOrg(ctx context.Context, repo SyncRepository, conversationID int32, _ string, orgID int32) error {
	fullConv, convErr := repo.GetConversationWithOrg(ctx, conversationID, orgID)
	if convErr != nil {
		return fmt.Errorf("get conversation for message create validation: %w", convErr)
	}
	if fullConv.IsDeleted {
		return fmt.Errorf("cannot create message: parent conversation %d is deleted", conversationID)
	}
	return nil
}

func (s *Service) validateParentConversation(ctx context.Context, repo SyncRepository, conversationID int32, userID string) error {
	convRow, err := repo.GetConversationVersion(ctx, conversationID, &userID)
	if err != nil {
		return fmt.Errorf("validate conversation for message create: %w", err)
	}
	fullConv, convErr := repo.GetConversation(ctx, convRow.ID)
	if convErr != nil {
		return fmt.Errorf("get conversation for message create validation: %w", convErr)
	}
	if fullConv.OrganizationID != nil {
		return fmt.Errorf("cannot create personal-scope message in organization conversation %d", conversationID)
	}
	if fullConv.IsDeleted {
		return fmt.Errorf("cannot create message: parent conversation %d is deleted", conversationID)
	}
	return nil
}
