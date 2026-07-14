package conversations

import (
	"context"
	"sync"

	"github.com/TaskForceAI/adapters/pkg/observability"
	conversationspkg "github.com/TaskForceAI/core/pkg/conversations"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
)

// Telemetry adapts OpenTelemetry instruments to the core conversation port.
type Telemetry struct {
	once          sync.Once
	tracer        trace.Tracer
	convCreated   metric.Int64Counter
	convUpdated   metric.Int64Counter
	convRetrieved metric.Int64Counter
	msgCount      metric.Int64Counter
}

// NewTelemetry constructs a lazily initialized conversation telemetry adapter.
func NewTelemetry() *Telemetry {
	return &Telemetry{}
}

func (t *Telemetry) init() {
	t.once.Do(func() {
		meter := otel.Meter("core-conversations")
		t.tracer = otel.Tracer("core-conversations.logic")
		t.convCreated, _ = meter.Int64Counter(
			"core.conversations.created",
			metric.WithDescription("Total number of conversations created"),
		)
		t.convUpdated, _ = meter.Int64Counter(
			"core.conversations.updated",
			metric.WithDescription("Total number of conversation updates"),
		)
		t.convRetrieved, _ = meter.Int64Counter(
			"core.conversations.retrieved",
			metric.WithDescription("Total number of conversation retrievals"),
		)
		t.msgCount, _ = meter.Int64Counter(
			"core.messages.count",
			metric.WithDescription("Total number of messages processed"),
		)
	})
}

func (t *Telemetry) StartSpan(ctx context.Context, name string, attrs ...conversationspkg.ConversationSpanAttribute) (context.Context, conversationspkg.ConversationSpan) {
	t.init()
	ctx, span := t.tracer.Start(ctx, name, trace.WithAttributes(mapConversationSpanAttributes(attrs)...))
	return ctx, conversationSpanAdapter{span: span}
}

func (t *Telemetry) RecordConversationCreated(ctx context.Context, userID string) {
	t.init()
	t.convCreated.Add(ctx, 1, metric.WithAttributes(attribute.String("user_id", userID)))
}

func (t *Telemetry) RecordConversationUpdated(ctx context.Context, userID string) {
	t.init()
	t.convUpdated.Add(ctx, 1, metric.WithAttributes(attribute.String("user_id", userID)))
}

func (t *Telemetry) RecordConversationRetrieved(ctx context.Context, userID string) {
	t.init()
	t.convRetrieved.Add(ctx, 1, metric.WithAttributes(attribute.String("user_id", userID)))
}

func (t *Telemetry) RecordMessage(ctx context.Context, userID string) {
	t.init()
	t.msgCount.Add(ctx, 1, metric.WithAttributes(attribute.String("user_id", userID)))
}

type conversationSpanAdapter struct {
	span trace.Span
}

func (s conversationSpanAdapter) Finish(err error) {
	observability.FinishSpan(s.span, err)
}

func mapConversationSpanAttributes(attrs []conversationspkg.ConversationSpanAttribute) []attribute.KeyValue {
	out := make([]attribute.KeyValue, 0, len(attrs))
	for _, attr := range attrs {
		switch attr.Kind {
		case conversationspkg.ConversationSpanAttributeString:
			out = append(out, attribute.String(attr.Key, attr.StringValue))
		case conversationspkg.ConversationSpanAttributeInt:
			out = append(out, attribute.Int(attr.Key, attr.IntValue))
		}
	}
	return out
}
