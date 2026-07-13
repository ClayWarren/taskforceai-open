// Package status provides the public status API handler.
package status

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/TaskForceAI/core/pkg/platform"
)

// RegisterHandlers registers the status handlers with the provided Huma API.
func RegisterHandlers(api huma.API, svc *platform.StatusService) {
	huma.Register(api, huma.Operation{
		OperationID: "get-system-status",
		Method:      http.MethodGet,
		Path:        "/api/v1/status",
		Summary:     "Get system status",
		Tags:        []string{"Status"},
	}, func(ctx context.Context, input *struct{}) (*struct{ Body platform.StatusResponse }, error) {
		status, err := svc.GetServiceStatus(ctx)
		if err != nil {
			slog.Error("Failed to build system status", "error", err)
			return nil, huma.Error500InternalServerError("Failed to load system status")
		}
		return &struct{ Body platform.StatusResponse }{Body: status}, nil
	})
}
