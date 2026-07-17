package handler

import (
	"context"

	conversationspkg "github.com/TaskForceAI/core/pkg/conversations"
	enginehandler "github.com/TaskForceAI/go-engine/pkg/handler"
	integrationspkg "github.com/TaskForceAI/go-engine/pkg/integrations"
)

type conversationServiceLoader struct{}

var _ conversationspkg.Service = conversationServiceLoader{}

func (conversationServiceLoader) ListConversations(ctx context.Context, userID string, orgID *int, limit, offset int) (*conversationspkg.ConversationsPage, error) {
	svc, err := loadConversationService(ctx)
	if err != nil {
		return nil, err
	}
	return svc.ListConversations(ctx, userID, orgID, limit, offset)
}

func (conversationServiceLoader) GetConversation(ctx context.Context, userID string, orgID *int, conversationID int) (*conversationspkg.ConversationApiView, error) {
	svc, err := loadConversationService(ctx)
	if err != nil {
		return nil, err
	}
	return svc.GetConversation(ctx, userID, orgID, conversationID)
}

func (conversationServiceLoader) CreateConversation(ctx context.Context, input conversationspkg.ConversationCreateInput) (*conversationspkg.ConversationApiView, error) {
	svc, err := loadConversationService(ctx)
	if err != nil {
		return nil, err
	}
	return svc.CreateConversation(ctx, input)
}

func (conversationServiceLoader) UpdateConversation(ctx context.Context, userID string, orgID *int, conversationID int, input conversationspkg.ConversationUpdateInput) (bool, error) {
	svc, err := loadConversationService(ctx)
	if err != nil {
		return false, err
	}
	return svc.UpdateConversation(ctx, userID, orgID, conversationID, input)
}

func (conversationServiceLoader) DeleteConversation(ctx context.Context, userID string, orgID *int, conversationID int) (bool, error) {
	svc, err := loadConversationService(ctx)
	if err != nil {
		return false, err
	}
	return svc.DeleteConversation(ctx, userID, orgID, conversationID)
}

type integrationsServiceLoader struct{}

func (integrationsServiceLoader) ListIntegrations(ctx context.Context, userID int32) ([]integrationspkg.IntegrationStatus, error) {
	svc, err := loadIntegrationsService(ctx)
	if err != nil {
		return nil, err
	}
	return svc.ListIntegrations(ctx, userID)
}

func (integrationsServiceLoader) Disconnect(ctx context.Context, userID int32, provider string) error {
	svc, err := loadIntegrationsService(ctx)
	if err != nil {
		return err
	}
	return svc.Disconnect(ctx, userID, provider)
}

func loadConversationService(ctx context.Context) (conversationspkg.Service, error) {
	q, err := enginehandler.GetQueries(ctx)
	if err != nil {
		return nil, err
	}
	return enginehandler.NewConversationServiceFromQueries(q), nil
}

func loadIntegrationsService(ctx context.Context) (integrationspkg.Service, error) {
	q, err := enginehandler.GetQueries(ctx)
	if err != nil {
		return nil, err
	}
	return enginehandler.NewIntegrationsServiceFromQueries(q), nil
}
