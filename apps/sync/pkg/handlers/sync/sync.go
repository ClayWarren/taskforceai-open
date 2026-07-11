package sync

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/danielgtaylor/huma/v2"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/go-sync/pkg/sync"
)

type SyncPullRequest struct {
	LastSyncVersion *float64 `json:"last_sync_version,omitempty" default:"0"`
	DeviceID        *string  `json:"device_id,omitempty"`
	Limit           *float64 `json:"limit,omitempty" default:"100"`
	OrganizationID  *float64 `json:"organization_id,omitempty"`
}

type SyncPullResponse struct {
	Conversations []sync.ConversationSyncPayload `json:"conversations"`
	Messages      []sync.MessageSyncPayload      `json:"messages"`
	Deletions     []sync.DeletionRecord          `json:"deletions"`
	LatestVersion int32                          `json:"latest_version"`
	HasMore       bool                           `json:"has_more"`
	StateHash     string                         `json:"state_hash,omitempty"`
}

type SyncPushRequest struct {
	Conversations      []sync.ConversationSyncPayload `json:"conversations"`
	Messages           []sync.MessageSyncPayload      `json:"messages"`
	Deletions          []sync.DeletionRecord          `json:"deletions"`
	DeviceID           string                         `json:"device_id,omitempty"`
	ResolutionStrategy sync.ResolutionStrategy        `json:"resolution_strategy,omitempty"`
	OrganizationID     *int32                         `json:"organization_id,omitempty"`
}

type SyncPushResponse struct {
	Success                bool                  `json:"success"`
	Conflicts              []sync.ConflictRecord `json:"conflicts,omitempty"`
	Version                int32                 `json:"version"`
	Accepted               []string              `json:"accepted"`
	NewVersion             int32                 `json:"new_version"`
	ConversationIDMappings map[string]int32      `json:"conversation_id_mappings"`
}

type ListDevicesResponse struct {
	Devices []sync.DeviceRecord `json:"devices"`
}

type RevokeDeviceRequest struct {
	DeviceID string `path:"deviceId"`
}

type SyncService interface {
	PullChanges(
		ctx context.Context,
		userID string,
		deviceID string,
		userAgent string,
		req sync.SyncPullRequest,
	) (*sync.SyncPullResponse, error)
	PushChanges(
		ctx context.Context,
		userID string,
		deviceID string,
		userAgent string,
		idempotencyKey string,
		req sync.SyncPushRequest,
	) (*sync.SyncPushResponse, error)
	ListDevices(ctx context.Context, userID string) ([]sync.DeviceRecord, error)
	RevokeDevice(ctx context.Context, userID string, deviceID string) error
}

type Dependencies struct {
	Service SyncService
	Repo    sync.SyncRepository
	Queries *db.Queries
}

type DependencyResolver func(ctx context.Context) (Dependencies, error)

const (
	maxInt32Value    int64 = 2_147_483_647
	minInt32Value    int64 = -2_147_483_648
	defaultPullLimit       = int32(100)
	maxPullLimit           = int32(1000)
)

func clampFloat64ToInt32(value float64, fallback int32) int32 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return fallback
	}
	truncated := math.Trunc(value)
	if truncated > float64(maxInt32Value) {
		return int32(maxInt32Value)
	}
	if truncated < float64(minInt32Value) {
		return int32(minInt32Value)
	}
	return int32(truncated)
}

func normalizeOrganizationID(value *float64) (*int32, error) {
	if value == nil {
		return nil, nil
	}
	if math.IsNaN(*value) || math.IsInf(*value, 0) {
		return nil, fmt.Errorf("organizationId must be finite")
	}
	truncated := math.Trunc(*value)
	if truncated != *value {
		return nil, fmt.Errorf("organizationId must be an integer")
	}
	if truncated > float64(maxInt32Value) || truncated < float64(minInt32Value) {
		return nil, fmt.Errorf("organizationId out of int32 range")
	}
	orgID := int32(truncated)
	return &orgID, nil
}

// verifyOrgMembership checks that the user (by numeric ID) is a member of the given org.
func verifyOrgMembership(ctx context.Context, q *db.Queries, userID int, orgID int32) error {
	if userID == 0 {
		return fmt.Errorf("invalid user ID 0 for membership check")
	}
	if q == nil {
		return fmt.Errorf("database unavailable for membership check")
	}

	if userID > math.MaxInt32 || userID < math.MinInt32 {
		return fmt.Errorf("user ID %d out of int32 range", userID)
	}
	uid := int32(userID)

	_, err := q.GetMembership(ctx, db.GetMembershipParams{
		OrganizationID: orgID,
		UserID:         uid,
	})
	return err
}

