package webhooks

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	appdatabase "github.com/TaskForceAI/auth-service/pkg/database"
	postgres "github.com/TaskForceAI/infrastructure/postgres/pkg"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/jackc/pgx/v5"
	"github.com/workos/workos-go/v6/pkg/webhooks"
)

var (
	jsonMarshal      = json.Marshal
	getWebhookDBPool = postgres.GetPool
)

type WebhookValidator interface {
	ValidatePayload(signature string, body string) (string, error)
}

type WebhookReplayStore interface {
	SetNX(ctx context.Context, key string, value []byte, ttl time.Duration) (bool, error)
	Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
	Del(ctx context.Context, key string) (bool, error)
}

type workOSValidator struct {
	client *webhooks.Client
}

func (v *workOSValidator) ValidatePayload(signature string, body string) (string, error) {
	return v.client.ValidatePayload(signature, body)
}

type WorkOSWebhookHandlerStruct struct {
	Validator        WebhookValidator
	ReplayStore      WebhookReplayStore
	ReplayTTL        time.Duration
	DeactivateUser   func(ctx context.Context, q *db.Queries, email, workosOrgID string) error
	AddMembership    func(ctx context.Context, q *db.Queries, email, workosOrgID string) error
	RemoveMembership func(ctx context.Context, q *db.Queries, email, workosOrgID string) error
	GetQueries       func(ctx context.Context) (*db.Queries, error)
}

const replayKeyPrefix = "auth:webhook:workos:event:"
const deadLetterKeyPrefix = "auth:webhook:workos:dead:"
const deadLetterTTL = 7 * 24 * time.Hour
const workOSSignatureHeader = "Workos-Signature"

type deadLetterRecorder func(context.Context, error, string)

func isProductionEnv() bool {
	return handler.IsProductionEnv()
}

func markEventAsProcessed(
	ctx context.Context,
	store WebhookReplayStore,
	eventID string,
	ttl time.Duration,
) (bool, error) {
	if store == nil {
		return false, nil
	}
	if eventID == "" {
		return false, errors.New("missing webhook event id")
	}
	if ttl <= 0 {
		ttl = 24 * time.Hour
	}

	key := replayKeyPrefix + eventID
	created, err := store.SetNX(ctx, key, []byte("1"), ttl)
	if err != nil {
		return false, err
	}
	if !created {
		return true, nil
	}

	return false, nil
}

// WorkosUser matches the data structure in dsync webhooks
type WorkosUser struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
}

func (h *WorkOSWebhookHandlerStruct) recordDeadLetter(ctx context.Context, eventID, eventType string, cause error, reason string) {
	if h.ReplayStore == nil {
		return
	}
	payload, marshalErr := jsonMarshal(map[string]any{
		"event_id":   eventID,
		"event_type": eventType,
		"reason":     reason,
		"error":      cause.Error(),
		"failed_at":  time.Now().UTC().Format(time.RFC3339Nano),
	})
	if marshalErr != nil {
		handler.GetLogger().Error("Failed to marshal WorkOS dead-letter payload", map[string]any{
			"id":    eventID,
			"error": marshalErr.Error(),
		})
		return
	}
	if setErr := h.ReplayStore.Set(ctx, deadLetterKeyPrefix+eventID, payload, deadLetterTTL); setErr != nil {
		handler.GetLogger().Error("Failed to store WorkOS dead-letter payload", map[string]any{
			"id":    eventID,
			"error": setErr.Error(),
		})
		return
	}
	recordWorkOSWebhookDeadLetter(ctx, eventType, reason)
}

