package integrations

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/go-engine/pkg/integrations"
)

// RegisterHandlers registers the integrations handlers with the provided Huma API.
func RegisterHandlers(api huma.API, service integrations.Service) {
	huma.Register(api, huma.Operation{
		OperationID: "list-integrations",
		Method:      http.MethodGet,
		Path:        "/api/v1/integrations",
		Summary:     "List integrations",
		Tags:        []string{"Integrations"},
	}, func(ctx context.Context, input *struct {
		handler.AuthContext
	}) (*struct {
		Body []integrations.IntegrationStatus
	}, error) {
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		stats, err := service.ListIntegrations(ctx, ids.UserID32)
		if err != nil {
			return nil, huma.Error500InternalServerError("Failed to fetch integrations")
		}
		return &struct {
			Body []integrations.IntegrationStatus
		}{Body: stats}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "disconnect-integration",
		Method:      http.MethodDelete,
		Path:        "/api/v1/integrations/{id}",
		Summary:     "Disconnect integration",
		Tags:        []string{"Integrations"},
	}, func(ctx context.Context, input *struct {
		ID string `path:"id" doc:"Provider ID"`
		handler.AuthContext
	}) (*struct{}, error) {
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		if err := service.Disconnect(ctx, ids.UserID32, input.ID); err != nil {
			return nil, huma.Error500InternalServerError("Failed to disconnect")
		}
		return &struct{}{}, nil
	})
}
