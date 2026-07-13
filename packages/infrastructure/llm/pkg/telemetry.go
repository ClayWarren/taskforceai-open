package pkg

import (
	"context"

	"github.com/TaskForceAI/core/pkg/agent"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

var tracer = otel.Tracer("infrastructure-llm")

func startModelSpan(ctx context.Context, name, system, model string) (context.Context, trace.Span) {
	return tracer.Start(ctx, name, trace.WithAttributes(
		attribute.String("gen_ai.system", system),
		attribute.String("gen_ai.request.model", model),
	))
}

func recordSpanError(span trace.Span, err error) {
	if err == nil {
		return
	}
	span.RecordError(err)
	span.SetStatus(codes.Error, err.Error())
}

func setSpanError(span trace.Span, message string) {
	span.SetStatus(codes.Error, message)
}

func setCompletionUsageAttributes(span trace.Span, usage agent.ChatCompletionUsage) {
	span.SetAttributes(
		attribute.Int64("gen_ai.usage.prompt_tokens", usage.PromptTokens),
		attribute.Int64("gen_ai.usage.completion_tokens", usage.CompletionTokens),
		attribute.Int64("gen_ai.usage.total_tokens", usage.TotalTokens),
	)
}
