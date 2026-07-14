package run

import (
	"context"
	"errors"
	"sync"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
)

type runtimeTelemetry struct {
	runTracer              trace.Tracer
	submissionTracer       trace.Tracer
	generatedFileTracer    trace.Tracer
	taskDuration           metric.Float64Histogram
	taskTotal              metric.Int64Counter
	taskFailed             metric.Int64Counter
	pulseDuration          metric.Float64Histogram
	pulseTotal             metric.Int64Counter
	pulseFailed            metric.Int64Counter
	cacheDecisions         metric.Int64Counter
	submissionDuration     metric.Float64Histogram
	submissionTotal        metric.Int64Counter
	submissionFailed       metric.Int64Counter
	submissionQueueLatency metric.Float64Histogram
	generatedFileDuration  metric.Float64Histogram
	generatedFileTotal     metric.Int64Counter
	generatedFileFailed    metric.Int64Counter
	generatedFileBytes     metric.Int64Histogram
}

var (
	telemetryOnce sync.Once
	telemetryInst runtimeTelemetry
)

func getRuntimeTelemetry() runtimeTelemetry {
	telemetryOnce.Do(func() {
		meter := otel.Meter("engine-run")
		telemetryInst.runTracer = otel.Tracer("engine-run.task")
		telemetryInst.submissionTracer = otel.Tracer("engine-run.submission")
		telemetryInst.generatedFileTracer = otel.Tracer("engine-run.generated_file")

		telemetryInst.taskDuration, _ = meter.Float64Histogram(
			"engine.run.task.duration",
			metric.WithDescription("Duration of task orchestration runs in seconds"),
			metric.WithUnit("s"),
		)
		telemetryInst.taskTotal, _ = meter.Int64Counter(
			"engine.run.task.total",
			metric.WithDescription("Total number of task orchestration runs"),
		)
		telemetryInst.taskFailed, _ = meter.Int64Counter(
			"engine.run.task.failed",
			metric.WithDescription("Number of failed task orchestration runs"),
		)
		telemetryInst.pulseDuration, _ = meter.Float64Histogram(
			"engine.run.pulse.duration",
			metric.WithDescription("Duration of agent pulse runs in seconds"),
			metric.WithUnit("s"),
		)
		telemetryInst.pulseTotal, _ = meter.Int64Counter(
			"engine.run.pulse.total",
			metric.WithDescription("Total number of pulse runs"),
		)
		telemetryInst.pulseFailed, _ = meter.Int64Counter(
			"engine.run.pulse.failed",
			metric.WithDescription("Number of failed pulse runs"),
		)
		telemetryInst.cacheDecisions, _ = meter.Int64Counter(
			"engine.run.cache.decision.total",
			metric.WithDescription("Task cache decision counts by decision kind"),
		)
		telemetryInst.submissionDuration, _ = meter.Float64Histogram(
			"engine.run.submission.duration",
			metric.WithDescription("Duration of task submission handling in seconds"),
			metric.WithUnit("s"),
		)
		telemetryInst.submissionQueueLatency, _ = meter.Float64Histogram(
			"engine.run.submission.queue.duration",
			metric.WithDescription("Duration spent enqueueing tasks in seconds"),
			metric.WithUnit("s"),
		)
		telemetryInst.submissionTotal, _ = meter.Int64Counter(
			"engine.run.submission.total",
			metric.WithDescription("Total number of task submissions"),
		)
		telemetryInst.submissionFailed, _ = meter.Int64Counter(
			"engine.run.submission.failed",
			metric.WithDescription("Number of failed task submissions"),
		)
		telemetryInst.generatedFileDuration, _ = meter.Float64Histogram(
			"engine.run.generated_file.duration",
			metric.WithDescription("Duration of generated file persistence attempts in seconds"),
			metric.WithUnit("s"),
		)
		telemetryInst.generatedFileTotal, _ = meter.Int64Counter(
			"engine.run.generated_file.total",
			metric.WithDescription("Total number of generated file persistence attempts"),
		)
		telemetryInst.generatedFileFailed, _ = meter.Int64Counter(
			"engine.run.generated_file.failed",
			metric.WithDescription("Number of failed generated file persistence attempts"),
		)
		telemetryInst.generatedFileBytes, _ = meter.Int64Histogram(
			"engine.run.generated_file.bytes",
			metric.WithDescription("Persisted generated file sizes in bytes"),
			metric.WithUnit("By"),
		)
	})

	return telemetryInst
}

