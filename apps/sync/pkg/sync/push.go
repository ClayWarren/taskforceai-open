package sync

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"strings"
	"time"
)

func (s *Service) PushChanges(ctx context.Context, userID string, deviceID string, userAgent string, idempotencyKey string, req SyncPushRequest) (_ *SyncPushResponse, retErr error) {
	start := time.Now()
	ctx, finishOperation := s.startOperation(ctx, "sync.PushChanges", &retErr)
	defer finishOperation()

	req.ResolutionStrategy = normalizeResolutionStrategy(req.ResolutionStrategy)
	if err := rejectTruncatedPushPayload(req); err != nil {
		return nil, err
	}
	resolvedIdempotencyKey, err := syncPushIdempotencyKey(userID, deviceID, idempotencyKey, req)
	if err != nil {
		return nil, err
	}
	scopedIdempotencyKey := scopeIdempotencyKey(resolvedIdempotencyKey, req.OrganizationID)

	release, err := s.acquirePushLock(ctx, userID, req.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer release()

	if err := s.heartbeatDevice(ctx, userID, deviceID, userAgent, "push"); err != nil {
		return nil, err
	}

	if cached, hit, cacheErr := s.loadCachedPush(ctx, userID, idempotencyKey, scopedIdempotencyKey); cacheErr != nil {
		slog.Warn("Redis sync idempotency lookup unavailable; using durable result", "userId", userID, "idempotencyKey", idempotencyKey, "error", cacheErr)
	} else if hit {
		if s.broadcaster != nil {
			if err := s.broadcaster.BroadcastSyncRequired(ctx, userID, req.OrganizationID, cached.Version); err != nil {
				return nil, fmt.Errorf("rebroadcast cached sync push: %w", err)
			}
		}
		return cached, nil
	}

	finalResponse, versionStart, err := s.applyPushTransaction(ctx, userID, deviceID, scopedIdempotencyKey, req)
	duration := time.Since(start)
	if err != nil {
		return nil, s.handlePushFailure(ctx, userID, deviceID, versionStart, duration, err)
	}
	if finalResponse == nil {
		return nil, errors.New("sync push failed: transaction completed without a response")
	}

	if err := s.finishSuccessfulPush(ctx, userID, deviceID, idempotencyKey, scopedIdempotencyKey, req, finalResponse, versionStart, duration); err != nil {
		return nil, err
	}
	return finalResponse, nil
}

func (s *Service) applyPushTransaction(ctx context.Context, userID, deviceID, durableKey string, req SyncPushRequest) (*SyncPushResponse, int32, error) {
	var finalResponse *SyncPushResponse
	var versionStart int32
	err := s.repo.WithTransaction(ctx, func(txRepo SyncRepository) error {
		durableRepo, hasDurableResults := txRepo.(DurablePushResultRepository)
		if hasDurableResults && durableKey != "" {
			cached, cacheErr := durableRepo.GetSyncPushResult(ctx, userID, durableKey)
			switch {
			case cacheErr == nil:
				finalResponse = &cached
				versionStart = cached.Version
				return nil
			case !errors.Is(cacheErr, ErrNotFound):
				return fmt.Errorf("load durable sync push result: %w", cacheErr)
			}
		}
		var currentVersion int32
		var err error
		if req.OrganizationID != nil {
			currentVersion, err = txRepo.GetLatestOrgSyncVersion(ctx, *req.OrganizationID)
		} else {
			currentVersion, err = txRepo.GetLatestSyncVersion(ctx, userID)
		}
		if err != nil {
			return err
		}
		versionStart = currentVersion

		activeDevices, err := txRepo.GetSyncDevices(ctx, userID)
		if err != nil {
			return fmt.Errorf("get sync devices: %w", err)
		}
		var activeIDs map[string]struct{}
		if req.OrganizationID == nil {
			activeIDs = activeDeviceIDs(activeDevices)
		}

		conflicts := []ConflictRecord{}
		accepted := []string{}
		conversationIDMappings := map[string]int32{}

		newVersion, convConflicts, convAccepted, convMappings, err := s.syncConversations(
			ctx,
			txRepo,
			userID,
			deviceID,
			activeIDs,
			currentVersion,
			req.ResolutionStrategy,
			req.Conversations,
		)
		if err != nil {
			return err
		}
		conflicts = append(conflicts, convConflicts...)
		accepted = append(accepted, convAccepted...)
		maps.Copy(conversationIDMappings, convMappings)
		resolvedMessages, err := resolveMessageConversationIDs(req.Messages, conversationIDMappings)
		if err != nil {
			return err
		}

		finalVersion, msgConflicts, msgAccepted, err := s.syncMessages(
			ctx,
			txRepo,
			userID,
			deviceID,
			activeIDs,
			newVersion,
			req.OrganizationID,
			req.ResolutionStrategy,
			resolvedMessages,
		)
		if err != nil {
			return err
		}
		conflicts = append(conflicts, msgConflicts...)
		accepted = append(accepted, msgAccepted...)

		var deletionAccepted []string
		finalVersion, deletionAccepted, err = s.applyDeletions(
			ctx,
			txRepo,
			userID,
			deviceID,
			req.OrganizationID,
			finalVersion,
			req.Deletions,
		)
		if err != nil {
			return err
		}
		accepted = append(accepted, deletionAccepted...)

		finalResponse = &SyncPushResponse{
			Success:                true,
			Conflicts:              conflicts,
			Version:                finalVersion,
			Accepted:               accepted,
			NewVersion:             finalVersion,
			ConversationIDMappings: conversationIDMappings,
		}
		normalized := ensurePushResponseDefaults(*finalResponse)
		finalResponse = &normalized
		if hasDurableResults && durableKey != "" {
			if err := durableRepo.SaveSyncPushResult(ctx, userID, durableKey, normalized); err != nil {
				return fmt.Errorf("save durable sync push result: %w", err)
			}
		}
		return nil
	})
	return finalResponse, versionStart, err
}

func resolveMessageConversationIDs(messages []MessageSyncPayload, mappings map[string]int32) ([]MessageSyncPayload, error) {
	resolved := append([]MessageSyncPayload(nil), messages...)
	for index := range resolved {
		message := &resolved[index]
		if message.ConversationID > 0 {
			continue
		}
		if message.ConversationLocalID == nil || strings.TrimSpace(*message.ConversationLocalID) == "" {
			continue
		}
		localID := strings.TrimSpace(*message.ConversationLocalID)
		remoteID, ok := mappings[localID]
		if !ok || remoteID <= 0 {
			return nil, fmt.Errorf("message %s references unresolved local conversation %q", message.MessageID, localID)
		}
		message.ConversationID = remoteID
	}
	return resolved, nil
}

func (s *Service) acquirePushLock(ctx context.Context, userID string, organizationID *int32) (func(), error) {
	if s.locker == nil {
		return func() {}, nil
	}
	lockScope := userID
	if organizationID != nil {
		lockScope = fmt.Sprintf("org:%d", *organizationID)
	}
	release, err := s.locker.Lock(ctx, lockScope)
	if err != nil {
		slog.Error("Sync push lock acquisition failed", "userId", userID, "orgId", organizationID, "lockScope", lockScope, "error", err)
		return nil, fmt.Errorf("concurrency limit: %w", err)
	}
	return release, nil
}

func (s *Service) loadCachedPush(ctx context.Context, userID, idempotencyKey, scopedKey string) (*SyncPushResponse, bool, error) {
	if s.idempotency == nil || scopedKey == "" {
		return nil, false, nil
	}
	lookup, err := s.idempotency.GetResult(ctx, userID, scopedKey)
	if err != nil {
		slog.Error("Sync push idempotency check failed", "userId", userID, "idempotencyKey", idempotencyKey, "error", err)
		return nil, false, fmt.Errorf("load idempotency result: %w", err)
	}
	switch result := lookup.(type) {
	case IdempotencyMiss:
		return nil, false, nil
	case IdempotencyHit:
		slog.Info("Returning cached sync result", "userId", userID, "idempotencyKey", idempotencyKey)
		normalized := ensurePushResponseDefaults(result.Response)
		return &normalized, true, nil
	}
	return nil, false, nil
}

func (s *Service) handlePushFailure(ctx context.Context, userID, deviceID string, versionStart int32, duration time.Duration, err error) error {
	slog.Error("Sync push failed", "userId", userID, "deviceId", deviceID, "error", err)
	if auditErr := s.recordSyncAudit(ctx, userID, deviceID, "PUSH", versionStart, versionStart, 0, 0, duration, false, err, nil); auditErr != nil {
		slog.Error("Sync push audit log write failed", "userId", userID, "error", auditErr)
		return errors.Join(fmt.Errorf("sync push failed: %w", err), fmt.Errorf("create sync audit log: %w", auditErr))
	}
	return fmt.Errorf("sync push failed: %w", err)
}

func (s *Service) finishSuccessfulPush(ctx context.Context, userID, deviceID, idempotencyKey, scopedKey string, req SyncPushRequest, response *SyncPushResponse, versionStart int32, duration time.Duration) error {
	totalItemsCount := boundedInt32Count(len(req.Conversations) + len(req.Messages))
	totalConflictsCount := boundedInt32Count(len(response.Conflicts))
	details := []byte(fmt.Sprintf(
		`{"conv_patches":%d,"msg_patches":%d}`,
		len(req.Conversations),
		len(req.Messages),
	))

	if err := s.recordSyncAudit(ctx, userID, deviceID, "PUSH", versionStart, response.Version, totalItemsCount, totalConflictsCount, duration, true, nil, details); err != nil {
		slog.Warn("Sync push audit log write failed", "userId", userID, "deviceId", deviceID, "error", err)
	}

	if s.telemetry != nil {
		s.telemetry.RecordSync(ctx, "PUSH", duration, totalItemsCount, totalConflictsCount)
	}
	if s.broadcaster != nil {
		if err := s.broadcaster.BroadcastSyncRequired(ctx, userID, req.OrganizationID, response.Version); err != nil {
			slog.Error("Failed to broadcast sync required", "userId", userID, "error", err)
			return fmt.Errorf("broadcast committed sync push: %w", err)
		}
	}
	if s.idempotency != nil && scopedKey != "" {
		if err := s.idempotency.SaveResult(ctx, userID, scopedKey, *response); err != nil {
			slog.Warn("Sync push save idempotency result failed", "userId", userID, "idempotencyKey", idempotencyKey, "error", err)
		}
	}
	return nil
}

func syncPushIdempotencyKey(userID, deviceID, explicit string, req SyncPushRequest) (string, error) {
	if explicit = strings.TrimSpace(explicit); explicit != "" {
		return explicit, nil
	}
	if len(req.Conversations)+len(req.Messages)+len(req.Deletions) == 0 {
		return "", nil
	}
	payload, err := json.Marshal(struct {
		UserID   string          `json:"user_id"`
		DeviceID string          `json:"device_id"`
		Request  SyncPushRequest `json:"request"`
	}{UserID: userID, DeviceID: deviceID, Request: req})
	if err != nil {
		return "", fmt.Errorf("derive sync push idempotency key: %w", err)
	}
	return fmt.Sprintf("auto:%x", sha256.Sum256(payload)), nil
}

func rejectTruncatedPushPayload(req SyncPushRequest) error {
	for _, conversation := range req.Conversations {
		if conversation.ContentTruncated {
			return fmt.Errorf("sync push rejected partial conversation payload: %d", conversation.ID)
		}
	}
	for _, message := range req.Messages {
		if message.ContentTruncated {
			return fmt.Errorf("sync push rejected partial message payload: %s", message.MessageID)
		}
	}
	return nil
}
