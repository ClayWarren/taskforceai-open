package run

import (
	"context"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"

	handlerutil "github.com/TaskForceAI/adapters/pkg/handler"
	coreusage "github.com/TaskForceAI/core/pkg/usage"
	"github.com/TaskForceAI/go-engine/pkg/run"
	ratelimit "github.com/TaskForceAI/infrastructure/ratelimit/pkg"
)

type inMemoryWindowCounter struct {
	mu            sync.Mutex
	windows       map[string]inMemoryWindow
	lastSweep     time.Time
	sweepInterval time.Duration
}

type inMemoryWindow struct {
	count   int
	resetAt time.Time
}

func newInMemoryWindowCounter() *inMemoryWindowCounter {
	return &inMemoryWindowCounter{
		windows:       make(map[string]inMemoryWindow),
		sweepInterval: 30 * time.Second,
	}
}

func (c *inMemoryWindowCounter) allow(key string, limit int, window time.Duration) bool {
	now := time.Now()

	c.mu.Lock()
	defer c.mu.Unlock()
	c.evictExpiredLocked(now)

	current, ok := c.windows[key]
	if !ok || now.After(current.resetAt) {
		c.windows[key] = inMemoryWindow{
			count:   1,
			resetAt: now.Add(window),
		}
		return true
	}

	if current.count >= limit {
		return false
	}

	current.count++
	c.windows[key] = current
	return true
}

func (c *inMemoryWindowCounter) evictExpiredLocked(now time.Time) {
	interval := c.sweepInterval
	if interval <= 0 {
		interval = 30 * time.Second
	}
	if !c.lastSweep.IsZero() && now.Sub(c.lastSweep) < interval {
		return
	}
	for key, current := range c.windows {
		if now.After(current.resetAt) {
			delete(c.windows, key)
		}
	}
	c.lastSweep = now
}

var fallbackRunLimiter = newInMemoryWindowCounter()

func rateLimitUserIDKey(userID int) string {
	return "id:" + strconv.Itoa(userID)
}

func EnforceRunRateLimit(ctx context.Context, userEmail string, userID int, orgID int) error {
	return enforceRunRateLimit(ctx, userEmail, userID, orgID)
}

func enforceAttachmentUploadRateLimit(ctx context.Context, userEmail string, userID int) error {
	const redisDeadline = 750 * time.Millisecond
	userLimit := coreusage.AttachmentUploadsPerUser.Limit
	window := coreusage.AttachmentUploadsPerUser.Window

	userKey := strings.TrimSpace(userEmail)
	if userKey == "" {
		userKey = rateLimitUserIDKey(userID)
	}
	checkFallback := func() error {
		if !fallbackRunLimiter.allow("attachment:user:"+userKey, userLimit, window) {
			return huma.Error429TooManyRequests("Attachment upload rate limit exceeded")
		}
		return nil
	}

	redisClient, err := run.RedisClientGetter()
	if err != nil {
		slog.Warn("[RunHandler] Redis attachment upload limiter unavailable", "error", err.Error())
		if handlerutil.IsProductionEnv() {
			return huma.Error500InternalServerError("Rate limiter service unavailable")
		}
		return checkFallback()
	}

	limiter := ratelimit.NewRedisLimiter(redisClient, "rl:attachment_upload")
	limitCtx, limitCancel := context.WithTimeout(ctx, redisDeadline)
	defer limitCancel()

	userResult, userErr := limiter.Check(limitCtx, userKey, userLimit, window)
	if userErr != nil {
		slog.Warn("[RunHandler] Redis attachment upload limit check failed, using in-memory limiter", "error", userErr.Error(), "user", userKey)
		if handlerutil.IsProductionEnv() {
			return huma.Error500InternalServerError("Rate limiter service unavailable")
		}
		return checkFallback()
	}
	if !userResult.Allowed {
		return huma.Error429TooManyRequests("Attachment upload rate limit exceeded")
	}
	return nil
}

func enforceRunRateLimit(ctx context.Context, userEmail string, userID int, orgID int) error {
	return enforceTaskRateLimit(ctx, taskRateLimitInput{
		UserEmail:          userEmail,
		UserID:             userID,
		OrgID:              orgID,
		RedisPrefix:        "rl:run",
		FallbackUserPrefix: "user:",
		FallbackOrgPrefix:  "org:",
		UserErrorMessage:   "User rate limit exceeded",
		OrgErrorMessage:    "Organization rate limit exceeded",
		LogLabel:           "run",
	})
}

