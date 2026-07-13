package agents

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/core/pkg/payments"
	"github.com/TaskForceAI/core/pkg/pulse"
	ff "github.com/TaskForceAI/feature-flags/pkg"
	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"
)

// validModelIDs is the allowlist of supported model identifiers.
var validModelIDs = map[string]struct{}{
	"xai/grok-4.5":                  {},
	"meta/muse-spark-1.1":           {},
	"openai/gpt-5.6-luna":           {},
	"openai/gpt-5.6-sol":            {},
	"openai/gpt-5.6-terra":          {},
	"anthropic/claude-fable-5":      {},
	"anthropic/claude-haiku-4.5":    {},
	"anthropic/claude-opus-4.8":     {},
	"anthropic/claude-sonnet-5":     {},
	"google/gemini-3.1-pro-preview": {},
	"google/gemini-3.1-flash-lite":  {},
	"google/gemini-3.5-flash":       {},
	"zai/glm-5.2":                   {},
}

const (
	minCheckInterval int32 = 300   // 5 minutes
	maxCheckInterval int32 = 86400 // 24 hours
)

// AgentInput defines the data needed to create or update an agent.
type AgentInput struct {
	ID              *string `json:"id,omitempty"`
	Name            string  `json:"name" minLength:"1" maxLength:"100"`
	Description     *string `json:"description,omitempty"`
	Avatar          *string `json:"avatar,omitempty"`
	ModelID         *string `json:"modelId,omitempty"`
	AutonomyEnabled bool    `json:"autonomyEnabled"`
	Timezone        string  `json:"timezone" default:"UTC" maxLength:"128"`
	ActiveStart     string  `json:"activeStart" default:"09:00"`
	ActiveEnd       string  `json:"activeEnd" default:"17:00"`
	ActiveDays      []int32 `json:"activeDays"`
	CheckInterval   int32   `json:"check_interval" default:"600"`
}

type AgentRecord = db.Agent
type UpsertAgentInput = db.UpsertAgentParams

type AgentStore interface {
	ListAgentsByUserID(ctx context.Context, userID int32) ([]AgentRecord, error)
	GetAgent(ctx context.Context, agentID string) (AgentRecord, error)
	UpsertAgent(ctx context.Context, input UpsertAgentInput) (AgentRecord, error)
}

type AutonomyLimitError struct {
	Limit int
}

func (e *AutonomyLimitError) Error() string {
	return fmt.Sprintf("maximum of %d enabled autonomous agents per user exceeded", e.Limit)
}

type BridgeRegistry interface {
	RegisterAgent(agent AgentRecord)
	UnregisterAgent(agentID string)
}

var listAgentsByUserID = func(ctx context.Context, store AgentStore, userID int32) ([]AgentRecord, error) {
	return store.ListAgentsByUserID(ctx, userID)
}

var getAgentByID = func(ctx context.Context, store AgentStore, agentID string) (AgentRecord, error) {
	return store.GetAgent(ctx, agentID)
}

var upsertAgent = func(ctx context.Context, store AgentStore, input UpsertAgentInput) (AgentRecord, error) {
	return store.UpsertAgent(ctx, input)
}

var randRead = rand.Read

var isAutonomyEnabledForUser = func(key string, user ff.User) bool {
	return ff.GetClient(key).IsEnabled(user, ff.ModeAutonomy)
}

func validateCheckInterval(checkInterval int32) error {
	if checkInterval < minCheckInterval || checkInterval > maxCheckInterval {
		return fmt.Errorf("check_interval must be between %d and %d seconds", minCheckInterval, maxCheckInterval)
	}
	return nil
}

func validateActiveDays(activeDays []int32) error {
	for _, day := range activeDays {
		if day < 0 || day > 6 {
			return fmt.Errorf("invalid activeDays value %d: must be between 0 (Sunday) and 6 (Saturday)", day)
		}
	}
	return nil
}

