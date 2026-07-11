package cron

import (
	"context"
	"crypto/subtle"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/danielgtaylor/huma/v2"

	"github.com/TaskForceAI/go-core/pkg/pulsebridge"
)

// RegisterPulseHandler registers the cron endpoint that fires heartbeats for
// all autonomous agents that are due. Called by Vercel Cron every 5 minutes.
func RegisterPulseHandler(api huma.API, bridgeProvider func() (*pulsebridge.Bridge, error)) {
	huma.Register(api, huma.Operation{
		OperationID: "cron-pulse",
		Method:      http.MethodGet,
		Path:        "/api/v1/cron/pulse",
		Summary:     "Trigger heartbeats for all agents due for a pulse",
		Tags:        []string{"Cron"},
	}, func(ctx context.Context, input *struct {
		Authorization string `header:"Authorization"`
	}) (*struct{}, error) {
		if !authorizedCronRequest(input.Authorization) {
			return nil, huma.Error401Unauthorized("unauthorized")
		}

		bridge, err := bridgeProvider()
		if err != nil {
			slog.Error("PulseBridge cron: bridge initialization failed", "error", err)
			return nil, huma.Error500InternalServerError("pulse bridge failed to initialize")
		}
		if bridge == nil {
			slog.Warn("PulseBridge cron: bridge not available")
			return &struct{}{}, nil
		}

		if err := bridge.CronTick(ctx); err != nil {
			slog.Error("PulseBridge cron tick failed", "error", err)
			return nil, huma.Error500InternalServerError("cron tick failed")
		}

		return &struct{}{}, nil
	})
}

func authorizedCronRequest(authorization string) bool {
	for _, secret := range []string{
		os.Getenv("CRON_SECRET"),
		os.Getenv("INTERNAL_API_TOKEN"),
	} {
		expected := "Bearer " + strings.TrimSpace(secret)
		if strings.TrimSpace(secret) == "" || len(authorization) != len(expected) {
			continue
		}
		if subtle.ConstantTimeCompare([]byte(authorization), []byte(expected)) == 1 {
			return true
		}
	}
	return false
}