func (h *WorkOSWebhookHandlerStruct) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	startedAt := time.Now()
	ctx, webhookSpan := startWorkOSWebhookSpan(r.Context(), r)
	r = r.WithContext(ctx)
	eventType := ""
	outcome := "processed"
	var observationErr error
	defer func(observationCtx context.Context) {
		finishWorkOSWebhookObservation(observationCtx, webhookSpan, startedAt, eventType, outcome, observationErr)
	}(ctx)

	if r.Method != http.MethodPost {
		outcome = "method_not_allowed"
		handler.JSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	// Security: Limit request body size to prevent memory exhaustion (DoS)
	r.Body = http.MaxBytesReader(w, r.Body, handler.MaxBodySize)

	body, err := io.ReadAll(r.Body)
	if err != nil {
		outcome = "body_read_failed"
		observationErr = err
		handler.JSONError(w, http.StatusBadRequest, "Failed to read request body")
		return
	}

	// Verify the webhook signature
	payload, err := h.Validator.ValidatePayload(r.Header.Get(workOSSignatureHeader), string(body))
	if err != nil {
		handler.GetLogger().Warn("Invalid WorkOS webhook signature", map[string]any{"error": err})
		outcome = "invalid_signature"
		observationErr = err
		handler.JSONError(w, http.StatusUnauthorized, "Invalid signature")
		return
	}

	var event struct {
		ID             string          `json:"id"`
		Event          string          `json:"event"`
		OrganizationID string          `json:"organization_id"` // Some events have this at top level
		Data           json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal([]byte(payload), &event); err != nil {
		outcome = "invalid_event_json"
		observationErr = err
		handler.JSONError(w, http.StatusBadRequest, "Invalid event data")
		return
	}
	eventType = event.Event
	if event.ID == "" {
		outcome = "missing_event_id"
		handler.JSONError(w, http.StatusBadRequest, "Missing event id")
		return
	}

	recordDeadLetter := func(deadLetterCtx context.Context, cause error, reason string) {
		h.recordDeadLetter(deadLetterCtx, event.ID, event.Event, cause, reason)
	}

	if h.ReplayStore == nil && isProductionEnv() {
		handler.GetLogger().Error("Webhook replay store unavailable in production", nil)
		outcome = "replay_store_unavailable"
		handler.JSONError(w, http.StatusServiceUnavailable, "Service unavailable")
		return
	}

	q, ok := handler.RequireQueries(w, r, h.GetQueries)
	if !ok {
		outcome = "database_unavailable"
		return
	}

	duplicate, replayErr := markEventAsProcessed(ctx, h.ReplayStore, event.ID, h.ReplayTTL)
	if replayErr != nil {
		handler.GetLogger().Error("Failed to mark webhook event replay state", map[string]any{
			"error": replayErr.Error(),
			"id":    event.ID,
		})
		if isProductionEnv() {
			outcome = "replay_mark_failed"
			observationErr = replayErr
			handler.JSONError(w, http.StatusServiceUnavailable, "Service unavailable")
			return
		}
	} else if duplicate {
		handler.GetLogger().Warn("Acknowledged duplicate WorkOS webhook event", map[string]any{
			"id": event.ID,
		})
		outcome = "duplicate"
		w.WriteHeader(http.StatusOK)
		return
	}

	handler.GetLogger().Info("WorkOS Webhook received", map[string]any{"id": event.ID, "type": event.Event, "org": event.OrganizationID})

	outcome, observationErr = h.processEvent(ctx, w, q, event.ID, event.Event, event.OrganizationID, event.Data, recordDeadLetter)
}

func (h *WorkOSWebhookHandlerStruct) processEvent(
	ctx context.Context,
	w http.ResponseWriter,
	q *db.Queries,
	eventID, eventType, orgID string,
	eventData json.RawMessage,
	recordDeadLetter deadLetterRecorder,
) (string, error) {
	switch eventType {
	case "dsync.user.deleted", "dsync.user.deactivated":
		var data struct {
			Email string `json:"email"`
		}
		if err := json.Unmarshal(eventData, &data); err != nil || data.Email == "" {
			payloadErr := fmt.Errorf("invalid user payload")
			recordDeadLetter(ctx, payloadErr, "validation_failed")
			handler.JSONError(w, http.StatusBadRequest, "Invalid user payload")
			return "validation_failed", payloadErr
		}
		if err := h.DeactivateUser(ctx, q, data.Email, orgID); err != nil {
			h.handleApplyFailure(ctx, w, eventID, err, "deactivate_failed", "Failed to deactivate user from WorkOS webhook", recordDeadLetter)
			return "deactivate_failed", err
		}

	case "dsync.user.created":
		var user WorkosUser
		if err := json.Unmarshal(eventData, &user); err != nil || user.Email == "" {
			payloadErr := fmt.Errorf("invalid user payload")
			recordDeadLetter(ctx, payloadErr, "validation_failed")
			handler.JSONError(w, http.StatusBadRequest, "Invalid user payload")
			return "validation_failed", payloadErr
		}
		if err := h.AddMembership(ctx, q, user.Email, orgID); err != nil {
			h.handleApplyFailure(ctx, w, eventID, err, "membership_add_failed", "Failed to add user membership from WorkOS webhook", recordDeadLetter)
			return "membership_add_failed", err
		}

	case "dsync.group.user_added":
		var data struct {
			User WorkosUser `json:"user"`
		}
		if err := json.Unmarshal(eventData, &data); err != nil || data.User.Email == "" {
			payloadErr := fmt.Errorf("invalid membership payload")
			recordDeadLetter(ctx, payloadErr, "validation_failed")
			handler.JSONError(w, http.StatusBadRequest, "Invalid membership payload")
			return "validation_failed", payloadErr
		}
		if err := h.AddMembership(ctx, q, data.User.Email, orgID); err != nil {
			h.handleApplyFailure(ctx, w, eventID, err, "membership_add_failed", "Failed to add membership from WorkOS webhook", recordDeadLetter)
			return "membership_add_failed", err
		}

	case "dsync.group.user_removed":
		var data struct {
			User WorkosUser `json:"user"`
		}
		if err := json.Unmarshal(eventData, &data); err != nil || data.User.Email == "" {
			payloadErr := fmt.Errorf("invalid membership payload")
			recordDeadLetter(ctx, payloadErr, "validation_failed")
			handler.JSONError(w, http.StatusBadRequest, "Invalid membership payload")
			return "validation_failed", payloadErr
		}
		if err := h.RemoveMembership(ctx, q, data.User.Email, orgID); err != nil {
			h.handleApplyFailure(ctx, w, eventID, err, "membership_remove_failed", "Failed to remove membership from WorkOS webhook", recordDeadLetter)
			return "membership_remove_failed", err
		}
	default:
		w.WriteHeader(http.StatusOK)
		return "ignored_unsupported_event", nil
	}

	w.WriteHeader(http.StatusOK)
	return "processed", nil
}

func (h *WorkOSWebhookHandlerStruct) handleApplyFailure(
	ctx context.Context,
	w http.ResponseWriter,
	eventID string,
	err error,
	reason string,
	logMessage string,
	recordDeadLetter deadLetterRecorder,
) {
	recordDeadLetter(ctx, err, reason)
	if h.ReplayStore != nil {
		if _, delErr := h.ReplayStore.Del(ctx, replayKeyPrefix+eventID); delErr != nil {
			handler.GetLogger().Error("Failed to clear WorkOS webhook replay key after apply failure", map[string]any{"eventId": eventID, "error": delErr.Error()})
		}
	}
	handler.GetLogger().Error(logMessage, map[string]any{"error": err.Error()})
	handler.JSONError(w, http.StatusInternalServerError, "Failed to apply webhook")
}

func WorkOSHandler(w http.ResponseWriter, r *http.Request) {
	secret := os.Getenv("WORKOS_WEBHOOK_SECRET")
	if secret == "" {
		handler.GetLogger().Error("WORKOS_WEBHOOK_SECRET not configured", nil)
		handler.JSONError(w, http.StatusInternalServerError, "Server error")
		return
	}

	client := webhooks.NewClient(secret)
	h := &WorkOSWebhookHandlerStruct{
		Validator:        &workOSValidator{client: client},
		ReplayStore:      handler.GetRedisClient(),
		ReplayTTL:        24 * time.Hour,
		DeactivateUser:   handleUserDeactivated,
		AddMembership:    handleMembershipAdded,
		RemoveMembership: handleMembershipRemoved,
		GetQueries:       appdatabase.GetQueries,
	}
	h.ServeHTTP(w, r)
}

func handleUserDeactivated(ctx context.Context, q *db.Queries, email, workosOrgID string) error {
	if q == nil || workosOrgID == "" {
		return errors.New("missing organization or database")
	}

	org, user, found, err := resolveWorkOSMember(ctx, q, email, workosOrgID, "user deactivation")
	if err != nil || !found {
		return err
	}

	if err := deleteMembership(ctx, q, org, user); err != nil {
		return err
	}

	handler.GetLogger().Info("User membership removed via SCIM deactivation", map[string]any{
		"email": handler.MaskEmail(email),
		"org":   org.Slug,
	})
	return nil
}

func handleMembershipAdded(ctx context.Context, q *db.Queries, email, workosOrgID string) error {
	if q == nil || workosOrgID == "" {
		return errors.New("missing organization or database")
	}

	// 1. Resolve Org (read-only, outside tx)
	org, err := q.GetOrganizationByWorkosID(ctx, &workosOrgID)
	if err != nil {
		handler.GetLogger().Error("Failed to resolve org for membership sync", map[string]any{"workos_org": workosOrgID, "error": err})
		return err
	}

	if org.WorkosOrganizationID == nil || *org.WorkosOrganizationID != workosOrgID {
		return fmt.Errorf("organization mismatch: expected %s, got %v", workosOrgID, org.WorkosOrganizationID)
	}

	// 2. Atomically ensure user exists AND membership is created.
	// If CreateMembership fails after CreateUser the user row is rolled back,
	// keeping the DB consistent and preventing divergence during SCIM re-sync.
	var p postgres.Transactor
	if transactor, ok := q.GetDB().(postgres.Transactor); ok {
		p = transactor
	} else {
		p, err = getWebhookDBPool(ctx)
		if err != nil {
			return err
		}
	}

	return postgres.WithTx(ctx, p, func(tx pgx.Tx) error {
		txQ := q.WithTx(tx)

		user, err := txQ.GetUserByEmail(ctx, email)
		if err != nil {
			if !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
			// Create user if not found
			newUser, err := txQ.CreateUser(ctx, db.CreateUserParams{
				Email: email,
				Plan:  "free",
			})
			if err != nil {
				handler.GetLogger().Error("Failed to create user during SCIM sync", map[string]any{"email": handler.MaskEmail(email), "error": err})
				return err
			}
			user = newUser
		}

		// 3. Add membership
		if _, err := txQ.CreateMembership(ctx, db.CreateMembershipParams{
			OrganizationID: org.ID,
			UserID:         user.ID,
			Role:           db.OrganizationRoleMEMBER,
		}); err != nil {
			return err
		}

		handler.GetLogger().Info("User membership synced via SCIM", map[string]any{
			"email": handler.MaskEmail(email),
			"org":   org.Slug,
		})
		return nil
	})
}

func handleMembershipRemoved(ctx context.Context, q *db.Queries, email, workosOrgID string) error {
	if q == nil || workosOrgID == "" {
		return errors.New("missing organization or database")
	}

	org, user, found, err := resolveWorkOSMember(ctx, q, email, workosOrgID, "membership removal")
	if err != nil || !found {
		return err
	}

	if err := deleteMembership(ctx, q, org, user); err != nil {
		return err
	}

	handler.GetLogger().Info("User membership removed via SCIM", map[string]any{
		"email": handler.MaskEmail(email),
		"org":   org.Slug,
	})
	return nil
}

func resolveWorkOSMember(ctx context.Context, q *db.Queries, email, workosOrgID, action string) (db.Organization, db.User, bool, error) {
	org, err := q.GetOrganizationByWorkosID(ctx, &workosOrgID)
	if err != nil {
		return db.Organization{}, db.User{}, false, err
	}

	if org.WorkosOrganizationID == nil || *org.WorkosOrganizationID != workosOrgID {
		return db.Organization{}, db.User{}, false, fmt.Errorf("organization mismatch: expected %s, got %v", workosOrgID, org.WorkosOrganizationID)
	}

	user, err := q.GetUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			handler.GetLogger().Warn("User not found during SCIM "+action, map[string]any{"email": handler.MaskEmail(email)})
			return org, db.User{}, false, nil
		}
		return db.Organization{}, db.User{}, false, err
	}

	return org, user, true, nil
}

func deleteMembership(ctx context.Context, q *db.Queries, org db.Organization, user db.User) error {
	if err := q.DeleteMembership(ctx, db.DeleteMembershipParams{
		OrganizationID: org.ID,
		UserID:         user.ID,
	}); err != nil {
		return err
	}
	return nil
}