func startTaskSpan(ctx context.Context, taskID string, userID int, modelID string, opts OrchestrateTaskOptions) (context.Context, trace.Span) { //nolint:spancheck // The caller owns and ends the returned span.
	telemetry := getRuntimeTelemetry()
	//nolint:spancheck // The caller owns and ends the returned span.
	return telemetry.runTracer.Start(
		ctx,
		"engine.run.orchestrate_task",
		trace.WithAttributes(
			attribute.String("task.id", taskID),
			attribute.Int("task.user_id", userID),
			attribute.String("task.model_id", modelID),
			attribute.String("task.plan", opts.UserPlan),
			attribute.Bool("task.quick_mode", opts.QuickModeEnabled),
			attribute.Bool("task.has_project", opts.ProjectID != nil),
		),
	)
}

func finishTaskObservation(ctx context.Context, span trace.Span, startedAt time.Time, status TaskStatus, executionErr error, opts OrchestrateTaskOptions) {
	telemetry := getRuntimeTelemetry()
	durationSec := time.Since(startedAt).Seconds()
	attrs := []attribute.KeyValue{
		attribute.String("task.status", string(status)),
		attribute.String("task.source", opts.Source),
		attribute.String("task.plan", opts.UserPlan),
		attribute.Bool("task.quick_mode", opts.QuickModeEnabled),
	}

	if telemetry.taskDuration != nil {
		telemetry.taskDuration.Record(ctx, durationSec, metric.WithAttributes(attrs...))
	}
	if telemetry.taskTotal != nil {
		telemetry.taskTotal.Add(ctx, 1, metric.WithAttributes(attrs...))
	}

	normalizedErr := executionErr
	if normalizedErr == nil && status == StatusFailed {
		normalizedErr = errors.New("task orchestration failed")
	}

	if normalizedErr != nil {
		if telemetry.taskFailed != nil {
			telemetry.taskFailed.Add(ctx, 1, metric.WithAttributes(attrs...))
		}
		span.RecordError(normalizedErr)
		span.SetStatus(codes.Error, normalizedErr.Error())
	} else {
		span.SetStatus(codes.Ok, "task completed")
	}

	span.SetAttributes(attrs...)
	span.End()
}

func startPulseSpan(ctx context.Context, agentID, reason string) (context.Context, trace.Span) { //nolint:spancheck // The caller owns and ends the returned span.
	telemetry := getRuntimeTelemetry()
	//nolint:spancheck // The caller owns and ends the returned span.
	return telemetry.runTracer.Start(
		ctx,
		"engine.run.orchestrate_pulse",
		trace.WithAttributes(
			attribute.String("agent.id", agentID),
			attribute.String("pulse.reason", reason),
		),
	)
}

func finishPulseObservation(ctx context.Context, span trace.Span, startedAt time.Time, executionErr error) {
	telemetry := getRuntimeTelemetry()
	durationSec := time.Since(startedAt).Seconds()
	attrs := []attribute.KeyValue{
		attribute.Bool("pulse.failed", executionErr != nil),
	}

	if telemetry.pulseDuration != nil {
		telemetry.pulseDuration.Record(ctx, durationSec, metric.WithAttributes(attrs...))
	}
	if telemetry.pulseTotal != nil {
		telemetry.pulseTotal.Add(ctx, 1, metric.WithAttributes(attrs...))
	}
	if executionErr != nil {
		if telemetry.pulseFailed != nil {
			telemetry.pulseFailed.Add(ctx, 1, metric.WithAttributes(attrs...))
		}
		span.RecordError(executionErr)
		span.SetStatus(codes.Error, executionErr.Error())
	} else {
		span.SetStatus(codes.Ok, "pulse completed")
	}

	span.End()
}

func recordCacheDecision(ctx context.Context, decision string) {
	telemetry := getRuntimeTelemetry()
	if telemetry.cacheDecisions == nil {
		return
	}
	telemetry.cacheDecisions.Add(ctx, 1, metric.WithAttributes(
		attribute.String("cache.decision", decision),
	))
}

