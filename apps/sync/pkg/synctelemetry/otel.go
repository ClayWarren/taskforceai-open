package synctelemetry

import (
	"context"
	"time"

	syncpkg "github.com/TaskForceAI/go-sync/pkg/sync"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
)

// Adapter implements the sync telemetry port with OpenTelemetry.
type Adapter struct {
	tracer                trace.Tracer
	syncDuration          metric.Float64Histogram
	itemsProcessed        metric.Int64Counter
	conflictsFound        metric.Int64Counter
	activeSessions        metric.Int64UpDownCounter
	conflictsByType       metric.Int64Counter
	resolutionStrategy    metric.Int64Counter
	resolutionLatency     metric.Float64Histogram
	resolutionOutcome     metric.Int64Counter
	autoMergeFieldChanges metric.Int64Counter
}

func New() *Adapter {
	meter := otel.Meter("sync-service")
	duration, _ := meter.Float64Histogram("sync.duration", metric.WithDescription("Duration of sync operations"), metric.WithUnit("ms"))
	items, _ := meter.Int64Counter("sync.items_processed", metric.WithDescription("Total number of items processed during sync"))
	conflicts, _ := meter.Int64Counter("sync.conflicts", metric.WithDescription("Total number of conflicts detected"))
	sessions, _ := meter.Int64UpDownCounter("sync.active_sessions", metric.WithDescription("Number of active sync sessions"))
	conflictsByType, _ := meter.Int64Counter("sync.conflicts_by_type", metric.WithDescription("Conflicts categorized by entity type"))
	resolutionStrategy, _ := meter.Int64Counter("sync.resolution_strategy", metric.WithDescription("Count of resolutions by strategy"))
	resolutionLatency, _ := meter.Float64Histogram("sync.resolution_latency", metric.WithDescription("Time taken to resolve conflicts"), metric.WithUnit("ms"))
	resolutionOutcome, _ := meter.Int64Counter("sync.resolution_outcome", metric.WithDescription("Resolution outcomes"))
	autoMergeFieldChanges, _ := meter.Int64Counter("sync.auto_merge_field_changes", metric.WithDescription("Fields changed during auto-merge"))
	return &Adapter{
		tracer:                otel.Tracer("sync-service.logic"),
		syncDuration:          duration,
		itemsProcessed:        items,
		conflictsFound:        conflicts,
		activeSessions:        sessions,
		conflictsByType:       conflictsByType,
		resolutionStrategy:    resolutionStrategy,
		resolutionLatency:     resolutionLatency,
		resolutionOutcome:     resolutionOutcome,
		autoMergeFieldChanges: autoMergeFieldChanges,
	}
}

func (a *Adapter) StartOperation(ctx context.Context, name string) (context.Context, func(error)) {
	a.activeSessions.Add(ctx, 1)
	ctx, span := a.tracer.Start(ctx, name)
	return ctx, func(err error) {
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, err.Error())
		} else {
			span.SetStatus(codes.Ok, "")
		}
		span.End()
		a.activeSessions.Add(ctx, -1)
	}
}

func (a *Adapter) RecordSync(ctx context.Context, action string, duration time.Duration, items int32, conflicts int32) {
	attrs := metric.WithAttributes(attribute.String("sync.action", action))
	a.syncDuration.Record(ctx, float64(duration.Milliseconds()), attrs)
	a.itemsProcessed.Add(ctx, int64(items), attrs)
	a.conflictsFound.Add(ctx, int64(conflicts), attrs)
}

func (a *Adapter) RecordConflict(ctx context.Context, entityType string) {
	a.conflictsByType.Add(ctx, 1, metric.WithAttributes(attribute.String("entity_type", entityType)))
}

func (a *Adapter) RecordResolution(ctx context.Context, strategy syncpkg.ResolutionStrategy, success bool, duration time.Duration) {
	attrs := metric.WithAttributes(attribute.String("strategy", string(strategy)))
	a.resolutionStrategy.Add(ctx, 1, attrs)
	a.resolutionLatency.Record(ctx, float64(duration.Milliseconds()), attrs)
	outcome := "success"
	if !success {
		outcome = "failure"
	}
	a.resolutionOutcome.Add(ctx, 1, metric.WithAttributes(
		attribute.String("strategy", string(strategy)),
		attribute.String("outcome", outcome),
	))
}

func (a *Adapter) RecordAutoMergeFieldChange(ctx context.Context, entityType, fieldName string) {
	a.autoMergeFieldChanges.Add(ctx, 1, metric.WithAttributes(
		attribute.String("entity_type", entityType),
		attribute.String("field", fieldName),
	))
}
