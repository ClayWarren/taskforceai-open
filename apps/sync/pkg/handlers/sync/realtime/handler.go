package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	appdatabase "github.com/TaskForceAI/go-sync/pkg/database"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/golang-jwt/jwt/v5"
	goredis "github.com/redis/go-redis/v9"
)

var (
	getRedisClient     = redis.GetClient
	getQueries         = appdatabase.GetQueries
	encodePollResponse = func(w http.ResponseWriter, response PollResponse) error {
		return json.NewEncoder(w).Encode(response)
	}
)

// PollResponse represents the response from the polling endpoint
type PollResponse struct {
	Messages []SyncMessage `json:"messages"`
	LastID   string        `json:"lastId"`
}

// SyncMessage represents a single sync message
type SyncMessage struct {
	Type    string `json:"type"`
	Version int    `json:"version"`
	ID      string `json:"id"`
}

// Handler handles polling for real-time sync updates.
// This replaces the previous SSE implementation to work with Vercel serverless.
func Handler(w http.ResponseWriter, r *http.Request) {
	startedAt := time.Now()
	ctx, pollSpan := startPollSpan(r.Context(), r)
	r = r.WithContext(ctx)
	outcome := "success"
	scope := "unknown"
	messageCount := 0
	var observationErr error

	// Add panic recovery
	defer func() {
		if err := recover(); err != nil {
			slog.Error("Panic in sync poll handler", "error", err)
			outcome = "panic"
			observationErr = fmt.Errorf("%w: %v", errPollPanic, err)
			http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		}
		finishPollObservation(r.Context(), pollSpan, startedAt, outcome, scope, messageCount, observationErr)
	}()

	// Handle CORS
	if adapterhandler.HandleCORS(w, r) {
		outcome = "cors_preflight"
		return
	}

	if r.Method != http.MethodGet {
		outcome = "method_not_allowed"
		adapterhandler.JSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	// 1. Resolve User ID
	// Use net.SplitHostPort so that IPv6 addresses like [::1]:8080 are parsed correctly.
	// strings.Split(ip, ":") would produce "[" as the host for IPv6 addresses.
	ip := r.RemoteAddr
	if host, _, err := net.SplitHostPort(ip); err == nil {
		ip = host
	}

	// 2. Setup Redis Client
	redisClient, err := getRedisClient()
	if err != nil {
		slog.Error("Failed to get Redis client for sync poll", "error", err)
		outcome = "redis_unavailable"
		observationErr = err
		adapterhandler.JSONError(w, http.StatusServiceUnavailable, "Sync service unavailable")
		return
	}

	rlKey := fmt.Sprintf("sync:rate_limit:fail:%s", ip)

	userID, orgID := resolveUserID(r)
	if userID == "" {
		if recordAuthFailureAndCheckLimit(r.Context(), redisClient, rlKey) {
			slog.Warn("Rate limiting sync poll due to repeated auth failures", "ip", ip)
			outcome = "rate_limited"
			adapterhandler.JSONError(w, http.StatusTooManyRequests, "Too many authentication failures")
			return
		}

		outcome = "unauthorized"
		adapterhandler.JSONError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	scope = pollScope(orgID)

	// Reset fail counter on success
	if _, err := redisClient.Del(r.Context(), rlKey); err != nil {
		slog.Warn("Failed to delete rate limit key", "error", err)
	}

	// 3. Get Last Event ID from query param (client tracks this)
	lastEventID := r.URL.Query().Get("last_id")
	if lastEventID == "" {
		lastEventID = "0"
	}

	// 4. Read messages from Redis Stream (non-blocking)
	streamKey := fmt.Sprintf("sync:stream:%s", userID)
	if orgID != "" {
		streamKey = fmt.Sprintf("sync:stream:org:%s", orgID)
	}

	const maxMessages = 100
	messages, err := redisClient.XRead(r.Context(), streamKey, lastEventID, maxMessages)
	if err != nil {
		outcome, observationErr = handlePollReadError(w, lastEventID, userID, err)
		return
	}

	// 5. Build response
	response := buildPollResponse(messages, lastEventID)

	// 6. Return JSON response
	w.Header().Set("Content-Type", "application/json")
	if err := encodePollResponse(w, response); err != nil {
		slog.Error("Failed to encode poll response", "error", err)
		outcome = "encode_failed"
		observationErr = err
		adapterhandler.JSONError(w, http.StatusInternalServerError, "Failed to encode response")
		return
	}

	messageCount = len(response.Messages)
	slog.Debug("Sync poll completed", "userId", userID, "messageCount", len(response.Messages), "lastId", response.LastID)
}

func buildPollResponse(messages []goredis.XMessage, lastEventID string) PollResponse {
	response := PollResponse{Messages: make([]SyncMessage, 0, len(messages)), LastID: lastEventID}
	for _, msg := range messages {
		response.LastID = msg.ID
		response.Messages = append(response.Messages, SyncMessage{
			Type: pollMessageType(msg.Values), Version: pollMessageVersion(msg.Values["version"]), ID: msg.ID,
		})
	}
	return response
}

func pollMessageType(values map[string]any) string {
	value, ok := values["type"]
	if !ok {
		return ""
	}
	return fmt.Sprintf("%v", value)
}

func pollMessageVersion(value any) int {
	switch n := value.(type) {
	case string:
		parsed, _ := strconv.Atoi(n)
		return parsed
	case int:
		return n
	case int64:
		return int(n)
	case float64:
		return int(n)
	default:
		return 0
	}
}

func handlePollReadError(w http.ResponseWriter, lastEventID, userID string, err error) (string, error) {
	if errors.Is(err, goredis.Nil) {
		return observeEmptyPollResponse(w, lastEventID, "success", nil)
	}

	// Missing TCP Redis degrades realtime sync but should not break polling.
	if strings.Contains(err.Error(), "stream operations require REDIS_URL") {
		return observeEmptyPollResponse(w, lastEventID, "empty_missing_redis", nil)
	}

	slog.Error("Failed to read from Redis stream", "error", err, "userId", userID)
	// Return empty response on error - client will retry.
	return observeEmptyPollResponse(w, lastEventID, "empty_read_error", err)
}

func observeEmptyPollResponse(w http.ResponseWriter, lastEventID, outcome string, observationErr error) (string, error) {
	if encodeErr := writeEmptyPollResponse(w, lastEventID); encodeErr != nil {
		return observePollEncodeFailure(encodeErr)
	}
	return outcome, observationErr
}

func writeEmptyPollResponse(w http.ResponseWriter, lastEventID string) error {
	w.Header().Set("Content-Type", "application/json")
	return encodePollResponse(w, PollResponse{
		Messages: []SyncMessage{},
		LastID:   lastEventID,
	})
}

func observePollEncodeFailure(err error) (string, error) {
	slog.Error("Failed to encode poll response", "error", err)
	return "encode_failed", err
}

func resolveUserID(r *http.Request) (string, string) {
	accessClaims, accessTokenPresent, accessTokenValid := resolveAccessTokenClaims(r)
	if accessTokenPresent && !accessTokenValid {
		return "", ""
	}

	if token := r.URL.Query().Get("sync_token"); token != "" {
		if syncClaims, err := validateSyncToken(token); err == nil {
			if accessTokenPresent && !sameRealtimeAuthContext(syncClaims, accessClaims) {
				slog.Warn("Rejected sync realtime request with mismatched token contexts")
				return "", ""
			}
			return resolveRealtimeUser(r.Context(), syncClaims["sub"], organizationIDFromClaims(syncClaims))
		} else {
			slog.Warn("Invalid sync token", "error", err)
		}
	}

	if accessTokenValid {
		return resolveRealtimeUser(r.Context(), accessClaims["email"], organizationIDFromClaims(accessClaims))
	}

	return "", ""
}

func resolveAccessTokenClaims(r *http.Request) (jwt.MapClaims, bool, bool) {
	token := adapterhandler.ExtractToken(r)
	if token == "" {
		return nil, false, false
	}
	claims, err := adapterhandler.ValidateToken(token)
	if err != nil {
		return nil, true, false
	}
	if adapterhandler.IsTokenRevoked != nil && adapterhandler.IsTokenRevoked(r.Context(), token) {
		slog.Warn("Rejected revoked access token for sync realtime poll")
		return nil, true, false
	}
	return claims, true, true
}

func sameRealtimeAuthContext(syncClaims, accessClaims jwt.MapClaims) bool {
	syncEmail := realtimeClaimString(syncClaims["sub"])
	accessEmail := realtimeClaimString(accessClaims["email"])
	if accessEmail == "" {
		accessEmail = realtimeClaimString(accessClaims["sub"])
	}
	return syncEmail != "" &&
		strings.EqualFold(syncEmail, accessEmail) &&
		organizationIDFromClaims(syncClaims) == organizationIDFromClaims(accessClaims)
}

func realtimeClaimString(value any) string {
	text, _ := value.(string)
	return strings.TrimSpace(text)
}

func resolveRealtimeUser(ctx context.Context, rawEmail any, orgID string) (string, string) {
	email, _ := rawEmail.(string)
	email = strings.TrimSpace(email)
	if email == "" {
		return "", ""
	}

	q, err := getQueries(ctx)
	if err != nil {
		slog.Warn("Sync realtime user lookup unavailable", "error", err)
		return "", ""
	}

	dbUser, err := q.GetUserByEmail(ctx, email)
	if err != nil {
		slog.Warn("Sync realtime user lookup failed", "email", email, "error", err)
		return "", ""
	}
	if dbUser.ID <= 0 || dbUser.Disabled {
		slog.Warn("Rejected sync realtime request for inactive user", "email", email, "userId", dbUser.ID)
		return "", ""
	}

	if orgID != "" {
		parsedOrgID, err := strconv.ParseInt(orgID, 10, 32)
		if err != nil {
			slog.Warn("Rejected sync realtime request with invalid organization claim", "email", email, "orgId", orgID)
			return "", ""
		}
		if parsedOrgID <= 0 {
			return strconv.Itoa(int(dbUser.ID)), ""
		}
		organizationID := int32(parsedOrgID) // #nosec G115 -- parsed with bitSize 32 above.

		if _, err := q.GetMembership(ctx, db.GetMembershipParams{
			OrganizationID: organizationID,
			UserID:         dbUser.ID,
		}); err != nil {
			slog.Warn("Rejected sync realtime request for missing organization membership", "email", email, "orgId", parsedOrgID, "error", err)
			return "", ""
		}
	}

	return strconv.Itoa(int(dbUser.ID)), orgID
}

func organizationIDFromClaims(claims map[string]any) string {
	for _, key := range []string{"org", "org_id"} {
		if value, ok := claims[key]; ok {
			if normalized := normalizeNumericClaim(value); normalized != "" {
				return normalized
			}
		}
	}

	return ""
}

func normalizeNumericClaim(raw any) string {
	switch v := raw.(type) {
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(v), 'f', -1, 64)
	case int:
		return strconv.Itoa(v)
	case int8:
		return strconv.FormatInt(int64(v), 10)
	case int16:
		return strconv.FormatInt(int64(v), 10)
	case int32:
		return strconv.FormatInt(int64(v), 10)
	case int64:
		return strconv.FormatInt(v, 10)
	case uint:
		return strconv.FormatUint(uint64(v), 10)
	case uint8:
		return strconv.FormatUint(uint64(v), 10)
	case uint16:
		return strconv.FormatUint(uint64(v), 10)
	case uint32:
		return strconv.FormatUint(uint64(v), 10)
	case uint64:
		return strconv.FormatUint(v, 10)
	case string:
		return strings.TrimSpace(v)
	default:
		return ""
	}
}

func recordAuthFailureAndCheckLimit(ctx context.Context, redisClient redis.Cmdable, key string) bool {
	attempts, incrErr := redisClient.Incr(ctx, key)
	if incrErr != nil {
		slog.Warn("Failed to increment auth failure rate limit key", "error", incrErr)
		return false
	}

	// Set TTL only when the key is first created to avoid extending lockouts indefinitely.
	if attempts == 1 {
		if _, err := redisClient.Expire(ctx, key, time.Minute); err != nil {
			slog.Warn("Failed to set expiry on rate limit key", "error", err)
		}
	} else {
		repairMissingAuthFailureTTL(ctx, redisClient, key)
	}

	return attempts > 5
}

func repairMissingAuthFailureTTL(ctx context.Context, redisClient redis.Cmdable, key string) {
	ttl, err := redisClient.TTL(ctx, key)
	if err != nil {
		slog.Warn("Failed to read expiry on rate limit key", "error", err)
		return
	}
	if ttl >= 0 {
		return
	}
	if _, err := redisClient.Expire(ctx, key, time.Minute); err != nil {
		slog.Warn("Failed to repair missing expiry on rate limit key", "error", err)
	}
}

func validateSyncToken(tokenString string) (jwt.MapClaims, error) {
	secret := os.Getenv("AUTH_SECRET")
	if secret == "" {
		return nil, fmt.Errorf("server configuration error: AUTH_SECRET not set")
	}

	token, err := jwt.Parse(tokenString,
		func(token *jwt.Token) (any, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
			}
			return []byte(secret), nil
		},
		jwt.WithAudience("sync-realtime"),
		jwt.WithIssuer("taskforceai-sync"),
	)
	if err != nil {
		return nil, err
	}

	claims, _ := token.Claims.(jwt.MapClaims)
	return claims, nil
}