func startSubmissionSpan(ctx context.Context, req TaskSubmissionRequest) (context.Context, trace.Span) { //nolint:spancheck // The caller owns and ends the returned span.
	telemetry := getRuntimeTelemetry()
	//nolint:spancheck // The caller owns and ends the returned span.
	return telemetry.submissionTracer.Start(
		ctx,
		"engine.run.submit_task",
		trace.WithAttributes(
			attribute.Int("task.user_id", req.UserID),
			attribute.String("task.model_id", req.ModelID),
			attribute.String("task.source", req.Source),
			attribute.Bool("task.is_eval", req.IsEval),
			attribute.Bool("task.quick_mode", req.Options.QuickModeEnabled),
			attribute.Bool("task.has_project", req.Options.ProjectID != nil),
		),
	)
}

func recordQueueLatency(ctx context.Context, latency time.Duration) {
	telemetry := getRuntimeTelemetry()
	if telemetry.submissionQueueLatency == nil {
		return
	}
	telemetry.submissionQueueLatency.Record(ctx, latency.Seconds())
}

func finishSubmissionObservation(ctx context.Context, span trace.Span, startedAt time.Time, err error) {
	telemetry := getRuntimeTelemetry()
	durationSec := time.Since(startedAt).Seconds()
	code := "none"

	if err != nil {
		if submitErr, ok := errors.AsType[*TaskSubmissionError](err); ok {
			code = string(submitErr.Code)
		} else {
			code = string(TaskSubmissionInternal)
		}
	}

	attrs := []attribute.KeyValue{
		attribute.String("submission.error_code", code),
		attribute.Bool("submission.failed", err != nil),
	}

	if telemetry.submissionDuration != nil {
		telemetry.submissionDuration.Record(ctx, durationSec, metric.WithAttributes(attrs...))
	}
	if telemetry.submissionTotal != nil {
		telemetry.submissionTotal.Add(ctx, 1, metric.WithAttributes(attrs...))
	}
	if err != nil {
		if telemetry.submissionFailed != nil {
			telemetry.submissionFailed.Add(ctx, 1, metric.WithAttributes(attrs...))
		}
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
	} else {
		span.SetStatus(codes.Ok, "submission succeeded")
	}

	span.SetAttributes(attrs...)
	span.End()
}

func startGeneratedFileSpan(ctx context.Context, toolName, mimeType, artifactType string) (context.Context, trace.Span) {
	telemetry := getRuntimeTelemetry()
	//nolint:spancheck // The caller owns and ends the returned span.
	return telemetry.generatedFileTracer.Start(
		ctx,
		"engine.run.persist_generated_file",
		trace.WithAttributes(
			attribute.String("generated_file.tool", toolName),
			attribute.String("generated_file.mime_type", mimeType),
			attribute.String("generated_file.artifact_type", artifactType),
		),
	)
}

func finishGeneratedFileObservation(
	ctx context.Context,
	span trace.Span,
	startedAt time.Time,
	toolName string,
	mimeType string,
	artifactType string,
	bytes int64,
	outcome string,
	err error,
) {
	telemetry := getRuntimeTelemetry()
	attrs := []attribute.KeyValue{
		attribute.String("generated_file.tool", toolName),
		attribute.String("generated_file.mime_type", mimeType),
		attribute.String("generated_file.artifact_type", artifactType),
		attribute.String("generated_file.outcome", outcome),
	}

	if telemetry.generatedFileDuration != nil {
		telemetry.generatedFileDuration.Record(ctx, time.Since(startedAt).Seconds(), metric.WithAttributes(attrs...))
	}
	if telemetry.generatedFileTotal != nil {
		telemetry.generatedFileTotal.Add(ctx, 1, metric.WithAttributes(attrs...))
	}
	if bytes > 0 && telemetry.generatedFileBytes != nil {
		telemetry.generatedFileBytes.Record(ctx, bytes, metric.WithAttributes(attrs...))
	}
	if err != nil || outcome != "persisted" {
		if telemetry.generatedFileFailed != nil {
			telemetry.generatedFileFailed.Add(ctx, 1, metric.WithAttributes(attrs...))
		}
	}

	span.SetAttributes(attrs...)
	span.SetAttributes(attribute.Int64("generated_file.bytes", bytes))
	switch {
	case err != nil:
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
	case outcome != "persisted":
		span.SetStatus(codes.Error, outcome)
	default:
		span.SetStatus(codes.Ok, "generated file persisted")
	}
	span.End()
}