func normalizePushOrganizationScope(req *SyncPushRequest) error {
	for idx := range req.Conversations {
		conversationOrgID := req.Conversations[idx].OrganizationID

		if req.OrganizationID == nil {
			if conversationOrgID != nil {
				return fmt.Errorf("conversation[%d].organizationId requires top-level organizationId", idx)
			}
			continue
		}

		if conversationOrgID != nil && *conversationOrgID != *req.OrganizationID {
			return fmt.Errorf("conversation[%d].organizationId must match top-level organizationId", idx)
		}

		req.Conversations[idx].OrganizationID = req.OrganizationID
	}

	return nil
}

func normalizePushResolutionStrategy(req *SyncPushRequest) error {
	switch req.ResolutionStrategy {
	case "":
		req.ResolutionStrategy = sync.StrategyAutoMerge
		return nil
	case sync.StrategyServerWins, sync.StrategyClientWins, sync.StrategyAutoMerge:
		return nil
	default:
		return fmt.Errorf("unsupported resolutionStrategy")
	}
}

func syncUserID(user *adapterauth.AuthenticatedUser) (string, error) {
	if user == nil || user.ID <= 0 {
		return "", fmt.Errorf("authenticated user ID is required")
	}
	return strconv.Itoa(user.ID), nil
}

type syncPullInput struct {
	Body      *SyncPullRequest
	DeviceID  string `header:"X-Device-Id"`
	UserAgent string `header:"User-Agent"`
	handler.AuthContext
}

type syncStatusInput struct {
	OrganizationID int32 `query:"organizationId" default:"0"`
	handler.AuthContext
}

type syncPushInput struct {
	Body           SyncPushRequest
	DeviceID       string `header:"X-Device-Id"`
	UserAgent      string `header:"User-Agent"`
	IdempotencyKey string `header:"X-Sync-Id"`
	handler.AuthContext
}

type listDevicesInput struct {
	handler.AuthContext
}

type revokeDeviceInput struct {
	RevokeDeviceRequest
	handler.AuthContext
}

func handleSyncPull(ctx context.Context, resolve DependencyResolver, input *syncPullInput) (*struct{ Body *SyncPullResponse }, error) {
	deps, depsErr := resolve(ctx)
	if depsErr != nil {
		slog.Error("Sync dependencies unavailable", "error", depsErr)
		return nil, huma.Error503ServiceUnavailable("Sync service unavailable")
	}

	userID, authErr := syncUserID(input.User)
	if authErr != nil {
		return nil, huma.Error401Unauthorized("Unauthorized")
	}

	// Ensure we have a body even if empty
	req := input.Body
	if req == nil {
		v := float64(0)
		l := float64(defaultPullLimit)
		req = &SyncPullRequest{LastSyncVersion: &v, Limit: &l}
	}

	orgID, orgIDErr := normalizeOrganizationID(req.OrganizationID)
	if orgIDErr != nil {
		return nil, huma.Error400BadRequest("Invalid organizationId")
	}

	// AUTHZ-VULN-02: Verify org membership before allowing org-scoped reads
	if orgID != nil {
		if err := verifyOrgMembership(ctx, deps.Queries, input.User.ID, *orgID); err != nil {
			return nil, huma.Error403Forbidden("Not a member of this organization")
		}
	}

	lastVersion := int32(0)
	if req.LastSyncVersion != nil {
		lastVersion = clampFloat64ToInt32(*req.LastSyncVersion, 0)
	}

	limit := defaultPullLimit
	if req.Limit != nil {
		limit = clampFloat64ToInt32(*req.Limit, defaultPullLimit)
		if limit <= 0 {
			limit = defaultPullLimit
		}
		limit = min(limit, maxPullLimit)
	}

	domainReq := sync.SyncPullRequest{
		LastSyncVersion: lastVersion,
		Limit:           limit,
		OrganizationID:  orgID,
	}

	deviceID := strings.TrimSpace(input.DeviceID)
	if deviceID == "" && req.DeviceID != nil {
		deviceID = strings.TrimSpace(*req.DeviceID)
	}
	if deviceID == "" {
		return nil, huma.Error400BadRequest("Device ID is required")
	}
	userAgent := input.UserAgent

	resp, err := deps.Service.PullChanges(ctx, userID, deviceID, userAgent, domainReq)
	if err != nil {
		if errors.Is(err, sync.ErrDeviceRevoked) {
			return nil, huma.Error403Forbidden("Device revoked")
		}
		slog.Error("Sync pull failed", "userId", userID, "userEmail", input.User.Email, "deviceId", deviceID, "error", err)
		return nil, huma.Error500InternalServerError("Pull failed")
	}

	return &struct{ Body *SyncPullResponse }{Body: syncPullResponseFromDomain(resp)}, nil
}

