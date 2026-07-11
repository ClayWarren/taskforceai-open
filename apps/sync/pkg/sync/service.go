package sync

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"time"

	"github.com/TaskForceAI/adapters/pkg/collections"
)

// Telemetry records sync outcomes without exposing a concrete telemetry SDK to
// the use-case layer.
type Telemetry interface {
	StartOperation(context.Context, string) (context.Context, func(error))
	RecordSync(context.Context, string, time.Duration, int32, int32)
	RecordConflict(context.Context, string)
	RecordResolution(context.Context, ResolutionStrategy, bool, time.Duration)
	RecordAutoMergeFieldChange(context.Context, string, string)
}

type Service struct {
	repo        SyncRepository
	broadcaster Broadcaster
	resolver    ConflictResolver
	locker      Locker
	idempotency IdempotencyStore
	telemetry   Telemetry
	runAsync    func(func())
	asyncSlots  chan struct{}
}

const syncAdvisoryDBTimeout = 1500 * time.Millisecond
const syncAdvisoryAsyncLimit = 8

func NewService(repo SyncRepository, broadcaster Broadcaster, resolver ConflictResolver, locker Locker, idempotency IdempotencyStore, telemetry Telemetry) *Service {
	return &Service{
		repo:        repo,
		broadcaster: broadcaster,
		resolver:    resolver,
		locker:      locker,
		idempotency: idempotency,
		telemetry:   telemetry,
		runAsync: func(fn func()) {
			go fn()
		},
		asyncSlots: make(chan struct{}, syncAdvisoryAsyncLimit),
	}
}

func (s *Service) heartbeatDevice(ctx context.Context, userID, deviceID, userAgent, operation string) error {
	device, err := s.repo.UpsertSyncDevice(ctx, UpsertSyncDeviceInput{
		UserID:    userID,
		DeviceID:  deviceID,
		UserAgent: &userAgent,
	})
	if err != nil {
		slog.Warn("Sync device heartbeat failed", "operation", operation, "userId", userID, "deviceId", deviceID, "error", err)
		return fmt.Errorf("verify sync device: %w", err)
	}
	if device.IsRevoked {
		slog.Warn("Sync blocked for revoked device", "operation", operation, "userId", userID, "deviceId", deviceID)
		return fmt.Errorf("%w: %s", ErrDeviceRevoked, deviceID)
	}
	return nil
}

func (s *Service) heartbeatPullDevice(ctx context.Context, userID, deviceID, userAgent string) error {
	isRevoked, err := s.repo.IsSyncDeviceRevoked(ctx, userID, deviceID)
	if err != nil {
		slog.Warn("Sync device revocation check failed", "operation", "pull", "userId", userID, "deviceId", deviceID, "error", err)
		return fmt.Errorf("verify sync device revocation: %w", err)
	}
	if isRevoked {
		slog.Warn("Sync blocked for revoked device", "operation", "pull", "userId", userID, "deviceId", deviceID)
		return fmt.Errorf("%w: %s", ErrDeviceRevoked, deviceID)
	}
	s.recordSyncDeviceHeartbeatAsync(ctx, userID, deviceID, userAgent, "pull")
	return nil
}

func (s *Service) startOperation(ctx context.Context, name string, retErr *error) (context.Context, func()) {
	if s.telemetry != nil {
		var finish func(error)
		ctx, finish = s.telemetry.StartOperation(ctx, name)
		return ctx, func() {
			finish(*retErr)
		}
	}
	return ctx, func() {}
}