func enforcePulseRateLimit(ctx context.Context, userEmail string, userID int, orgID int) error {
	return enforceTaskRateLimit(ctx, taskRateLimitInput{
		UserEmail:          userEmail,
		UserID:             userID,
		OrgID:              orgID,
		RedisPrefix:        "rl:pulse",
		FallbackUserPrefix: "pulse:user:",
		FallbackOrgPrefix:  "pulse:org:",
		UserErrorMessage:   "Pulse rate limit exceeded",
		OrgErrorMessage:    "Organization pulse rate limit exceeded",
		LogLabel:           "pulse",
	})
}

type taskRateLimitInput struct {
	UserEmail          string
	UserID             int
	OrgID              int
	RedisPrefix        string
	FallbackUserPrefix string
	FallbackOrgPrefix  string
	UserErrorMessage   string
	OrgErrorMessage    string
	LogLabel           string
}

func enforceTaskRateLimit(ctx context.Context, input taskRateLimitInput) error {
	const redisDeadline = 750 * time.Millisecond
	orgLimit := coreusage.TaskRunsPerOrganization.Limit
	userLimit := coreusage.TaskRunsPerUser.Limit
	window := coreusage.TaskRunsPerUser.Window

	userKey := strings.TrimSpace(input.UserEmail)
	if userKey == "" {
		userKey = rateLimitUserIDKey(input.UserID)
	}

	checkFallback := func(fallbackKey string, limit int, errorMessage string) error {
		if !fallbackRunLimiter.allow(fallbackKey, limit, window) {
			return huma.Error429TooManyRequests(errorMessage)
		}
		return nil
	}

	redisClient, err := run.RedisClientGetter()
	if err != nil {
		slog.Warn("[RunHandler] Redis limiter unavailable", "limiter", input.LogLabel, "error", err.Error())
		if handlerutil.IsProductionEnv() {
			return huma.Error500InternalServerError("Rate limiter service unavailable")
		}
		if input.OrgID != 0 {
			if fallbackErr := checkFallback(input.FallbackOrgPrefix+strconv.Itoa(input.OrgID), orgLimit, input.OrgErrorMessage); fallbackErr != nil {
				return fallbackErr
			}
		}
		return checkFallback(input.FallbackUserPrefix+userKey, userLimit, input.UserErrorMessage)
	}

	limiter := ratelimit.NewRedisLimiter(redisClient, input.RedisPrefix)
	limitCtx, limitCancel := context.WithTimeout(ctx, redisDeadline)
	defer limitCancel()

	if err := checkOrgTaskRateLimit(limitCtx, limiter, input, orgLimit, window, checkFallback); err != nil {
		return err
	}

	userResult, userErr := limiter.Check(limitCtx, userKey, userLimit, window)
	if userErr != nil {
		slog.Warn("[RunHandler] Redis user limit check failed, using in-memory limiter", "limiter", input.LogLabel, "error", userErr.Error(), "user", userKey)
		if handlerutil.IsProductionEnv() {
			return huma.Error500InternalServerError("Rate limiter service unavailable")
		}
		return checkFallback(input.FallbackUserPrefix+userKey, userLimit, input.UserErrorMessage)
	}
	if !userResult.Allowed {
		return huma.Error429TooManyRequests(input.UserErrorMessage)
	}

	return nil
}

func checkOrgTaskRateLimit(
	ctx context.Context,
	limiter *ratelimit.RedisLimiter,
	input taskRateLimitInput,
	orgLimit int,
	window time.Duration,
	checkFallback func(string, int, string) error,
) error {
	if input.OrgID == 0 {
		return nil
	}

	orgResult, orgErr := limiter.CheckOrg(ctx, int32(input.OrgID), orgLimit, window) // #nosec G115
	if orgErr != nil {
		slog.Warn("[RunHandler] Redis org limit check failed, using in-memory limiter", "limiter", input.LogLabel, "error", orgErr.Error(), "orgId", input.OrgID)
		if handlerutil.IsProductionEnv() {
			return huma.Error500InternalServerError("Rate limiter service unavailable")
		}
		return checkFallback(input.FallbackOrgPrefix+strconv.Itoa(input.OrgID), orgLimit, input.OrgErrorMessage)
	}
	if !orgResult.Allowed {
		return huma.Error429TooManyRequests(input.OrgErrorMessage)
	}
	return nil
}
