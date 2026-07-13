package sync

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
)

func (s *Service) syncConversations(
	ctx context.Context,
	repo SyncRepository,
	userID string,
	deviceID string,
	activeDevices map[string]struct{},
	currentVersion int32,
	strategy ResolutionStrategy,
	conversations []ConversationSyncPayload,
) (int32, []ConflictRecord, []string, map[string]int32, error) {
	conflicts := []ConflictRecord{}
	accepted := []string{}
	conversationIDMappings := map[string]int32{}
	version := currentVersion

	for _, incoming := range conversations {
		if incoming.ID == 0 {
			var err error
			version, err = s.handleNewConversation(ctx, repo, userID, deviceID, version, incoming, &accepted, conversationIDMappings)
			if err != nil {
				return version, conflicts, accepted, conversationIDMappings, err
			}
			continue
		}

		existing, err := conversationVersionForPayload(ctx, repo, userID, incoming)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				conflicts = s.appendConflict(ctx, conflicts, "conversation", fmt.Sprintf("%d", incoming.ID), "missing_conversation", 0, incoming.SyncVersion)
				continue
			}
			slog.Error("Failed to get conversation version during sync", "error", err, "conversationId", incoming.ID, "userId", userID)
			return version, conflicts, accepted, conversationIDMappings, fmt.Errorf("get conversation version: %w", err)
		}

		serverVC, clientVC := DecodeVectorClock(existing.VectorClock), DecodeVectorClock(incoming.VectorClock)
		causality := serverVC.Compare(clientVC)
		if causality == After {
			accepted = append(accepted, fmt.Sprintf("conversation:%d", incoming.ID))
			continue
		}

		prepared, outcome, prepareErr := s.prepareConversationUpdate(ctx, repo, incoming, existing, causality, strategy)
		if prepareErr != nil {
			return version, conflicts, accepted, conversationIDMappings, prepareErr
		}
		if outcome == "accepted" {
			accepted = append(accepted, fmt.Sprintf("conversation:%d", incoming.ID))
			continue
		}
		if outcome != "" {
			conflicts = s.appendConflict(ctx, conflicts, "conversation", fmt.Sprintf("%d", incoming.ID), outcome, existing.SyncVersion, incoming.SyncVersion)
			continue
		}
		incoming = prepared

		version, err = nextSyncVersion(ctx, repo, version)
		if err != nil {
			return version, conflicts, accepted, conversationIDMappings, err
		}
		incoming.VectorClock = s.acceptedVectorClock(clientVC, serverVC, deviceID, activeDevices)

		if err := s.updateConversation(ctx, repo, userID, deviceID, version, incoming); err != nil {
			slog.Error("Failed to update conversation during sync", "error", err, "conversationId", incoming.ID)
			return version, conflicts, accepted, conversationIDMappings, err
		}
		accepted = append(accepted, fmt.Sprintf("conversation:%d", incoming.ID))
	}
	return version, conflicts, accepted, conversationIDMappings, nil
}

func conversationVersionForPayload(ctx context.Context, repo SyncRepository, userID string, incoming ConversationSyncPayload) (ConversationVersion, error) {
	if incoming.OrganizationID != nil {
		return repo.GetConversationVersionWithOrg(ctx, incoming.ID, nil, *incoming.OrganizationID)
	}
	return repo.GetConversationVersion(ctx, incoming.ID, &userID)
}

