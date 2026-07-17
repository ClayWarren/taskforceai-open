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

func (c *inMemoryWindowCounter) allowBoth(firstKey string, firstLimit int, firstWindow time.Duration, secondKey string, secondLimit int, secondWindow time.Duration) (bool, bool) {
	now := time.Now()
	c.mu.Lock()
	defer c.mu.Unlock()
	c.evictExpiredLocked(now)
	allowed := func(key string, limit int) bool {
		current, ok := c.windows[key]
		return !ok || now.After(current.resetAt) || current.count < limit
	}
	firstAllowed := allowed(firstKey, firstLimit)
	secondAllowed := allowed(secondKey, secondLimit)
	if !firstAllowed || !secondAllowed {
		return firstAllowed, secondAllowed
	}
	increment := func(key string, window time.Duration) {
		current, ok := c.windows[key]
		if !ok || now.After(current.resetAt) {
			c.windows[key] = inMemoryWindow{count: 1, resetAt: now.Add(window)}
			return
		}
		current.count++
		c.windows[key] = current
	}
	increment(firstKey, firstWindow)
	increment(secondKey, secondWindow)
	return true, true
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

// ResetFallbackRunRateLimiter clears the process-local development fallback.
// Production uses Redis and never relies on this state.
func ResetFallbackRunRateLimiter() {
	fallbackRunLimiter = newInMemoryWindowCounter()
}

func rateLimitUserIDKey(userID int) string {
	return "id:" + strconv.Itoa(userID)
}

func EnforceRunRateLimit(ctx context.Context, userEmail string, userID int, orgID int, plan ...string) error {
	return enforceRunRateLimit(ctx, userEmail, userID, orgID, firstPlan(plan))
}

func firstPlan(plans []string) string {
	if len(plans) == 0 {
		return ""
	}
	return plans[0]
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

func enforceRunRateLimit(ctx context.Context, userEmail string, userID int, orgID int, plan ...string) error {
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
		Plan:               firstPlan(plan),
	})
}

func enforcePulseRateLimit(ctx context.Context, userEmail string, userID int, orgID int, plan ...string) error {
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
		Plan:               firstPlan(plan),
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
	Plan               string
}

func enforceTaskRateLimit(ctx context.Context, input taskRateLimitInput) error {
	const redisDeadline = 750 * time.Millisecond
	orgLimit := coreusage.TaskRunsPerOrganization.Limit
	orgWindow := coreusage.TaskRunsPerOrganization.Window
	userPolicy := coreusage.TaskRunsForPlan(input.Plan)
	userLimit := userPolicy.Limit
	window := userPolicy.Window

	userKey := strings.TrimSpace(input.UserEmail)
	if userKey == "" {
		userKey = rateLimitUserIDKey(input.UserID)
	}

	checkFallback := func(fallbackKey string, limit int, fallbackWindow time.Duration, errorMessage string) error {
		if !fallbackRunLimiter.allow(fallbackKey, limit, fallbackWindow) {
			return huma.Error429TooManyRequests(errorMessage)
		}
		return nil
	}
	checkCombinedFallback := func() error {
		userAllowed, orgAllowed := fallbackRunLimiter.allowBoth(
			input.FallbackUserPrefix+userKey, userLimit, window,
			input.FallbackOrgPrefix+strconv.Itoa(input.OrgID), orgLimit, orgWindow,
		)
		if !orgAllowed {
			return huma.Error429TooManyRequests(input.OrgErrorMessage)
		}
		if !userAllowed {
			return huma.Error429TooManyRequests(input.UserErrorMessage)
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
			return checkCombinedFallback()
		}
		return checkFallback(input.FallbackUserPrefix+userKey, userLimit, window, input.UserErrorMessage)
	}

	limiter := ratelimit.NewRedisLimiter(redisClient, input.RedisPrefix)
	limitCtx, limitCancel := context.WithTimeout(ctx, redisDeadline)
	defer limitCancel()

	if input.OrgID != 0 {
		return enforceCombinedTaskRateLimit(limitCtx, limiter, input, userKey, userLimit, window, orgLimit, orgWindow, checkCombinedFallback)
	}

	userResult, userErr := limiter.Check(limitCtx, userKey, userLimit, window)
	if userErr != nil {
		slog.Warn("[RunHandler] Redis user limit check failed, using in-memory limiter", "limiter", input.LogLabel, "error", userErr.Error(), "user", userKey)
		if handlerutil.IsProductionEnv() {
			return huma.Error500InternalServerError("Rate limiter service unavailable")
		}
		return checkFallback(input.FallbackUserPrefix+userKey, userLimit, window, input.UserErrorMessage)
	}
	if !userResult.Allowed {
		return huma.Error429TooManyRequests(input.UserErrorMessage)
	}

	return nil
}

func enforceCombinedTaskRateLimit(
	ctx context.Context,
	limiter *ratelimit.RedisLimiter,
	input taskRateLimitInput,
	userKey string,
	userLimit int,
	userWindow time.Duration,
	orgLimit int,
	orgWindow time.Duration,
	checkFallback func() error,
) error {
	result, err := limiter.CheckUserAndOrg(ctx, userKey, userLimit, userWindow, int32(input.OrgID), orgLimit, orgWindow) // #nosec G115
	if err != nil {
		slog.Warn("[RunHandler] Redis combined limit check failed", "limiter", input.LogLabel, "error", err.Error(), "orgId", input.OrgID)
		if handlerutil.IsProductionEnv() {
			return huma.Error500InternalServerError("Rate limiter service unavailable")
		}
		return checkFallback()
	}
	if !result.Org.Allowed {
		return huma.Error429TooManyRequests(input.OrgErrorMessage)
	}
	if !result.User.Allowed {
		return huma.Error429TooManyRequests(input.UserErrorMessage)
	}
	return nil
}
