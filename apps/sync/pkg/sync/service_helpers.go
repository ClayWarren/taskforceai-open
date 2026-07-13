package sync

import (
	"context"
	"fmt"
)

func nextSyncVersion(ctx context.Context, repo SyncRepository, current int32) (int32, error) {
	next, err := repo.NextSyncVersion(ctx, current)
	if err != nil {
		return current, fmt.Errorf("allocate sync version: %w", err)
	}
	if next <= current {
		return current, fmt.Errorf("allocated sync version %d does not advance %d", next, current)
	}
	return next, nil
}

func (s *Service) pruneVectorClock(vc VectorClock, activeDevices map[string]struct{}) {
	if activeDevices == nil {
		return
	}
	for deviceID := range vc {
		if _, active := activeDevices[deviceID]; !active {
			delete(vc, deviceID)
		}
	}
}

func activeDeviceIDs(devices []SyncDeviceRecord) map[string]struct{} {
	ids := make(map[string]struct{}, len(devices))
	for _, device := range devices {
		ids[device.DeviceID] = struct{}{}
	}
	return ids
}

func (s *Service) acceptedVectorClock(clientVC, serverVC VectorClock, deviceID string, activeDevices map[string]struct{}) []byte {
	if activeDevices == nil {
		return acceptedOrgVectorClock(clientVC, serverVC, deviceID).Encode()
	}
	clientVC.Merge(serverVC)
	clientVC.Increment(deviceID)
	s.pruneVectorClock(clientVC, activeDevices)
	return clientVC.Encode()
}

func acceptedOrgVectorClock(clientVC, serverVC VectorClock, deviceID string) VectorClock {
	accepted := make(VectorClock, len(serverVC)+1)
	accepted.Merge(serverVC)
	if clientVersion := clientVC[deviceID]; clientVersion > accepted[deviceID] {
		accepted[deviceID] = clientVersion
	}
	accepted.Increment(deviceID)
	return accepted
}

func initialVectorClock(deviceID string) []byte {
	vc := make(VectorClock)
	vc.Increment(deviceID)
	return vc.Encode()
}

func (s *Service) appendConflict(ctx context.Context, conflicts []ConflictRecord, typ, id, reason string, serverVersion, clientVersion int32) []ConflictRecord {
	conflicts = append(conflicts, ConflictRecord{
		Type:          typ,
		ID:            id,
		Reason:        reason,
		ServerVersion: serverVersion,
		ClientVersion: clientVersion,
	})
	if s.telemetry != nil {
		s.telemetry.RecordConflict(ctx, conflictMetricName(typ, reason))
	}
	return conflicts
}

func conflictMetricName(typ, reason string) string {
	if reason == "concurrent_update" {
		return typ
	}
	return typ + "_" + reason
}

func ensurePushResponseDefaults(response SyncPushResponse) SyncPushResponse {
	if response.Conflicts == nil {
		response.Conflicts = []ConflictRecord{}
	}
	for idx := range response.Conflicts {
		if response.Conflicts[idx].Reason == "" {
			response.Conflicts[idx].Reason = "conflict"
		}
	}
	if response.Accepted == nil {
		response.Accepted = []string{}
	}
	if response.ConversationIDMappings == nil {
		response.ConversationIDMappings = map[string]int32{}
	}
	if response.NewVersion == 0 {
		response.NewVersion = response.Version
	}
	if response.Version == 0 && response.NewVersion != 0 {
		response.Version = response.NewVersion
	}
	return response
}

func scopeIdempotencyKey(idempotencyKey string, orgID *int32) string {
	if idempotencyKey == "" {
		return ""
	}
	if orgID == nil {
		return idempotencyKey
	}
	return fmt.Sprintf("org:%d:%s", *orgID, idempotencyKey)
}

func normalizeResolutionStrategy(strategy ResolutionStrategy) ResolutionStrategy {
	if strategy == "" {
		return StrategyAutoMerge
	}
	return strategy
}
