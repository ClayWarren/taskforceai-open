package handler

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/danielgtaylor/huma/v2"

	handlerutil "github.com/TaskForceAI/adapters/pkg/handler"
	contractspkg "github.com/TaskForceAI/contracts/pkg"
	corechat "github.com/TaskForceAI/core/pkg/chat"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/go-core/pkg/coreconfigsource"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

var (
	coreHealthMeter                = otel.Meter("core-service")
	coreHealthDependencyCounter, _ = coreHealthMeter.Int64Counter(
		"core.health.dependency.total",
		metric.WithDescription("Core dependency health checks by dependency and status"),
	)
	coreHealthDependencyLatency, _ = coreHealthMeter.Float64Histogram(
		"core.health.dependency.latency_ms",
		metric.WithDescription("Core dependency health check latency in milliseconds"),
		metric.WithUnit("ms"),
	)
	coreHealthOverallCounter, _ = coreHealthMeter.Int64Counter(
		"core.health.overall.total",
		metric.WithDescription("Core overall health checks by status"),
	)
)

// ServiceHealth represents the health status of a service.
type ServiceHealth struct {
	Status    string `json:"status" doc:"Service status (connected/error)"`
	Error     string `json:"error,omitempty" doc:"Error message if unhealthy"`
	LatencyMs *int64 `json:"latencyMs,omitempty" doc:"Latency in milliseconds"`
}

// HealthStatus represents the overall health status.
type HealthStatus struct {
	Status    string                    `json:"status" doc:"Overall system health (operational/degraded)"`
	Timestamp string                    `json:"timestamp" doc:"Current server time"`
	Version   string                    `json:"version" doc:"API version"`
	Services  map[string]*ServiceHealth `json:"services" doc:"Individual service health"`
}

// Fallback models when config.yaml cannot be loaded
var fallbackModels = contractspkg.ModelSelectorResponse{
	Enabled:        true,
	DefaultModelID: "zai/glm-5.2",
	Options: []contractspkg.ModelOptionSummary{
		{
			ID:            "zai/glm-5.2",
			Label:         "Sentinel",
			Badge:         "Default",
			Description:   new("Our flagship high-reasoning model, optimized for complex task planning."),
			UsageMultiple: new(1.0),
		},
		{
			ID:            "xai/grok-4.5",
			Label:         "Grok 4.5",
			Badge:         "Pro",
			Description:   new("xAI's latest heavy reasoning tier with extended planning depth."),
			UsageMultiple: new(1.5),
		},
		{
			ID:            "meta/muse-spark-1.1",
			Label:         "Muse Spark 1.1",
			Badge:         "Pro",
			Description:   new("Meta's agentic model for long-running tasks, tool use, and computer use."),
			UsageMultiple: new(1.0),
		},
		{
			ID:            "google/gemini-3.1-pro-preview",
			Label:         "Gemini 3.1 Pro",
			Badge:         "Research",
			Description:   new("Full-strength Gemini tier geared toward difficult research prompts."),
			UsageMultiple: new(2.0),
		},
		{
			ID:            "google/gemini-3.5-flash",
			Label:         "Gemini 3.5 Flash",
			Badge:         "Fast",
			Description:   new("Fast Gemini tier for everyday prompts, analysis, and tool-heavy workflows."),
			UsageMultiple: new(1.5),
		},
		{
			ID:            "google/gemini-3.1-flash-lite",
			Label:         "Gemini 3.1 Flash Lite",
			Badge:         "Fast",
			Description:   new("Lightweight Gemini tier optimized for low-latency, lower-cost tasks."),
			UsageMultiple: new(0.5),
		},
		{
			ID:            "google/gemini-2.5-flash-image",
			Label:         "Gemini Image",
			Badge:         "Available",
			Description:   new("Native image generation powered by Gemini 2.5 Flash."),
			UsageMultiple: new(1.0),
		},
		{
			ID:            "xai/grok-imagine-video-1.5",
			Label:         "Grok Imagine Video",
			Badge:         "Video",
			Description:   new("AI Gateway image-to-video generation with synced audio powered by Grok Imagine Video 1.5."),
			UsageMultiple: new(4.0),
		},
		{
			ID:            "openai/gpt-5.6-sol",
			Label:         "GPT 5.6 Sol",
			Badge:         "Research",
			Description:   new("OpenAI's flagship GPT-5.6 model for the most demanding reasoning tasks."),
			UsageMultiple: new(5.0),
		},
		{
			ID:            "openai/gpt-5.6-terra",
			Label:         "GPT 5.6 Terra",
			Badge:         "Pro",
			Description:   new("Balanced GPT-5.6 tier for strong everyday reasoning at lower cost."),
			UsageMultiple: new(2.5),
		},
		{
			ID:            "openai/gpt-5.6-luna",
			Label:         "GPT 5.6 Luna",
			Badge:         "Fast",
			Description:   new("Fast, cost-efficient GPT-5.6 tier for responsive everyday work."),
			UsageMultiple: new(1.0),
		},
		{
			ID:            "anthropic/claude-fable-5",
			Label:         "Claude Fable 5",
			Badge:         "Pro",
			Description:   new("Anthropic's balance of reasoning strength and latency for fallback coverage."),
			UsageMultiple: new(9.0),
		},
		{
			ID:            "anthropic/claude-sonnet-5",
			Label:         "Claude Sonnet 5",
			Badge:         "Pro",
			Description:   new("Anthropic Sonnet tier balanced for strong reasoning, coding, and responsiveness."),
			UsageMultiple: new(2.0),
		},
		{
			ID:            "anthropic/claude-opus-4.8",
			Label:         "Claude Opus 4.8",
			Badge:         "Research",
			Description:   new("Anthropic Opus tier for deeper reasoning and high-stakes synthesis."),
			UsageMultiple: new(4.5),
		},
		{
			ID:            "anthropic/claude-haiku-4.5",
			Label:         "Claude Haiku 4.5",
			Badge:         "Fast",
			Description:   new("Anthropic Haiku tier optimized for fast, lightweight assistant work."),
			UsageMultiple: new(1.0),
		},
	},
}

