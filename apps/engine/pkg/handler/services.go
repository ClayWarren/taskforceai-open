package handler

import (
	conversationadapters "github.com/TaskForceAI/adapters/pkg/conversations"
	"github.com/TaskForceAI/adapters/pkg/db"
	conversationspkg "github.com/TaskForceAI/core/pkg/conversations"
	integrationspkg "github.com/TaskForceAI/go-engine/pkg/integrations"
)

func NewConversationServiceFromQueries(q *db.Queries) conversationspkg.Service {
	conversationspkg.SetConversationTelemetry(conversationadapters.NewTelemetry())
	return conversationspkg.NewConversationService(
		conversationspkg.NewConversationRepository(conversationadapters.NewStore(q)),
	)
}

func NewIntegrationsServiceFromQueries(q *db.Queries) integrationspkg.Service {
	return integrationspkg.NewService(integrationspkg.NewRepository(q))
}