func (s *Service) prepareConversationUpdate(ctx context.Context, repo SyncRepository, incoming ConversationSyncPayload, existing ConversationVersion, causality ComparisonResult, strategy ResolutionStrategy) (ConversationSyncPayload, string, error) {
	needsFullConversation := (causality == Concurrent && strategy == StrategyAutoMerge && s.resolver != nil) || len(incoming.Patches) > 0
	var fullConversation *ConversationRecord
	if needsFullConversation {
		loaded, err := s.loadConversationForPayload(ctx, repo, incoming)
		if errors.Is(err, ErrNotFound) {
			return incoming, "conversation_unavailable", nil
		}
		if err != nil {
			slog.Error("Failed to load full conversation for sync", "error", err, "conversationId", incoming.ID)
			return incoming, "", err
		}
		fullConversation = &loaded
	}
	if causality == Concurrent && strategy == StrategyServerWins {
		s.recordResolution(ctx, strategy)
		return incoming, "accepted", nil
	}
	if len(incoming.Patches) > 0 {
		const patchBaseVersionTolerance = int32(50)
		if existing.SyncVersion-incoming.SyncVersion > patchBaseVersionTolerance {
			slog.Warn("Rejecting conversation patch: base version diverged too far", "conversationId", incoming.ID, "serverVersion", existing.SyncVersion, "clientVersion", incoming.SyncVersion)
			return incoming, "patch_base_diverged", nil
		}
		patched, err := s.handleConversationPatchWithConversation(ctx, repo, incoming, fullConversation)
		if err != nil {
			slog.Error("Failed to handle conversation patch", "error", err, "conversationId", incoming.ID)
			return incoming, "", err
		}
		patched.Patches = nil
		incoming = patched
	}
	if causality != Concurrent {
		return incoming, "", nil
	}
	return s.resolveConcurrentConversation(ctx, repo, incoming, strategy, fullConversation)
}

