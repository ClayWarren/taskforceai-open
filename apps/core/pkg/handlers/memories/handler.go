package memories

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/core/pkg/memories"
	"github.com/jinzhu/copier"
)

var copyMemoryValue = copier.Copy

// RegisterHandlers registers the memories handlers with the provided Huma API.
func RegisterHandlers(api huma.API, service memories.Service) {
	huma.Register(api, huma.Operation{
		OperationID: "list-memories",
		Method:      http.MethodGet,
		Path:        "/api/v1/memories",
		Summary:     "List memories",
		Tags:        []string{"Memories"},
	}, func(ctx context.Context, input *struct {
		handler.AuthContext
	}) (*struct{ Body []MemoryResponse }, error) {
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		mems, err := service.GetUserMemories(ctx, ids.UserID32, ids.OrgID32)
		if err != nil {
			slog.Error("Failed to fetch memories", "userId", ids.UserID32, "orgId", ids.OrgID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to fetch memories")
		}

		var resp []MemoryResponse
		if err := copyMemoryValue(&resp, &mems); err != nil {
			slog.Error("Failed to map memories to response", "userId", ids.UserID32, "error", err)
			return nil, huma.Error500InternalServerError("Mapping error")
		}
		return &struct{ Body []MemoryResponse }{Body: resp}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "create-memory",
		Method:      http.MethodPost,
		Path:        "/api/v1/memories",
		Summary:     "Create memory",
		Tags:        []string{"Memories"},
	}, func(ctx context.Context, input *struct {
		Body CreateMemoryRequest
		handler.AuthContext
	}) (*struct{}, error) {
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		if err := service.SaveMemory(ctx, ids.UserID32, ids.OrgID32, input.Body.Content, input.Body.Type); err != nil {
			slog.Warn("Rejected memory", "userId", ids.UserID32, "orgId", ids.OrgID, "error", err)
			return nil, huma.Error400BadRequest("Invalid memory")
		}

		return &struct{}{}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "update-memory",
		Method:      http.MethodPatch,
		Path:        "/api/v1/memories/{id}",
		Summary:     "Update memory",
		Tags:        []string{"Memories"},
	}, func(ctx context.Context, input *struct {
		ID   int32 `path:"id" doc:"Memory ID"`
		Body UpdateMemoryRequest
		handler.AuthContext
	}) (*struct{ Body MemoryResponse }, error) {
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		memory, err := service.UpdateMemory(ctx, memories.UpdateMemoryInput{
			ID:             input.ID,
			UserID:         ids.UserID32,
			OrganizationID: ids.OrgID32,
			Content:        input.Body.Content,
			Type:           input.Body.Type,
		})
		if err != nil {
			slog.Error("Failed to update memory", "memoryId", input.ID, "userId", ids.UserID32, "orgId", ids.OrgID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to update memory")
		}

		var resp MemoryResponse
		if err := copyMemoryValue(&resp, &memory); err != nil {
			slog.Error("Failed to map memory to response", "memoryId", input.ID, "userId", ids.UserID32, "error", err)
			return nil, huma.Error500InternalServerError("Mapping error")
		}
		return &struct{ Body MemoryResponse }{Body: resp}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "delete-memory",
		Method:      http.MethodDelete,
		Path:        "/api/v1/memories/{id}",
		Summary:     "Delete memory",
		Tags:        []string{"Memories"},
	}, func(ctx context.Context, input *struct {
		ID int32 `path:"id" doc:"Memory ID"`
		handler.AuthContext
	}) (*struct{}, error) {
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		if err := service.DeleteMemory(ctx, input.ID, ids.UserID32, ids.OrgID32); err != nil {
			slog.Error("Failed to delete memory", "memoryId", input.ID, "userId", ids.UserID32, "orgId", ids.OrgID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to delete memory")
		}

		return &struct{}{}, nil
	})
}