func handleSyncStatus(ctx context.Context, resolve DependencyResolver, input *syncStatusInput) (*struct{ Body map[string]any }, error) {
	deps, depsErr := resolve(ctx)
	if depsErr != nil {
		slog.Error("Sync dependencies unavailable", "error", depsErr)
		return nil, huma.Error503ServiceUnavailable("Sync service unavailable")
	}

	userID, authErr := syncUserID(input.User)
	if authErr != nil {
		return nil, huma.Error401Unauthorized("Unauthorized")
	}

	var version int32
	var err error
	numericUserID := input.User.ID

	if input.OrganizationID != 0 {
		orgID := input.OrganizationID
		if err := verifyOrgMembership(ctx, deps.Queries, numericUserID, orgID); err != nil {
			slog.Warn("Org membership verification failed", "userId", numericUserID, "orgId", orgID, "error", err)
			return nil, huma.Error403Forbidden("Forbidden: Not a member of this organization")
		}
		version, err = deps.Repo.GetLatestOrgSyncVersion(ctx, orgID)
	} else {
		version, err = deps.Repo.GetLatestSyncVersion(ctx, userID)
	}

	if err != nil {
		return nil, huma.Error500InternalServerError("Failed to get status")
	}

	return &struct{ Body map[string]any }{Body: map[string]any{
		"sync_version":    version,
		"pending_changes": 0,
	}}, nil
}

func handleSyncPush(ctx context.Context, resolve DependencyResolver, input *syncPushInput) (*struct{ Body *SyncPushResponse }, error) {
	deps, depsErr := resolve(ctx)
	if depsErr != nil {
		slog.Error("Sync dependencies unavailable", "error", depsErr)
		return nil, huma.Error503ServiceUnavailable("Sync service unavailable")
	}

	userID, authErr := syncUserID(input.User)
	if authErr != nil {
		return nil, huma.Error401Unauthorized("Unauthorized")
	}

	if err := normalizePushOrganizationScope(&input.Body); err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}
	if err := normalizePushResolutionStrategy(&input.Body); err != nil {
		return nil, huma.Error400BadRequest(err.Error())
	}

	numericUserID := input.User.ID

	if input.Body.OrganizationID != nil {
		orgID := *input.Body.OrganizationID
		if err := verifyOrgMembership(ctx, deps.Queries, numericUserID, orgID); err != nil {
			slog.Warn("Org membership verification failed", "userId", numericUserID, "orgId", orgID, "error", err)
			return nil, huma.Error403Forbidden("Forbidden: Not a member of this organization")
		}
	}

	domainReq := syncPushRequestToDomain(&input.Body)

	deviceID := strings.TrimSpace(input.DeviceID)
	if deviceID == "" {
		deviceID = strings.TrimSpace(input.Body.DeviceID)
	}
	if deviceID == "" {
		return nil, huma.Error400BadRequest("Device ID is required")
	}
	userAgent := input.UserAgent
	idempotencyKey := input.IdempotencyKey

	resp, err := deps.Service.PushChanges(ctx, userID, deviceID, userAgent, idempotencyKey, domainReq)
	if err != nil {
		if errors.Is(err, sync.ErrDeviceRevoked) {
			return nil, huma.Error403Forbidden("Device revoked")
		}
		slog.Error(
			"Sync push failed",
			"userId",
			userID,
			"userEmail",
			input.User.Email,
			"deviceId",
			deviceID,
			"idempotencyKey",
			idempotencyKey,
			"error",
			err,
		)
		return nil, huma.Error500InternalServerError("Push failed")
	}

	return &struct{ Body *SyncPushResponse }{Body: syncPushResponseFromDomain(resp)}, nil
}

func syncPullResponseFromDomain(resp *sync.SyncPullResponse) *SyncPullResponse {
	conversations := resp.Conversations
	if conversations == nil {
		conversations = []sync.ConversationSyncPayload{}
	}
	messages := resp.Messages
	if messages == nil {
		messages = []sync.MessageSyncPayload{}
	}
	deletions := resp.Deletions
	if deletions == nil {
		deletions = []sync.DeletionRecord{}
	}

	return &SyncPullResponse{
		Conversations: conversations,
		Messages:      messages,
		Deletions:     deletions,
		LatestVersion: resp.LatestVersion,
		HasMore:       resp.HasMore,
		StateHash:     resp.StateHash,
	}
}

