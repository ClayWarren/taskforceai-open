package conversations

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/core/pkg/conversations"
	"github.com/jinzhu/copier"
)

var copyConversationValue = copier.Copy

// RegisterHandlers registers the conversations handlers with the provided Huma API.
func RegisterHandlers(api huma.API, service conversations.Service) {
	// List Conversations
	huma.Register(api, huma.Operation{
		OperationID: "list-conversations",
		Method:      http.MethodGet,
		Path:        "/api/v1/conversations",
		Summary:     "List conversations",
		Tags:        []string{"Conversations"},
	}, func(ctx context.Context, input *struct {
		Limit  int `query:"limit" default:"50" minimum:"1" maximum:"100" doc:"Number of items per page"`
		Offset int `query:"offset" default:"0" minimum:"0" doc:"Pagination offset"`
		handler.AuthContext
	}) (*struct{ Body ConversationsListResponse }, error) {
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		page, err := service.ListConversations(ctx, ids.UserIDString, ids.OrgIDInt, input.Limit, input.Offset)
		if err != nil {
			slog.Error("Failed to list conversations", "userId", ids.UserID, "orgId", ids.OrgID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to fetch conversations")
		}

		var convResponses []ConversationResponse
		if err := copyConversationValue(&convResponses, &page.Conversations); err != nil {
			slog.Error("Failed to map conversations to response", "userId", ids.UserID, "error", err)
			return nil, huma.Error500InternalServerError("Mapping error")
		}

		return &struct{ Body ConversationsListResponse }{Body: ConversationsListResponse{
			Conversations: convResponses,
			Total:         page.Total,
			Limit:         page.Limit,
			Offset:        page.Offset,
			HasMore:       page.HasMore,
		}}, nil
	})

	// Create Conversation
	huma.Register(api, huma.Operation{
		OperationID: "create-conversation",
		Method:      http.MethodPost,
		Path:        "/api/v1/conversations",
		Summary:     "Create conversation",
		Tags:        []string{"Conversations"},
	}, func(ctx context.Context, input *struct {
		Body CreateConversationRequest
		handler.AuthContext
	}) (*struct{ Body map[string]any }, error) {
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		agentCount := 4
		if input.Body.AgentCount != nil && *input.Body.AgentCount > 0 {
			agentCount = *input.Body.AgentCount
		}
		if agentCount > 50 {
			agentCount = 50
		}

		srvInput := conversations.ConversationCreateInput{
			UserID:         ids.UserIDString,
			OrganizationID: ids.OrgIDInt,
			UserInput:      input.Body.Title,
			Result:         input.Body.Result,
			Model:          input.Body.Model,
			AgentCount:     agentCount,
		}
		if input.Body.ExecutionTime != nil {
			srvInput.ExecutionTime = input.Body.ExecutionTime
		}

		conv, err := service.CreateConversation(ctx, srvInput)
		if err != nil {
			slog.Error("Failed to create conversation", "userId", ids.UserID, "orgId", ids.OrgID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to create conversation")
		}

		conversations.RecordConversationCreated(ctx, ids.UserIDString)

		return &struct{ Body map[string]any }{Body: map[string]any{
			"conversation": conv,
			"id":           conv.ID,
			"timestamp":    conv.Timestamp,
			"user_input":   conv.UserInput,
			"result":       conv.Result,
			"model":        conv.Model,
			"agent_count":  conv.AgentCount,
		}}, nil
	})

	// Get Conversation (ID)
	huma.Register(api, huma.Operation{
		OperationID: "get-conversation",
		Method:      http.MethodGet,
		Path:        "/api/v1/conversations/{id}",
		Summary:     "Get conversation",
		Tags:        []string{"Conversations"},
	}, func(ctx context.Context, input *struct {
		ID int `path:"id" doc:"Conversation ID"`
		handler.AuthContext
	}) (*struct{ Body ConversationResponse }, error) {
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		conv, err := service.GetConversation(ctx, ids.UserIDString, ids.OrgIDInt, input.ID)
		if err != nil {
			if errors.Is(err, conversations.ErrConversationNotFound) {
				return nil, huma.Error404NotFound("Conversation not found")
			}
			slog.Error("Failed to fetch conversation", "conversationId", input.ID, "userId", ids.UserID, "orgId", ids.OrgID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to fetch conversation")
		}

		conversations.RecordConversationRetrieved(ctx, ids.UserIDString)

		var resp ConversationResponse
		if err := copyConversationValue(&resp, conv); err != nil {
			slog.Error("Failed to map conversation to response", "conversationId", input.ID, "userId", ids.UserID, "error", err)
			return nil, huma.Error500InternalServerError("Mapping error")
		}

		return &struct{ Body ConversationResponse }{Body: resp}, nil
	})

	// Update Conversation
	huma.Register(api, huma.Operation{
		OperationID: "update-conversation",
		Method:      http.MethodPut,
		Path:        "/api/v1/conversations/{id}",
		Summary:     "Update conversation",
		Tags:        []string{"Conversations"},
	}, func(ctx context.Context, input *struct {
		ID   int `path:"id" doc:"Conversation ID"`
		Body UpdateConversationRequest
		handler.AuthContext
	}) (*struct{ Body map[string]any }, error) {
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		var srvInput conversations.ConversationUpdateInput
		if err := copyConversationValue(&srvInput, &input.Body); err != nil {
			slog.Error("Failed to map conversation update input", "conversationId", input.ID, "userId", ids.UserID, "error", err)
			return nil, huma.Error500InternalServerError("Mapping error")
		}

		success, err := service.UpdateConversation(ctx, ids.UserIDString, ids.OrgIDInt, input.ID, srvInput)
		if err != nil {
			slog.Error("Failed to update conversation", "conversationId", input.ID, "userId", ids.UserID, "orgId", ids.OrgID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to update conversation")
		}

		conversations.RecordConversationUpdated(ctx, ids.UserIDString)

		return &struct{ Body map[string]any }{Body: map[string]any{"success": success}}, nil
	})

	// Delete Conversation
	huma.Register(api, huma.Operation{
		OperationID: "delete-conversation",
		Method:      http.MethodDelete,
		Path:        "/api/v1/conversations/{id}",
		Summary:     "Delete conversation",
		Tags:        []string{"Conversations"},
	}, func(ctx context.Context, input *struct {
		ID int `path:"id" doc:"Conversation ID"`
		handler.AuthContext
	}) (*struct{}, error) {
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		deleted, err := service.DeleteConversation(ctx, ids.UserIDString, ids.OrgIDInt, input.ID)
		if err != nil {
			slog.Error("Failed to delete conversation", "conversationId", input.ID, "userId", ids.UserID, "orgId", ids.OrgID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to delete conversation")
		}
		if !deleted {
			return nil, huma.Error404NotFound("Conversation not found")
		}

		return &struct{}{}, nil
	})
}
