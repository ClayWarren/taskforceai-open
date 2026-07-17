package conversations

import (
	"context"
	"errors"
	"testing"

	conversationspkg "github.com/TaskForceAI/core/pkg/conversations"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
)

func TestConversationTelemetryAdapterRecordsAndSpans(t *testing.T) {
	adapter := NewTelemetry()
	ctx := context.Background()

	ctx, span := adapter.StartSpan(
		ctx,
		"conversation.test",
		conversationspkg.StringAttribute("user_id", "user-1"),
		conversationspkg.IntAttribute("message_count", 2),
	)
	require.NotNil(t, ctx)
	require.NotNil(t, span)
	span.Finish(nil)

	_, errorSpan := adapter.StartSpan(ctx, "conversation.error")
	errorSpan.Finish(errors.New("span failed"))

	adapter.RecordConversationCreated(ctx, "user-1")
	adapter.RecordConversationUpdated(ctx, "user-1")
	adapter.RecordConversationRetrieved(ctx, "user-1")
	adapter.RecordMessage(ctx, "user-1")
}

func TestMapConversationSpanAttributes(t *testing.T) {
	attrs := mapConversationSpanAttributes([]conversationspkg.ConversationSpanAttribute{
		conversationspkg.StringAttribute("user_id", "user-1"),
		conversationspkg.IntAttribute("message_count", 2),
		{Key: "ignored", Kind: "unknown"},
	})

	assert.Equal(t, []attribute.KeyValue{
		attribute.String("user_id", "user-1"),
		attribute.Int("message_count", 2),
	}, attrs)
}