func syncPushRequestToDomain(req *SyncPushRequest) sync.SyncPushRequest {
	return sync.SyncPushRequest{
		Conversations:      req.Conversations,
		Messages:           req.Messages,
		Deletions:          req.Deletions,
		ResolutionStrategy: req.ResolutionStrategy,
		OrganizationID:     req.OrganizationID,
	}
}

func syncPushResponseFromDomain(resp *sync.SyncPushResponse) *SyncPushResponse {
	return &SyncPushResponse{
		Success:                resp.Success,
		Conflicts:              resp.Conflicts,
		Version:                resp.Version,
		Accepted:               resp.Accepted,
		NewVersion:             resp.NewVersion,
		ConversationIDMappings: resp.ConversationIDMappings,
	}
}

func handleListDevices(ctx context.Context, resolve DependencyResolver, input *listDevicesInput) (*struct{ Body *ListDevicesResponse }, error) {
	deps, depsErr := resolve(ctx)
	if depsErr != nil {
		slog.Error("Sync dependencies unavailable", "error", depsErr)
		return nil, huma.Error503ServiceUnavailable("Sync service unavailable")
	}

	userID, authErr := syncUserID(input.User)
	if authErr != nil {
		return nil, huma.Error401Unauthorized("Unauthorized")
	}

	devices, err := deps.Service.ListDevices(ctx, userID)
	if err != nil {
		return nil, huma.Error500InternalServerError("Failed to list devices")
	}

	return &struct{ Body *ListDevicesResponse }{Body: &ListDevicesResponse{Devices: devices}}, nil
}

func handleRevokeDevice(ctx context.Context, resolve DependencyResolver, input *revokeDeviceInput) (*struct{ Body map[string]bool }, error) {
	deps, depsErr := resolve(ctx)
	if depsErr != nil {
		slog.Error("Sync dependencies unavailable", "error", depsErr)
		return nil, huma.Error503ServiceUnavailable("Sync service unavailable")
	}

	userID, authErr := syncUserID(input.User)
	if authErr != nil {
		return nil, huma.Error401Unauthorized("Unauthorized")
	}

	if err := deps.Service.RevokeDevice(ctx, userID, input.DeviceID); err != nil {
		return nil, huma.Error500InternalServerError("Failed to revoke device")
	}

	return &struct{ Body map[string]bool }{Body: map[string]bool{"success": true}}, nil
}

// RegisterHandlersWithResolver registers sync handlers with lazy dependency resolution.
func RegisterHandlersWithResolver(api huma.API, resolve DependencyResolver) {
	// Sync Status
	huma.Register(api, huma.Operation{
		OperationID: "sync-status",
		Method:      http.MethodGet,
		Path:        "/api/v1/sync/status",
		Summary:     "Get sync status",
		Tags:        []string{"Sync"},
	}, func(ctx context.Context, input *struct {
		syncStatusInput
	}) (*struct{ Body map[string]any }, error) {
		return handleSyncStatus(ctx, resolve, &input.syncStatusInput)
	})

	// Sync Pull
	huma.Register(api, huma.Operation{
		OperationID: "sync-pull",
		Method:      http.MethodPost,
		Path:        "/api/v1/sync/pull",
		Summary:     "Pull changes",
		Tags:        []string{"Sync"},
	}, func(ctx context.Context, input *syncPullInput) (*struct{ Body *SyncPullResponse }, error) {
		return handleSyncPull(ctx, resolve, input)
	})

	// Sync Push
	huma.Register(api, huma.Operation{
		OperationID: "sync-push",
		Method:      http.MethodPost,
		Path:        "/api/v1/sync/push",
		Summary:     "Push changes",
		Tags:        []string{"Sync"},
	}, func(ctx context.Context, input *syncPushInput) (*struct{ Body *SyncPushResponse }, error) {
		return handleSyncPush(ctx, resolve, input)
	})

	// List Devices
	huma.Register(api, huma.Operation{
		OperationID: "sync-list-devices",
		Method:      http.MethodGet,
		Path:        "/api/v1/sync/devices",
		Summary:     "List synced devices",
		Tags:        []string{"Sync"},
	}, func(ctx context.Context, input *listDevicesInput) (*struct{ Body *ListDevicesResponse }, error) {
		return handleListDevices(ctx, resolve, input)
	})

	// Revoke Device
	huma.Register(api, huma.Operation{
		OperationID: "sync-revoke-device",
		Method:      http.MethodDelete,
		Path:        "/api/v1/sync/devices/{deviceId}",
		Summary:     "Revoke a synced device",
		Tags:        []string{"Sync"},
	}, func(ctx context.Context, input *revokeDeviceInput) (*struct{ Body map[string]bool }, error) {
		return handleRevokeDevice(ctx, resolve, input)
	})
}
