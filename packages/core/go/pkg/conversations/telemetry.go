package conversations

import (
	"context"

	"github.com/TaskForceAI/core/internal/runtimevalue"
)

type ConversationSpanAttributeKind string

const (
	ConversationSpanAttributeString ConversationSpanAttributeKind = "string"
	ConversationSpanAttributeInt    ConversationSpanAttributeKind = "int"
)

type ConversationSpanAttribute struct {
	Key         string
	StringValue string
	IntValue    int
	Kind        ConversationSpanAttributeKind
}

func StringAttribute(key, value string) ConversationSpanAttribute {
	return ConversationSpanAttribute{Key: key, StringValue: value, Kind: ConversationSpanAttributeString}
}

func IntAttribute(key string, value int) ConversationSpanAttribute {
	return ConversationSpanAttribute{Key: key, IntValue: value, Kind: ConversationSpanAttributeInt}
}

type ConversationSpan interface {
	Finish(err error)
}

type ConversationTelemetry interface {
	StartSpan(ctx context.Context, name string, attrs ...ConversationSpanAttribute) (context.Context, ConversationSpan)
	RecordConversationCreated(ctx context.Context, userID string)
	RecordConversationUpdated(ctx context.Context, userID string)
	RecordConversationRetrieved(ctx context.Context, userID string)
	RecordMessage(ctx context.Context, userID string)
}

var conversationTelemetry = runtimevalue.New[ConversationTelemetry](noopConversationTelemetry{})

func SetConversationTelemetry(telemetry ConversationTelemetry) func() {
	return conversationTelemetry.Set(telemetry)
}

func getTelemetry() ConversationTelemetry {
	return conversationTelemetry.Current()
}

func startSpan(ctx context.Context, name string, attrs ...ConversationSpanAttribute) (context.Context, ConversationSpan) {
	return getTelemetry().StartSpan(ctx, name, attrs...)
}

func RecordConversationCreated(ctx context.Context, userID string) {
	getTelemetry().RecordConversationCreated(ctx, userID)
}

func RecordConversationUpdated(ctx context.Context, userID string) {
	getTelemetry().RecordConversationUpdated(ctx, userID)
}

func RecordConversationRetrieved(ctx context.Context, userID string) {
	getTelemetry().RecordConversationRetrieved(ctx, userID)
}

func RecordMessage(ctx context.Context, userID string) {
	getTelemetry().RecordMessage(ctx, userID)
}

type noopConversationTelemetry struct{}

func (noopConversationTelemetry) StartSpan(ctx context.Context, _ string, _ ...ConversationSpanAttribute) (context.Context, ConversationSpan) {
	return ctx, noopConversationSpan{}
}

func (noopConversationTelemetry) RecordConversationCreated(ctx context.Context, userID string) {
	_ = ctx
	_ = userID
}

func (noopConversationTelemetry) RecordConversationUpdated(ctx context.Context, userID string) {
	_ = ctx
	_ = userID
}

func (noopConversationTelemetry) RecordConversationRetrieved(ctx context.Context, userID string) {
	_ = ctx
	_ = userID
}

func (noopConversationTelemetry) RecordMessage(ctx context.Context, userID string) {
	_ = ctx
	_ = userID
}

type noopConversationSpan struct{}

func (noopConversationSpan) Finish(err error) {
	_ = err
}
