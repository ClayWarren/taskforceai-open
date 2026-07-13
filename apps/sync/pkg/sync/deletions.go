package sync

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
)

func (s *Service) applyDeletions(
	ctx context.Context,
	repo SyncRepository,
	userID string,
	deviceID string,
	organizationID *int32,
	currentVersion int32,
	deletions []DeletionRecord,
) (int32, []string, error) {
	version := currentVersion
	accepted := make([]string, 0, len(deletions))

	for _, deletion := range deletions {
		switch strings.ToLower(strings.TrimSpace(deletion.Type)) {
		case "conversation":
			nextVersion, ok, err := s.applyConversationDeletion(ctx, repo, userID, deviceID, organizationID, version, deletion)
			if err != nil {
				return version, accepted, err
			}
			if ok {
				version = nextVersion
				accepted = append(accepted, fmt.Sprintf("deletion:%s", deletion.ID))
			}
		case "message":
			nextVersion, ok, err := s.applyMessageDeletion(ctx, repo, userID, deviceID, organizationID, version, deletion)
			if err != nil {
				return version, accepted, err
			}
			if ok {
				version = nextVersion
				accepted = append(accepted, fmt.Sprintf("deletion:%s", deletion.ID))
			}
		default:
			return version, accepted, fmt.Errorf("unsupported deletion type %q", deletion.Type)
		}
	}

	return version, accepted, nil
}

func (s *Service) applyConversationDeletion(
	ctx context.Context,
	repo SyncRepository,
	userID string,
	deviceID string,
	organizationID *int32,
	version int32,
	deletion DeletionRecord,
) (int32, bool, error) {
	conversationID, err := strconv.ParseInt(strings.TrimSpace(deletion.ID), 10, 32)
	if err != nil {
		return version, false, fmt.Errorf("invalid conversation deletion id: %w", err)
	}
	dbConversationID := int32(conversationID)

	existingVersion, err := getConversationVersionForScope(ctx, repo, dbConversationID, userID, organizationID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return version, true, nil
		}
		return version, false, fmt.Errorf("get conversation version for deletion: %w", err)
	}

	fullConv, err := getConversationForScope(ctx, repo, dbConversationID, organizationID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return version, true, nil
		}
		return version, false, fmt.Errorf("get conversation for deletion: %w", err)
	}

	if organizationID == nil && fullConv.UserID != nil && *fullConv.UserID != userID {
		slog.Warn("Delete permission denied: user does not own conversation",
			"conversationId", conversationID, "requestingUser", userID)
		return version, false, fmt.Errorf("delete denied: conversation %d not owned by user", conversationID)
	}

	deletionVC := DecodeVectorClock(existingVersion.VectorClock)
	deletionVC.Increment(deviceID)

	version, err = nextSyncVersion(ctx, repo, version)
	if err != nil {
		return version, false, err
	}
	if err := repo.UpdateConversationSync(ctx, UpdateConversationInput{
		ID:                  dbConversationID,
		OrganizationID:      fullConv.OrganizationID,
		UserInput:           fullConv.UserInput,
		Result:              fullConv.Result,
		ExecutionTime:       fullConv.ExecutionTime,
		Model:               fullConv.Model,
		AgentCount:          fullConv.AgentCount,
		SyncVersion:         version,
		VectorClock:         deletionVC.Encode(),
		DeviceID:            &deviceID,
		IsDeleted:           true,
		UserID:              &userID,
		ScopeOrganizationID: fullConv.OrganizationID,
	}); err != nil {
		return version, false, fmt.Errorf("update deleted conversation: %w", err)
	}

	persistedVersion, err := getConversationVersionForScope(ctx, repo, dbConversationID, userID, organizationID)
	if err != nil {
		return version, false, fmt.Errorf("verify deleted conversation update: %w", err)
	}
	if persistedVersion.SyncVersion < version {
		return version, false, fmt.Errorf("verify deleted conversation update: no-op for conversation %d", conversationID)
	}

	return version, true, nil
}

func (s *Service) applyMessageDeletion(
	ctx context.Context,
	repo SyncRepository,
	userID string,
	deviceID string,
	organizationID *int32,
	version int32,
	deletion DeletionRecord,
) (int32, bool, error) {
	existingVersion, err := repo.GetMessageVersionScoped(ctx, deletion.ID, userID, organizationID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return version, true, nil
		}
		return version, false, fmt.Errorf("get message version for deletion: %w", err)
	}

	fullMessage, err := repo.GetMessageByMessageIDScoped(ctx, deletion.ID, userID, organizationID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return version, true, nil
		}
		return version, false, fmt.Errorf("get message for deletion: %w", err)
	}
	if fullMessage.IsDeleted {
		return version, true, nil
	}

	deletionVC := DecodeVectorClock(existingVersion.VectorClock)
	deletionVC.Increment(deviceID)

	version, err = nextSyncVersion(ctx, repo, version)
	if err != nil {
		return version, false, err
	}
	if err := repo.UpdateMessageSync(ctx, UpdateMessageInput{
		MessageID:      fullMessage.MessageID,
		Content:        fullMessage.Content,
		IsStreaming:    fullMessage.IsStreaming,
		IsAgentStatus:  fullMessage.IsAgentStatus,
		ElapsedSeconds: fullMessage.ElapsedSeconds,
		Error:          fullMessage.Error,
		Sources:        fullMessage.Sources,
		ToolEvents:     fullMessage.ToolEvents,
		AgentStatuses:  fullMessage.AgentStatuses,
		SyncVersion:    version,
		VectorClock:    deletionVC.Encode(),
		DeviceID:       &deviceID,
		IsDeleted:      true,
		UserID:         &userID,
		OrganizationID: organizationID,
	}); err != nil {
		return version, false, fmt.Errorf("update deleted message: %w", err)
	}

	persistedVersion, err := repo.GetMessageVersionScoped(ctx, deletion.ID, userID, organizationID)
	if err != nil {
		return version, false, fmt.Errorf("verify deleted message update: %w", err)
	}
	if persistedVersion.SyncVersion < version {
		return version, false, fmt.Errorf("verify deleted message update: no-op for message %s", deletion.ID)
	}

	return version, true, nil
}

func getConversationVersionForScope(ctx context.Context, repo SyncRepository, conversationID int32, userID string, organizationID *int32) (ConversationVersion, error) {
	if organizationID != nil {
		return repo.GetConversationVersionWithOrg(ctx, conversationID, nil, *organizationID)
	}
	return repo.GetConversationVersion(ctx, conversationID, &userID)
}

func getConversationForScope(ctx context.Context, repo SyncRepository, conversationID int32, organizationID *int32) (ConversationRecord, error) {
	if organizationID != nil {
		return repo.GetConversationWithOrg(ctx, conversationID, *organizationID)
	}
	return repo.GetConversation(ctx, conversationID)
}
