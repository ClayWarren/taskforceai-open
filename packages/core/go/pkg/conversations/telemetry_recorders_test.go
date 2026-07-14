package conversations

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type conversationTelemetryStub struct {
	spanName string
	attrs    []ConversationSpanAttribute
	created  int
	updated  int
	read     int
	messages int
	err      error
}

func (s *conversationTelemetryStub) StartSpan(ctx context.Context, name string, attrs ...ConversationSpanAttribute) (context.Context, ConversationSpan) {
	s.spanName = name
	s.attrs = attrs
	return ctx, conversationSpanStub{telemetry: s}
}

func (s *conversationTelemetryStub) RecordConversationCreated(context.Context, string) {
	s.created++
}

func (s *conversationTelemetryStub) RecordConversationUpdated(context.Context, string) {
	s.updated++
}

func (s *conversationTelemetryStub) RecordConversationRetrieved(context.Context, string) {
	s.read++
}

func (s *conversationTelemetryStub) RecordMessage(context.Context, string) {
	s.messages++
}

type conversationSpanStub struct {
	telemetry *conversationTelemetryStub
}

func (s conversationSpanStub) Finish(err error) {
	s.telemetry.err = err
}

func TestConversationTelemetryRecorders(t *testing.T) {
	ctx := context.Background()
	stub := &conversationTelemetryStub{}
	restore := SetConversationTelemetry(stub)
	t.Cleanup(restore)

	RecordConversationCreated(ctx, "user")
	RecordConversationUpdated(ctx, "user")
	RecordConversationRetrieved(ctx, "user")
	RecordMessage(ctx, "user")

	_, span := startSpan(ctx, "test.span", StringAttribute("user_id", "user"), IntAttribute("conversation_id", 1))
	expected := errors.New("boom")
	span.Finish(expected)

	assert.Equal(t, 1, stub.created)
	assert.Equal(t, 1, stub.updated)
	assert.Equal(t, 1, stub.read)
	assert.Equal(t, 1, stub.messages)
	assert.Equal(t, "test.span", stub.spanName)
	require.Len(t, stub.attrs, 2)
	assert.Equal(t, ConversationSpanAttributeString, stub.attrs[0].Kind)
	assert.Equal(t, ConversationSpanAttributeInt, stub.attrs[1].Kind)
	assert.ErrorIs(t, stub.err, expected)
}

func TestConversationTelemetryNilInstallsNoop(t *testing.T) {
	ctx := context.Background()
	restore := SetConversationTelemetry(nil)
	t.Cleanup(restore)

	RecordConversationCreated(ctx, "user")
	RecordConversationUpdated(ctx, "user")
	RecordConversationRetrieved(ctx, "user")
	RecordMessage(ctx, "user")

	nextCtx, span := startSpan(ctx, "noop")
	assert.Equal(t, ctx, nextCtx)
	span.Finish(errors.New("ignored"))
}
