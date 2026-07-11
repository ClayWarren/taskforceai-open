// Package voice exposes authoritative reservation controls for paid voice operations.
package voice

import (
	"context"
	"errors"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/TaskForceAI/adapters/pkg/handler"
	coreusage "github.com/TaskForceAI/core/pkg/usage"
	"github.com/TaskForceAI/infrastructure/ratelimit/pkg"
)

const limiterTimeout = 750 * time.Millisecond

// LimiterProvider resolves the shared limiter used for authoritative reservations.
type LimiterProvider func() (ratelimit.Limiter, error)

type reserveVoiceRequest struct {
	Operation coreusage.VoiceOperation `json:"operation" enum:"realtime-setup,speech,dictation" doc:"Voice operation to reserve"`
}

type reservation struct {
	Allowed           bool  `json:"allowed"`
	Limit             int   `json:"limit"`
	Remaining         int   `json:"remaining"`
	ResetAt           int64 `json:"resetAt"`
	RetryAfterSeconds int   `json:"retryAfterSeconds"`
}

// RegisterHandlers registers the voice reservation endpoint.
func RegisterHandlers(api huma.API, limiterProvider LimiterProvider) {
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
