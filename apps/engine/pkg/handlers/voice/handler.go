// Package voice exposes authoritative reservation controls for paid voice operations.
package voice

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/TaskForceAI/adapters/pkg/handler"
	coreusage "github.com/TaskForceAI/core/pkg/usage"
	"github.com/TaskForceAI/infrastructure/ratelimit/pkg"
)

const limiterTimeout = 750 * time.Millisecond

// LimiterProvider resolves the shared limiter used for authoritative reservations.
type LimiterProvider func() (ratelimit.Limiter, error)

// UsageWriter persists completed voice operations without coupling policy to storage.
type UsageWriter func(context.Context, coreusage.EventRow) error

type reserveVoiceRequest struct {
	Operation coreusage.VoiceOperation `json:"operation" enum:"realtime-setup,speech,dictation" doc:"Voice operation to reserve"`
}

type completeVoiceRequest struct {
	Operation coreusage.VoiceOperation `json:"operation" enum:"realtime-setup,speech,dictation"`
	Model     string                   `json:"model" minLength:"1"`
	Quantity  float64                  `json:"quantity" minimum:"0"`
	Unit      string                   `json:"unit" minLength:"1"`
}

type reservation struct {
	Allowed           bool  `json:"allowed"`
	Limit             int   `json:"limit"`
	Remaining         int   `json:"remaining"`
	ResetAt           int64 `json:"resetAt"`
	RetryAfterSeconds int   `json:"retryAfterSeconds"`
}

// RegisterHandlers registers the voice reservation endpoint.
func RegisterHandlers(api huma.API, limiterProvider LimiterProvider, usageWriters ...UsageWriter) {
	var usageWriter UsageWriter
	if len(usageWriters) > 0 {
		usageWriter = usageWriters[0]
	}
	huma.Register(api, huma.Operation{
		OperationID: "reserve-voice-operation",
		Method:      http.MethodPost,
		Path:        "/api/v1/voice/reserve",
		Summary:     "Reserve capacity for a paid voice operation",
		Tags:        []string{"Voice"},
	}, func(ctx context.Context, input *struct {
		handler.SessionAuthContext
		Body reserveVoiceRequest
	}) (*struct{ Body reservation }, error) {
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}
		reserved, err := reserveVoiceOperation(ctx, ids.UserID, input.Body.Operation, limiterProvider)
		if err != nil {
			return nil, err
		}
		return &struct{ Body reservation }{Body: reserved}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "complete-voice-operation",
		Method:      http.MethodPost,
		Path:        "/api/v1/voice/complete",
		Summary:     "Record a completed paid voice operation",
		Tags:        []string{"Voice"},
	}, func(ctx context.Context, input *struct {
		handler.SessionAuthContext
		Body completeVoiceRequest
	}) (*struct {
		Body struct {
			Recorded bool `json:"recorded"`
		}
	}, error) {
		if usageWriter == nil {
			return nil, huma.Error503ServiceUnavailable("Voice usage recorder unavailable")
		}
		userID := strconv.Itoa(input.User.ID)
		plan := "free"
		if input.User.Plan != nil {
			plan = strings.TrimSpace(*input.User.Plan)
		}
		model := strings.TrimSpace(input.Body.Model)
		metadata, _ := json.Marshal(map[string]string{"unit": input.Body.Unit})
		costMicros := voiceCostMicros(input.Body.Operation, input.Body.Quantity)
		if err := usageWriter(ctx, coreusage.EventRow{
			UserID: &userID, Plan: &plan, Source: "voice", Modality: "voice",
			Operation: string(input.Body.Operation), Model: &model,
			Quantity: input.Body.Quantity, Unit: input.Body.Unit, CostMicros: costMicros,
			Metadata: metadata,
		}); err != nil {
			slog.Error("[VoiceHandler] Failed to record completed voice usage", "userId", input.User.ID, "operation", input.Body.Operation, "error", err)
			return nil, huma.Error503ServiceUnavailable("Voice usage recorder unavailable")
		}
		response := &struct {
			Body struct {
				Recorded bool `json:"recorded"`
			}
		}{}
		response.Body.Recorded = true
		return response, nil
	})
}

func voiceCostMicros(operation coreusage.VoiceOperation, quantity float64) int64 {
	switch operation {
	case coreusage.VoiceOperationSpeech:
		return int64(math.Round(quantity * 15)) // $15 per 1M input characters.
	case coreusage.VoiceOperationDictation:
		return int64(math.Round(quantity * 28)) // $0.000028 per audio second.
	case coreusage.VoiceOperationRealtimeSetup:
		return 0 // Realtime provider usage is not returned by token setup.
	default:
		return 0
	}
}

func reserveVoiceOperation(ctx context.Context, userID int, operation coreusage.VoiceOperation, limiterProvider LimiterProvider) (reservation, error) {
	policy, ok := coreusage.VoiceRateLimit(operation)
	if !ok {
		return reservation{}, huma.Error422UnprocessableEntity("Unsupported voice operation")
	}
	if limiterProvider == nil {
		return reservation{}, voiceLimiterUnavailable(errors.New("limiter provider is nil"))
	}

	limiter, err := limiterProvider()
	if err != nil || limiter == nil {
		if err == nil {
			err = errors.New("limiter is nil")
		}
		return reservation{}, voiceLimiterUnavailable(err)
	}

	limitCtx, cancel := context.WithTimeout(ctx, limiterTimeout)
	defer cancel()
	key := string(operation) + ":" + strconv.Itoa(userID)
	result, err := limiter.Check(limitCtx, key, policy.Limit, policy.Window)
	if err != nil || result == nil {
		if err == nil {
			err = errors.New("limiter result is nil")
		}
		return reservation{}, voiceLimiterUnavailable(err)
	}

	retryAfterSeconds := 0
	if !result.Allowed {
		retryAfterSeconds = max(1, int(math.Ceil(time.Until(result.ResetTime).Seconds())))
	}

	return reservation{
		Allowed:           result.Allowed,
		Limit:             policy.Limit,
		Remaining:         result.Remaining,
		ResetAt:           result.ResetTime.UnixMilli(),
		RetryAfterSeconds: retryAfterSeconds,
	}, nil
}

func voiceLimiterUnavailable(err error) error {
	slog.Error("[VoiceHandler] Authoritative voice limiter unavailable", "error", err)
	return huma.Error503ServiceUnavailable("Voice rate limiter unavailable")
}