func (s *Service) recordSyncAudit(
	ctx context.Context,
	userID string,
	deviceID string,
	action string,
	versionStart int32,
	versionEnd int32,
	itemsCount int32,
	conflictsCount int32,
	duration time.Duration,
	success bool,
	err error,
	details []byte,
) error {
	var errMsg *string
	if err != nil {
		message := err.Error()
		errMsg = &message
	}
	auditCtx, cancel := context.WithTimeout(ctx, syncAdvisoryDBTimeout)
	defer cancel()
	durationMs := durationMillisecondsInt32(duration)
	_, auditErr := s.repo.CreateSyncAuditLog(auditCtx, SyncAuditInput{
		UserID:         userID,
		DeviceID:       deviceID,
		Action:         action,
		VersionStart:   versionStart,
		VersionEnd:     versionEnd,
		ItemsCount:     itemsCount,
		ConflictsCount: conflictsCount,
		DurationMs:     durationMs,
		Success:        success,
		ErrorMessage:   errMsg,
		Details:        details,
	})
	return auditErr
}

func (s *Service) recordPullSyncAudit(
	ctx context.Context,
	userID string,
	deviceID string,
	versionStart int32,
	versionEnd int32,
	itemsCount int32,
	duration time.Duration,
) {
	auditCtx := context.WithoutCancel(ctx)
	write := func() {
		if err := s.recordSyncAudit(auditCtx, userID, deviceID, "PULL", versionStart, versionEnd, itemsCount, 0, duration, true, nil, nil); err != nil {
			slog.Warn("Sync pull audit log write failed", "userId", userID, "deviceId", deviceID, "error", err)
		}
	}
	if !s.dispatchAsync(write) {
		write()
	}
}

func (s *Service) recordSyncDeviceHeartbeatAsync(ctx context.Context, userID, deviceID, userAgent, operation string) {
	heartbeatCtx := context.WithoutCancel(ctx)
	write := func() {
		writeCtx, cancel := context.WithTimeout(heartbeatCtx, syncAdvisoryDBTimeout)
		defer cancel()
		if _, err := s.repo.UpsertSyncDevice(writeCtx, UpsertSyncDeviceInput{
			UserID:    userID,
			DeviceID:  deviceID,
			UserAgent: &userAgent,
		}); err != nil {
			slog.Warn("Sync device heartbeat failed", "operation", operation, "userId", userID, "deviceId", deviceID, "error", err)
		}
	}
	if !s.dispatchAsync(write) {
		write()
	}
}

func (s *Service) dispatchAsync(fn func()) bool {
	if fn == nil {
		return true
	}
	if s.asyncSlots == nil {
		s.asyncSlots = make(chan struct{}, syncAdvisoryAsyncLimit)
	}
	select {
	case s.asyncSlots <- struct{}{}:
	default:
		slog.Warn("Sync advisory async worker saturated")
		return false
	}

	launcher := s.runAsync
	if launcher == nil {
		launcher = func(fn func()) {
			go fn()
		}
	}
	launcher(func() {
		defer func() {
			<-s.asyncSlots
			if recovered := recover(); recovered != nil {
				slog.Error("Sync advisory async worker panicked", "panic", recovered)
			}
		}()
		fn()
	})
	return true
}

func durationMillisecondsInt32(duration time.Duration) int32 {
	milliseconds := duration.Milliseconds()
	if milliseconds > math.MaxInt32 {
		return math.MaxInt32
	}
	if milliseconds < math.MinInt32 {
		return math.MinInt32
	}
	return int32(milliseconds) // #nosec G115 -- bounded by math.MinInt32/math.MaxInt32 above.
}

func (s *Service) ListDevices(ctx context.Context, userID string) ([]DeviceRecord, error) {
	devices, err := s.repo.GetSyncDevices(ctx, userID)
	if err != nil {
		slog.Error("Failed to list sync devices", "error", err, "userId", userID)
		return nil, err
	}

	return collections.Map(devices, MapDevice), nil
}

func (s *Service) RevokeDevice(ctx context.Context, userID, deviceID string) error {
	err := s.repo.RevokeSyncDevice(ctx, userID, deviceID)
	if err != nil {
		slog.Error("Failed to revoke sync device", "error", err, "userId", userID, "deviceId", deviceID)
	}
	return err
}