func (s *Service) resolveConcurrentConversation(ctx context.Context, repo SyncRepository, incoming ConversationSyncPayload, strategy ResolutionStrategy, fullConversation *ConversationRecord) (ConversationSyncPayload, string, error) {
	switch strategy {
	case StrategyClientWins:
		s.recordResolution(ctx, strategy)
		return incoming, "", nil
	case StrategyAutoMerge:
		resolved, ok, err := s.resolveConversationConflictWithConversation(ctx, repo, incoming, strategy, fullConversation)
		if err != nil {
			slog.Error("Failed to resolve conversation conflict", "error", err, "conversationId", incoming.ID)
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

func (s *Service) recordResolution(ctx context.Context, strategy ResolutionStrategy) {
	if s.telemetry != nil {
		s.telemetry.RecordResolution(ctx, strategy, true, 0)
	}
}

func (s *Service) resolveConversationConflictWithConversation(
	ctx context.Context,
	repo SyncRepository,
	incoming ConversationSyncPayload,
	strategy ResolutionStrategy,
	serverConversation *ConversationRecord,
) (ConversationSyncPayload, bool, error) {
	if strategy != StrategyAutoMerge || s.resolver == nil {
		return incoming, false, nil
	}

	fullConv := serverConversation
	if fullConv == nil {
		loadedConv, err := s.loadConversationForPayload(ctx, repo, incoming)
		if err != nil {
			return incoming, false, err
		}
		fullConv = &loadedConv
	}

	serverPayload := conversationPayloadFromRecord(fullConv)

	resolved, err := s.resolver.ResolveConversation(serverPayload, incoming)
	if err != nil {
		if s.telemetry != nil {
			s.telemetry.RecordResolution(ctx, strategy, false, 0)
		}
		return incoming, false, fmt.Errorf("resolve conversation conflict: %w", err)
	}
	if s.telemetry != nil {
		s.telemetry.RecordResolution(ctx, strategy, true, 0)
	}
	return resolved, true, nil
}

func (s *Service) handleConversationPatchWithConversation(
	ctx context.Context,
	repo SyncRepository,
	incoming ConversationSyncPayload,
	serverConversation *ConversationRecord,
) (ConversationSyncPayload, error) {
	fullConv := serverConversation
	if fullConv == nil {
		loadedConv, err := s.loadConversationForPayload(ctx, repo, incoming)
		if err != nil {
			return incoming, err
		}
		fullConv = &loadedConv
	}

	currentPayload := conversationPayloadFromRecord(fullConv)

	patchedBytes, err := s.applyPatch(currentPayload, incoming.Patches)
	if err != nil {
		return incoming, fmt.Errorf("apply conversation patch: %w", err)
	}

	var patched ConversationSyncPayload
	err = json.Unmarshal(patchedBytes, &patched)
	if err != nil {
		return incoming, fmt.Errorf("unmarshal patched conversation: %w", err)
	}
	// Preserve immutable identity/scope fields from persisted state.
	patched.ID = currentPayload.ID
	patched.OrganizationID = currentPayload.OrganizationID
	patched.UserID = currentPayload.UserID
	return patched, nil
}

func conversationPayloadFromRecord(conv *ConversationRecord) ConversationSyncPayload {
	return ConversationSyncPayload{
		ID:               conv.ID,
		UserID:           conv.UserID,
		OrganizationID:   conv.OrganizationID,
		Timestamp:        conv.Timestamp.Time,
		UserInput:        conv.UserInput,
		Result:           conv.Result,
		ExecutionTime:    conv.ExecutionTime,
		Model:            conv.Model,
		AgentCount:       conv.AgentCount,
		SyncVersion:      conv.SyncVersion,
		VectorClock:      conv.VectorClock,
		LastSyncedAt:     conv.LastSyncedAt.Time,
		DeviceID:         conv.DeviceID,
		IsDeleted:        conv.IsDeleted,
		ContentTruncated: false,
		UpdatedAt:        conv.UpdatedAt.Time,
	}
}

func (s *Service) loadConversationForPayload(ctx context.Context, repo SyncRepository, incoming ConversationSyncPayload) (ConversationRecord, error) {
	var fullConv ConversationRecord
	var err error
	// Use org-filtered query for enterprise isolation when org is present
	if incoming.OrganizationID != nil {
		fullConv, err = repo.GetConversationWithOrg(ctx, incoming.ID, *incoming.OrganizationID)
	} else {
		fullConv, err = repo.GetConversation(ctx, incoming.ID)
	}
	if err != nil {
		return ConversationRecord{}, fmt.Errorf("get conversation: %w", err)
	}
	return fullConv, nil
}

func (s *Service) createConversation(ctx context.Context, repo SyncRepository, userID string, deviceID string, version int32, incoming ConversationSyncPayload) (int32, error) {
	created, err := repo.CreateConversationSync(ctx, CreateConversationInput{
		UserID:         &userID,
		OrganizationID: incoming.OrganizationID,
		UserInput:      incoming.UserInput,
		Result:         incoming.Result,
		ExecutionTime:  incoming.ExecutionTime,
		Model:          incoming.Model,
		AgentCount:     incoming.AgentCount,
		SyncVersion:    version,
		VectorClock:    incoming.VectorClock,
		DeviceID:       &deviceID,
		IsDeleted:      incoming.IsDeleted,
		Timestamp:      Timestamp{Time: incoming.Timestamp, Valid: true},
	})
	if err != nil {
		return 0, fmt.Errorf("create conversation during sync: %w", err)
	}
	return created.ID, nil
}

func (s *Service) updateConversation(ctx context.Context, repo SyncRepository, userID string, deviceID string, version int32, incoming ConversationSyncPayload) error {
	err := repo.UpdateConversationSync(ctx, UpdateConversationInput{
		ID:                  incoming.ID,
		OrganizationID:      incoming.OrganizationID,
		UserInput:           incoming.UserInput,
		Result:              incoming.Result,
		ExecutionTime:       incoming.ExecutionTime,
		Model:               incoming.Model,
		AgentCount:          incoming.AgentCount,
		SyncVersion:         version,
		VectorClock:         incoming.VectorClock,
		DeviceID:            &deviceID,
		UserID:              &userID,
		IsDeleted:           incoming.IsDeleted,
		ScopeOrganizationID: incoming.OrganizationID,
	})
	if err != nil {
		return fmt.Errorf("update conversation during sync: %w", err)
	}
	return nil
}

func (s *Service) handleNewConversation(ctx context.Context, repo SyncRepository, userID string, deviceID string, version int32, incoming ConversationSyncPayload, accepted *[]string, mappings map[string]int32) (int32, error) {
	var err error
	version, err = nextSyncVersion(ctx, repo, version)
	if err != nil {
		return version, err
	}
	incoming.VectorClock = initialVectorClock(deviceID)
	createdID, err := s.createConversation(ctx, repo, userID, deviceID, version, incoming)
	if err != nil {
		slog.Error("Failed to create conversation during sync", "error", err, "userId", userID, "deviceId", deviceID)
		return version, err
	}
	if incoming.LocalID != nil && *incoming.LocalID != "" {
		if _, exists := mappings[*incoming.LocalID]; exists {
			slog.Warn("Duplicate localId in push batch; skipping second mapping", "localId", *incoming.LocalID, "userId", userID)
		} else {
			mappings[*incoming.LocalID] = createdID
		}
		*accepted = append(*accepted, fmt.Sprintf("conversation:%s", *incoming.LocalID))
	} else {
		*accepted = append(*accepted, fmt.Sprintf("conversation:%d", createdID))
	}
	return version, nil
}