func normalizeBadges(options []contractspkg.ModelOptionSummary, defaultID string) {
	for i := range options {
		if options[i].ID == defaultID {
			options[i].Badge = "Default"
		} else {
			options[i].Badge = "Available"
		}
		if effort, ok := corechat.ReasoningEffortConfigForModel(options[i].ID); ok {
			options[i].ReasoningEffortLevels = effort.Levels
			defaultEffort := effort.Default
			options[i].DefaultReasoningEffort = &defaultEffort
		}
	}
}

func modelOptionSummaries(options []coreconfig.ModelOption) []contractspkg.ModelOptionSummary {
	summaries := make([]contractspkg.ModelOptionSummary, len(options))
	for i := range options {
		option := &options[i]
		summaries[i] = contractspkg.ModelOptionSummary{
			ID:            option.ID,
			Label:         option.Label,
			Description:   &option.Description,
			UsageMultiple: option.UsageMultiple,
		}
	}
	return summaries
}

// RegisterHandlers registers core API handlers.
func RegisterHandlers(api huma.API, checkDatabase func(context.Context) error) {
	// Health Check
	huma.Register(api, huma.Operation{
		OperationID: "get-health",
		Method:      http.MethodGet,
		Path:        "/api/v1/health",
		Summary:     "Service health check",
		Tags:        []string{"Core"},
	}, func(ctx context.Context, input *struct {
		handlerutil.OptionalAuthContext
		Deep bool `query:"deep"`
	}) (*struct{ Body HealthStatus }, error) {
		if !input.Deep {
			return &struct{ Body HealthStatus }{Body: HealthStatus{
				Status:    "operational",
				Timestamp: time.Now().UTC().Format(time.RFC3339),
				Version:   "1.0.0",
				Services:  map[string]*ServiceHealth{},
			}}, nil
		}
		if input.User == nil {
			return nil, huma.Error401Unauthorized("Authentication required for deep health checks")
		}
		services := make(map[string]*ServiceHealth)
		overallHealthy := true

		// DB Health
		start := time.Now()
		err := errors.New("database health check unavailable")
		if checkDatabase != nil {
			err = checkDatabase(ctx)
		}
		latency := time.Since(start).Milliseconds()
		dbHealth := &ServiceHealth{Status: "connected", LatencyMs: &latency}
		if err != nil {
			dbHealth.Status = "error"
			dbHealth.Error = "database health check failed"
			slog.Error("Database health check failed", "error", err)
			overallHealthy = false
		}
		services["database"] = dbHealth
		if coreHealthDependencyCounter != nil {
			coreHealthDependencyCounter.Add(ctx, 1, metric.WithAttributes(
				attribute.String("dependency", "database"),
				attribute.String("status", dbHealth.Status),
			))
		}
		if coreHealthDependencyLatency != nil && dbHealth.LatencyMs != nil {
			coreHealthDependencyLatency.Record(ctx, float64(*dbHealth.LatencyMs), metric.WithAttributes(
				attribute.String("dependency", "database"),
				attribute.String("status", dbHealth.Status),
			))
		}

		// Auth Health — check internally but don't expose config details
		authSecret := os.Getenv("AUTH_SECRET")
		authHealth := &ServiceHealth{Status: "connected"}
		if authSecret == "" || len(authSecret) < 32 {
			authHealth.Status = "error"
			authHealth.Error = "auth service configuration error"
			overallHealthy = false
			slog.Error("CRITICAL: AUTH_SECRET is missing or too short. App may be insecure.",
				"length", len(authSecret),
				"required_min", 32,
			)
		}
		services["auth"] = authHealth
		if coreHealthDependencyCounter != nil {
			coreHealthDependencyCounter.Add(ctx, 1, metric.WithAttributes(
				attribute.String("dependency", "auth"),
				attribute.String("status", authHealth.Status),
			))
		}

		status := "operational"
		if !overallHealthy {
			status = "degraded"
		}
		if coreHealthOverallCounter != nil {
			coreHealthOverallCounter.Add(ctx, 1, metric.WithAttributes(
				attribute.String("status", status),
			))
		}
		if authHealth.Status == "error" {
			return nil, huma.Error500InternalServerError("auth service configuration error")
		}

		return &struct{ Body HealthStatus }{Body: HealthStatus{
			Status:    status,
			Timestamp: time.Now().UTC().Format(time.RFC3339),
			Version:   "1.0.0",
			Services:  services,
		}}, nil
	})

	// Models List
	huma.Register(api, huma.Operation{
		OperationID: "get-models",
		Method:      http.MethodGet,
		Path:        "/api/v1/models",
		Summary:     "List available AI models",
		Tags:        []string{"Core"},
	}, func(ctx context.Context, input *struct{}) (*struct {
		Body contractspkg.ModelSelectorResponse
	}, error) {
		cfg, ok := loadModelSelectorConfig()
		if !ok {
			return fallbackModelsResponse(), nil
		}

		options := modelOptionSummaries(cfg.Models.Options)
		normalizeBadges(options, cfg.Models.Default)

		return &struct {
			Body contractspkg.ModelSelectorResponse
		}{Body: contractspkg.ModelSelectorResponse{
			Enabled:        true,
			DefaultModelID: cfg.Models.Default,
			Options:        options,
		}}, nil
	})
}

func loadModelSelectorConfig() (coreconfig.Config, bool) {
	coreconfigsource.Install()
	cfg, err := coreconfig.LoadConfig("")
	if err != nil || len(cfg.Models.Options) == 0 {
		return coreconfig.Config{}, false
	}
	return cfg, true
}

func fallbackModelsResponse() *struct {
	Body contractspkg.ModelSelectorResponse
} {
	resp := fallbackModels
	resp.Options = append([]contractspkg.ModelOptionSummary(nil), fallbackModels.Options...)
	normalizeBadges(resp.Options, resp.DefaultModelID)
	return &struct {
		Body contractspkg.ModelSelectorResponse
	}{Body: resp}
}
