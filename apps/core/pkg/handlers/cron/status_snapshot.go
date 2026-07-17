package cron

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/TaskForceAI/core/pkg/platform"
)

// RegisterStatusSnapshotHandler refreshes the independently hosted public
// status snapshot. Vercel Cron invokes it every minute.
func RegisterStatusSnapshotHandler(api huma.API, service *platform.StatusService) {
	huma.Register(api, huma.Operation{
		OperationID: "cron-status-snapshot",
		Method:      http.MethodGet,
		Path:        "/api/v1/cron/status-snapshot",
		Summary:     "Refresh the public status snapshot",
		Tags:        []string{"Cron"},
	}, func(ctx context.Context, input *struct {
		Authorization string `header:"Authorization"`
	}) (*struct{}, error) {
		if !authorizedCronRequest(input.Authorization) {
			return nil, huma.Error401Unauthorized("unauthorized")
		}
		if service == nil {
			return nil, huma.Error503ServiceUnavailable("status service unavailable")
		}
		if err := service.Publish(ctx); err != nil {
			slog.Error("Status snapshot cron publish failed", "error", err)
			return nil, huma.Error500InternalServerError("status snapshot publish failed")
		}
		return &struct{}{}, nil
	})
}