func validateModelID(modelID *string) error {
	if modelID == nil {
		return nil
	}
	if _, ok := validModelIDs[*modelID]; !ok {
		return fmt.Errorf("invalid modelId %q: not in the list of supported models", *modelID)
	}
	return nil
}

func newAgentID() (string, error) {
	buf := make([]byte, 16)
	if _, err := randRead(buf); err != nil {
		return "", err
	}
	return "agent_" + hex.EncodeToString(buf), nil
}

func enabledAutonomyLimitExceeded(existingAgents []AgentRecord, updatingAgentID *string, plan string) bool {
	maxEnabled := payments.AgentLimitForPlan(plan)
	enabledCount := 0
	for _, existing := range existingAgents {
		if updatingAgentID != nil && existing.ID == *updatingAgentID {
			continue
		}
		if existing.AutonomyEnabled {
			enabledCount++
		}
	}
	return enabledCount >= maxEnabled
}

func shouldBypassAutonomyFeatureFlag() bool {
	if strings.TrimSpace(os.Getenv("TASKFORCE_BYPASS_FEATURE_FLAGS")) == "1" {
		return true
	}

	env := strings.ToLower(strings.TrimSpace(firstNonEmpty(
		os.Getenv("GO_ENV"),
		os.Getenv("NODE_ENV"),
	)))
	return env == "development" || env == "test"
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func autonomyFeatureEnabled(authCtx handler.AuthContext) bool {
	if shouldBypassAutonomyFeatureFlag() {
		return true
	}

	key := strings.TrimSpace(os.Getenv("STATSIG_SECRET_KEY"))
	if key == "" {
		return false
	}

	plan := "free"
	if authCtx.User.Plan != nil && *authCtx.User.Plan != "" {
		plan = *authCtx.User.Plan
	}
	flagUser := ff.User{
		UserID: fmt.Sprintf("%d", authCtx.User.ID),
		Email:  authCtx.User.Email,
		Tier:   plan,
	}
	return isAutonomyEnabledForUser(key, flagUser)
}

// RegisterHandlers registers the agent management handlers.
func RegisterHandlers(api huma.API, store AgentStore, bridgeProvider func() (BridgeRegistry, error)) {
	registerListAgents(api, store)
	registerUpsertAgent(api, store, bridgeProvider)
}

func registerListAgents(api huma.API, store AgentStore) {
	// List Agents
	huma.Register(api, huma.Operation{
		OperationID: "list-agents",
		Method:      http.MethodGet,
		Path:        "/api/v1/agents",
		Summary:     "List agents",
		Tags:        []string{"Agents"},
	}, func(ctx context.Context, input *struct {
		handler.AuthContext
	}) (*struct{ Body []AgentRecord }, error) {
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		agents, err := listAgentsByUserID(ctx, store, ids.UserID32)
		if err != nil {
			slog.Error("List agents failed", "userId", ids.UserID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to fetch agents")
		}
		if agents == nil {
			agents = []AgentRecord{}
		}
		return &struct{ Body []AgentRecord }{Body: agents}, nil
	})
}

func registerUpsertAgent(api huma.API, store AgentStore, bridgeProvider func() (BridgeRegistry, error)) {
	// Upsert Agent
	huma.Register(api, huma.Operation{
		OperationID: "upsert-agent",
		Method:      http.MethodPost,
		Path:        "/api/v1/agents",
		Summary:     "Create or update an agent",
		Tags:        []string{"Agents"},
	}, func(ctx context.Context, input *struct {
		Body AgentInput
		handler.AuthContext
	}) (*struct{ Body AgentRecord }, error) {
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		timezone, err := validateAgentInput(input.Body)
		if err != nil {
			return nil, huma.Error422UnprocessableEntity(err.Error())
		}

		if err := enforceAutonomyLimit(ctx, store, input.AuthContext, ids.UserID32, ids.UserID, input.Body); err != nil {
			return nil, err
		}

		id, err := resolveAgentID(ctx, store, input.Body.ID, ids.UserID32)
		if err != nil {
			return nil, err
		}

		arg := UpsertAgentInput{
			ID:              id,
			UserID:          ids.UserID32,
			Name:            input.Body.Name,
			Description:     input.Body.Description,
			Avatar:          input.Body.Avatar,
			ModelID:         input.Body.ModelID,
			AutonomyEnabled: input.Body.AutonomyEnabled,
			Timezone:        timezone,
			ActiveStart:     input.Body.ActiveStart,
			ActiveEnd:       input.Body.ActiveEnd,
			ActiveDays:      input.Body.ActiveDays,
			CheckInterval:   input.Body.CheckInterval,
			Status:          "IDLE",
		}

		agent, err := upsertAgent(ctx, store, arg)
		if err != nil {
			return nil, mapUpsertAgentError(err, ids.UserID, id)
		}

		updatePulseBridge(bridgeProvider, agent)

		return &struct{ Body AgentRecord }{Body: agent}, nil
	})
}

func validateAgentInput(input AgentInput) (string, error) {
	if err := validateCheckInterval(input.CheckInterval); err != nil {
		return "", err
	}
	if err := validateActiveDays(input.ActiveDays); err != nil {
		return "", err
	}
	if err := validateModelID(input.ModelID); err != nil {
		return "", err
	}
	return pulse.NormalizeTimezone(input.Timezone)
}

func enforceAutonomyLimit(ctx context.Context, store AgentStore, authCtx handler.AuthContext, userID int32, logUserID int, input AgentInput) error {
	if !input.AutonomyEnabled {
		return nil
	}
	if !autonomyFeatureEnabled(authCtx) {
		return huma.Error403Forbidden("Autonomous agents are not enabled for this account")
	}
	existingAgents, err := listAgentsByUserID(ctx, store, userID)
	if err != nil {
		slog.Error("List agents for limit check failed", "userId", logUserID, "error", err)
		return huma.Error500InternalServerError("Failed to check agent limits")
	}
	userPlan := "free"
	if authCtx.User.Plan != nil && *authCtx.User.Plan != "" {
		userPlan = *authCtx.User.Plan
	}
	if enabledAutonomyLimitExceeded(existingAgents, input.ID, userPlan) {
		return huma.Error422UnprocessableEntity(
			fmt.Sprintf("maximum of %d enabled autonomous agents per user exceeded", payments.AgentLimitForPlan(userPlan)),
		)
	}
	return nil
}

func resolveAgentID(ctx context.Context, store AgentStore, requestedID *string, userID int32) (string, error) {
	if requestedID == nil {
		id, err := newAgentID()
		if err != nil {
			return "", huma.Error500InternalServerError("Failed to generate agent ID")
		}
		return id, nil
	}

	id := *requestedID
	existing, err := getAgentByID(ctx, store, id)
	if err == nil && existing.UserID != userID {
		return "", huma.Error403Forbidden("You do not have permission to modify this agent")
	}
	return id, nil
}

func mapUpsertAgentError(err error, userID int, agentID string) error {
	var limitErr *AutonomyLimitError
	if errors.As(err, &limitErr) {
		return huma.Error422UnprocessableEntity(limitErr.Error())
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return huma.Error403Forbidden("You do not have permission to modify this agent")
	}
	slog.Error("Upsert agent failed", "userId", userID, "agentId", agentID, "error", err)
	return huma.Error500InternalServerError("Failed to save agent")
}

func updatePulseBridge(provider func() (BridgeRegistry, error), agent AgentRecord) {
	if provider == nil {
		return
	}
	bridge, err := provider()
	if err != nil {
		slog.Warn("Upsert agent succeeded, but pulse bridge provider failed", "agentId", agent.ID, "error", err)
		return
	}
	if bridge == nil {
		return
	}
	if agent.AutonomyEnabled {
		bridge.RegisterAgent(agent)
		return
	}
	bridge.UnregisterAgent(agent.ID)
}
