package developer

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/adapters/pkg/server"
	"github.com/TaskForceAI/core/pkg/conversations"
	handlercommon "github.com/TaskForceAI/go-engine/pkg/handlers/common"
	runhandlers "github.com/TaskForceAI/go-engine/pkg/handlers/run"
	"github.com/TaskForceAI/go-engine/pkg/handlers/taskruntime"
	"github.com/TaskForceAI/go-engine/pkg/run"
)

// DeveloperQueries defines the DB operations needed by developer handlers.
type DeveloperQueries interface {
	GetMessagesByConversation(ctx context.Context, conversationID int32) ([]ThreadMessage, error)
	GetOrganizationByID(ctx context.Context, id int32) (runhandlers.OrganizationRow, error)
	GetMembership(ctx context.Context, arg runhandlers.MembershipLookupInput) (runhandlers.MembershipRow, error)
}

type ThreadMessage struct {
	ID             int32            `json:"id"`
	MessageID      string           `json:"message_id"`
	ConversationID int32            `json:"conversation_id"`
	Role           string           `json:"role"`
	Content        string           `json:"content"`
	IsStreaming    bool             `json:"is_streaming"`
	IsAgentStatus  bool             `json:"is_agent_status"`
	ElapsedSeconds *float64         `json:"elapsed_seconds"`
	CreatedAt      pgtype.Timestamp `json:"created_at"`
	Error          *string          `json:"error"`
	Sources        []byte           `json:"sources"`
	ToolEvents     []byte           `json:"tool_events"`
	AgentStatuses  []byte           `json:"agent_statuses"`
	VectorClock    []byte           `json:"vector_clock"`
	SyncVersion    int32            `json:"sync_version"`
	LastSyncedAt   pgtype.Timestamp `json:"last_synced_at"`
	DeviceID       *string          `json:"device_id"`
	IsDeleted      bool             `json:"is_deleted"`
	UpdatedAt      pgtype.Timestamp `json:"updated_at"`
	Rating         int32            `json:"rating"`
	Trace          []byte           `json:"trace"`
}

type ThreadMessageView struct {
	ID             int32                `json:"id"`
	MessageID      string               `json:"message_id"`
	ThreadID       int32                `json:"thread_id"`
	Role           string               `json:"role" enum:"user,assistant,system"`
	Content        string               `json:"content"`
	IsAgentStatus  bool                 `json:"is_agent_status"`
	ElapsedSeconds *float64             `json:"elapsed_seconds,omitempty"`
	CreatedAt      string               `json:"created_at,omitempty" format:"date-time"`
	Error          *string              `json:"error,omitempty"`
	Sources        sourceReferencesJSON `json:"sources,omitempty"`
	ToolEvents     toolUsageEventsJSON  `json:"tool_events,omitempty"`
	AgentStatuses  agentStatusesJSON    `json:"agent_statuses,omitempty"`
	UpdatedAt      string               `json:"updated_at,omitempty" format:"date-time"`
	Rating         int32                `json:"rating"`
}

type sourceReferencesJSON []byte
type toolUsageEventsJSON []byte
type agentStatusesJSON []byte

func marshalValidatedJSON(value []byte) ([]byte, error) {
	if len(value) == 0 {
		return []byte("null"), nil
	}
	return value, nil
}

func (value sourceReferencesJSON) MarshalJSON() ([]byte, error) {
	return marshalValidatedJSON(value)
}

func (sourceReferencesJSON) Schema(huma.Registry) *huma.Schema {
	return &huma.Schema{
		Type: huma.TypeArray,
		Items: &huma.Schema{
			Type:                 huma.TypeObject,
			AdditionalProperties: false,
			Properties: map[string]*huma.Schema{
				"title":   {Type: huma.TypeString},
				"url":     {Type: huma.TypeString},
				"snippet": {Type: huma.TypeString},
			},
		},
	}
}

func (value toolUsageEventsJSON) MarshalJSON() ([]byte, error) {
	return marshalValidatedJSON(value)
}

func (toolUsageEventsJSON) Schema(huma.Registry) *huma.Schema {
	return &huma.Schema{
		Type: huma.TypeArray,
		Items: &huma.Schema{
			Type:                 huma.TypeObject,
			AdditionalProperties: true,
			Properties: map[string]*huma.Schema{
				"timestamp":     {Type: huma.TypeString},
				"agentId":       {Type: huma.TypeInteger, Format: "int64"},
				"agentLabel":    {Type: huma.TypeString},
				"toolName":      {Type: huma.TypeString},
				"success":       {Type: huma.TypeBoolean},
				"durationMs":    {Type: huma.TypeInteger, Format: "int64"},
				"resultPreview": {Type: huma.TypeString},
				"error":         {Type: huma.TypeString},
			},
		},
	}
}

func (value agentStatusesJSON) MarshalJSON() ([]byte, error) {
	return marshalValidatedJSON(value)
}

func (agentStatusesJSON) Schema(huma.Registry) *huma.Schema {
	return &huma.Schema{
		Type: huma.TypeArray,
		Items: &huma.Schema{
			Type:                 huma.TypeObject,
			AdditionalProperties: false,
			Required:             []string{"status"},
			Properties: map[string]*huma.Schema{
				"status":    {Type: huma.TypeString},
				"agent_id":  {Type: huma.TypeInteger, Format: "int64"},
				"progress":  {Type: huma.TypeNumber, Format: "double"},
				"result":    {Type: huma.TypeString},
				"reasoning": {Type: huma.TypeString},
				"model":     {Type: huma.TypeString},
			},
		},
	}
}

// TaskRegistry defines the registry operations used by developer handlers.
type TaskRegistry interface {
	Register(taskID string, userID int, prompt, modelID string, opts run.OrchestrateTaskOptions) error
	Get(taskID string) *run.TaskState
}

var registryGetter = func() TaskRegistry {
	return run.GetRegistry()
}

// RunRequest represents a request to run a developer task.
type RunRequest struct {
	Prompt        string     `json:"prompt" minLength:"1" maxLength:"10000" doc:"Task prompt"`
	ModelID       string     `json:"modelId,omitempty" default:"zai/glm-5.2" minLength:"1" doc:"Model identifier"`
	Stream        bool       `json:"stream,omitempty" default:"false" doc:"Whether to stream response"`
	Options       RunOptions `json:"options,omitempty" doc:"Additional task options"`
	AttachmentIDs []string   `json:"attachment_ids,omitempty" maxItems:"5" doc:"List of attachment IDs"`
}

type RunOptions map[string]any

func (RunOptions) Schema(huma.Registry) *huma.Schema {
	zero := 0.0
	one := 1.0
	eight := 8.0
	return &huma.Schema{
		Type:                 huma.TypeObject,
		AdditionalProperties: true,
		Properties: map[string]*huma.Schema{
			"agentCount": {
				Type:    huma.TypeInteger,
				Default: 4,
				Minimum: &one,
				Maximum: &eight,
			},
			"silent":          {Type: huma.TypeBoolean, Default: false},
			"mock":            {Type: huma.TypeBoolean, Default: false},
			"autonomyEnabled": {Type: huma.TypeBoolean, Default: false},
			"budget": {
				Type:    huma.TypeNumber,
				Format:  "double",
				Minimum: &zero,
			},
		},
	}
}

type CreateThreadRequest struct {
	Title string `json:"title,omitempty" doc:"Thread title"`
}

type ThreadRunRequest struct {
	Prompt  string `json:"prompt" minLength:"1" doc:"Run prompt"`
	ModelID string `json:"modelId,omitempty" default:"zai/glm-5.2" minLength:"1" doc:"Model identifier"`
	Stream  bool   `json:"stream,omitempty" default:"false" doc:"Whether to stream"`
}

type threadMessagesResponse struct {
	Messages  []ThreadMessageView `json:"messages"`
	Truncated bool                `json:"truncated,omitempty"`
}

var developerResponsePayloadBudgetBytes = server.VercelFunctionSafeJSONPayloadBytes

// RegisterHandlers registers all developer-related handlers.
func RegisterHandlers(api huma.API, q DeveloperQueries, convService conversations.Service, inngest run.InngestSender) {
	h := &developerHandlers{q: q, convService: convService, inngest: inngest}

	huma.Register(api, handlercommon.APIKeyOperation("Developer", "developer-run-task", http.MethodPost, "/api/v1/developer/run", "Run a developer task"), h.RunTask)
	huma.Register(api, handlercommon.APIKeyOperation("Developer", "developer-get-task-status", http.MethodGet, "/api/v1/developer/status/{id}", "Get task status"), h.GetTaskStatus)
	huma.Register(api, handlercommon.APIKeyOperation("Developer", "developer-get-task-results", http.MethodGet, "/api/v1/developer/results/{id}", "Get task results"), h.GetTaskResults)
	huma.Register(api, handlercommon.APIKeyOperation("Developer", "developer-list-threads", http.MethodGet, "/api/v1/developer/threads", "List developer threads"), h.ListThreads)
	huma.Register(api, handlercommon.APIKeyOperation("Developer", "developer-create-thread", http.MethodPost, "/api/v1/developer/threads", "Create a new thread"), h.CreateThread)
	huma.Register(api, handlercommon.APIKeyOperation("Developer", "developer-get-thread", http.MethodGet, "/api/v1/developer/threads/{id}", "Get a developer thread"), h.GetThread)
	huma.Register(api, handlercommon.APIKeyOperation("Developer", "developer-get-thread-messages", http.MethodGet, "/api/v1/developer/threads/{id}/messages", "List messages in a thread"), h.GetThreadMessages)
	huma.Register(api, handlercommon.APIKeyOperation("Developer", "developer-run-thread", http.MethodPost, "/api/v1/developer/threads/{id}/runs", "Run a task on a thread"), h.RunThread)
}

type developerHandlers struct {
	q           DeveloperQueries
	convService conversations.Service
	inngest     run.InngestSender
}

func (h *developerHandlers) RunTask(ctx context.Context, input *struct {
	Body RunRequest
	handler.AuthContext
}) (*struct{ Body map[string]string }, error) {
	ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
	if err != nil {
		return nil, err
	}
	if rateLimitErr := runhandlers.EnforceRunRateLimit(ctx, input.User.Email, input.User.ID, input.OrgID, taskruntime.ResolveRateLimitPlan(input.User.Plan)); rateLimitErr != nil {
		return nil, rateLimitErr
	}
	orgID, noTraining, err := h.resolveOrgPolicy(ctx, ids)
	if err != nil {
		return nil, err
	}

	isEval, _ := taskruntime.ReadBoolOption(input.Body.Options, "eval")
	if noTraining {
		isEval = false
	}
	orchOpts := taskruntime.BuildOrchestrateTaskOptions(taskruntime.BuildOptionsParams{
		Options:    input.Body.Options,
		UserID:     ids.UserIDString,
		UserEmail:  input.User.Email,
		UserPlan:   input.User.Plan,
		IsAdmin:    input.User.IsAdmin,
		OrgID:      orgID,
		NoTraining: noTraining,
		Source:     "developer",
		IsEval:     isEval,
	})

	modelID := strings.TrimSpace(input.Body.ModelID)
	attachments, unauthorizedAttachmentIDs := taskruntime.ResolveAttachmentsForUser(ctx, input.Body.AttachmentIDs, input.User.ID, nil)
	if len(unauthorizedAttachmentIDs) > 0 {
		return nil, huma.Error403Forbidden("One or more attachments are not accessible")
	}
	if len(input.Body.AttachmentIDs) > 0 && len(attachments.Files) == 0 {
		return nil, huma.Error400BadRequest("None of the provided attachments could be resolved")
	}

	submission, err := run.SubmitTask(ctx, run.TaskSubmissionRequest{
		UserID:      input.User.ID,
		Prompt:      input.Body.Prompt,
		ModelID:     modelID,
		Options:     orchOpts,
		Source:      "developer",
		IsEval:      isEval,
		Attachments: attachments,
	}, run.TaskSubmissionDeps{
		Registry:         registryGetter(),
		Inngest:          h.inngest,
		StoreAttachments: run.StoreAttachments,
	})
	if err != nil {
		return nil, handlercommon.MapTaskSubmissionError(err, nil)
	}

	return &struct{ Body map[string]string }{Body: map[string]string{
		"taskId": submission.TaskID,
		"status": string(submission.Status),
	}}, nil
}

func (h *developerHandlers) GetTaskStatus(ctx context.Context, input *struct {
	ID string `path:"id" doc:"Task ID"`
	handler.AuthContext
}) (*struct{ Body *run.TaskState }, error) {
	task := registryGetter().Get(input.ID)
	if task == nil || task.UserID != input.User.ID {
		return nil, huma.Error404NotFound("Task not found")
	}

	responseTask := *task
	if err := fitTaskStatusWithinPayloadBudget(&responseTask); err != nil {
		if errors.Is(err, server.ErrPayloadBudgetExceeded) {
			return nil, server.PayloadTooLargeError("Task status is too large for inline retrieval")
		}
		return nil, huma.Error500InternalServerError("Failed to prepare task status")
	}

	return &struct{ Body *run.TaskState }{Body: &responseTask}, nil
}

func fitTaskStatusWithinPayloadBudget(task *run.TaskState) error {
	if _, err := server.EnsureJSONPayloadWithinBudget(task, developerResponsePayloadBudgetBytes); err == nil {
		return nil
	} else if !errors.Is(err, server.ErrPayloadBudgetExceeded) {
		return err
	}

	task.Result = ""
	task.AgentStatuses = nil
	task.ToolEvents = nil
	if task.PendingApproval != nil {
		pendingApproval := *task.PendingApproval
		pendingApproval.Metadata = nil
		task.PendingApproval = &pendingApproval
	}
	_, err := server.EnsureJSONPayloadWithinBudget(task, developerResponsePayloadBudgetBytes)
	return err
}

func (h *developerHandlers) GetTaskResults(ctx context.Context, input *struct {
	ID string `path:"id" doc:"Task ID"`
	handler.AuthContext
}) (*struct{ Body map[string]any }, error) {
	task := registryGetter().Get(input.ID)
	if task == nil || task.UserID != input.User.ID {
		return nil, huma.Error404NotFound("Task not found")
	}

	if task.Status != run.StatusCompleted {
		return &struct{ Body map[string]any }{Body: map[string]any{"status": string(task.Status)}}, nil
	}

	response := map[string]any{
		"taskId": task.TaskID,
		"status": task.Status,
		"result": task.Result,
	}
	if _, err := server.EnsureJSONPayloadWithinBudget(response, developerResponsePayloadBudgetBytes); err != nil {
		return nil, server.PayloadTooLargeError("Task result is too large for inline retrieval")
	}

	return &struct{ Body map[string]any }{Body: response}, nil
}

func (h *developerHandlers) ListThreads(ctx context.Context, input *struct {
	handler.AuthContext
}) (*struct {
	Body *conversations.ConversationsPage
}, error) {
	var orgID *int
	if input.OrgID != 0 {
		orgID = &input.OrgID
	}
	page, err := h.convService.ListConversations(ctx, strconv.Itoa(input.User.ID), orgID, 20, 0)
	if err != nil {
		return nil, huma.Error500InternalServerError("Failed to fetch threads")
	}
	return &struct {
		Body *conversations.ConversationsPage
	}{Body: page}, nil
}

func (h *developerHandlers) CreateThread(ctx context.Context, input *struct {
	Body CreateThreadRequest
	handler.AuthContext
}) (*struct {
	Body *conversations.ConversationApiView
}, error) {
	var orgID *int
	if input.OrgID != 0 {
		orgID = &input.OrgID
	}
	conv, err := h.convService.CreateConversation(ctx, conversations.ConversationCreateInput{
		UserID:         strconv.Itoa(input.User.ID),
		OrganizationID: orgID,
		UserInput:      input.Body.Title,
	})
	if err != nil {
		return nil, huma.Error500InternalServerError("Failed to create thread")
	}
	return &struct {
		Body *conversations.ConversationApiView
	}{Body: conv}, nil
}

func (h *developerHandlers) GetThread(ctx context.Context, input *struct {
	ID int `path:"id" doc:"Thread ID"`
	handler.AuthContext
}) (*struct {
	Body *conversations.ConversationApiView
}, error) {
	thread, err := h.getThread(ctx, input.User.ID, input.OrgID, input.ID)
	if err != nil {
		return nil, err
	}
	return &struct {
		Body *conversations.ConversationApiView
	}{Body: thread}, nil
}

func (h *developerHandlers) GetThreadMessages(ctx context.Context, input *struct {
	ID int `path:"id" doc:"Thread ID"`
	handler.AuthContext
}) (*struct{ Body threadMessagesResponse }, error) {
	if _, err := h.getThread(ctx, input.User.ID, input.OrgID, input.ID); err != nil {
		return nil, err
	}

	msgs, err := h.q.GetMessagesByConversation(ctx, int32(input.ID)) // #nosec G115
	if err != nil {
		return nil, huma.Error500InternalServerError("Failed to fetch messages")
	}
	publicMessages := threadMessageViews(msgs)
	publicMessages, truncated, _, err := server.TrimSliceForJSONBudget(publicMessages, func(items []ThreadMessageView) any {
		return threadMessagesResponse{Messages: items, Truncated: true}
	}, developerResponsePayloadBudgetBytes)
	if err != nil {
		return nil, server.PayloadTooLargeError("Thread messages are too large for inline retrieval")
	}
	return &struct{ Body threadMessagesResponse }{Body: threadMessagesResponse{Messages: publicMessages, Truncated: truncated}}, nil
}

func threadMessageViews(messages []ThreadMessage) []ThreadMessageView {
	views := make([]ThreadMessageView, 0, len(messages))
	for _, message := range messages {
		views = append(views, ThreadMessageView{
			ID:             message.ID,
			MessageID:      message.MessageID,
			ThreadID:       message.ConversationID,
			Role:           message.Role,
			Content:        message.Content,
			IsAgentStatus:  message.IsAgentStatus,
			ElapsedSeconds: message.ElapsedSeconds,
			CreatedAt:      formatThreadMessageTimestamp(message.CreatedAt),
			Error:          message.Error,
			Sources:        sourceReferencesJSON(validRawJSON(message.Sources)),
			ToolEvents:     toolUsageEventsJSON(validRawJSON(message.ToolEvents)),
			AgentStatuses:  agentStatusesJSON(validRawJSON(message.AgentStatuses)),
			UpdatedAt:      formatThreadMessageTimestamp(message.UpdatedAt),
			Rating:         message.Rating,
		})
	}
	return views
}

func formatThreadMessageTimestamp(ts pgtype.Timestamp) string {
	if !ts.Valid {
		return ""
	}
	return ts.Time.UTC().Format(time.RFC3339Nano)
}

func validRawJSON(data []byte) json.RawMessage {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 || !json.Valid(trimmed) {
		return nil
	}
	return json.RawMessage(trimmed)
}

func (h *developerHandlers) RunThread(ctx context.Context, input *struct {
	ID   int `path:"id" doc:"Thread ID"`
	Body ThreadRunRequest
	handler.AuthContext
}) (*struct{ Body map[string]string }, error) {
	ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
	if err != nil {
		return nil, err
	}
	if rateLimitErr := runhandlers.EnforceRunRateLimit(ctx, input.User.Email, input.User.ID, input.OrgID, taskruntime.ResolveRateLimitPlan(input.User.Plan)); rateLimitErr != nil {
		return nil, rateLimitErr
	}
	orgID, noTraining, err := h.resolveOrgPolicy(ctx, ids)
	if err != nil {
		return nil, err
	}
	thread, err := h.getThread(ctx, input.User.ID, input.OrgID, input.ID)
	if err != nil {
		return nil, err
	}
	threadID := int32(input.ID) // #nosec G115 -- getThread rejects values outside int32.
	if h.q == nil {
		return nil, huma.Error500InternalServerError("Failed to fetch thread context")
	}
	messages, err := h.q.GetMessagesByConversation(ctx, threadID)
	if err != nil {
		return nil, huma.Error500InternalServerError("Failed to fetch thread context")
	}

	orchOpts := taskruntime.BuildOrchestrateTaskOptions(taskruntime.BuildOptionsParams{
		UserID:     ids.UserIDString,
		UserEmail:  input.User.Email,
		UserPlan:   input.User.Plan,
		IsAdmin:    input.User.IsAdmin,
		OrgID:      orgID,
		NoTraining: noTraining,
		Source:     "developer",
	})
	orchOpts.ConversationID = &threadID
	orchOpts.ThreadContext = buildThreadContext(thread, messages)
	modelID := strings.TrimSpace(input.Body.ModelID)
	submission, err := run.SubmitTask(ctx, run.TaskSubmissionRequest{
		UserID:  input.User.ID,
		Prompt:  input.Body.Prompt,
		ModelID: modelID,
		Options: orchOpts,
		Source:  "developer",
	}, run.TaskSubmissionDeps{
		Registry: registryGetter(),
		Inngest:  h.inngest,
	})
	if err != nil {
		return nil, handlercommon.MapTaskSubmissionError(err, nil)
	}

	return &struct{ Body map[string]string }{Body: map[string]string{
		"taskId":   submission.TaskID,
		"status":   string(submission.Status),
		"threadId": strconv.Itoa(input.ID),
	}}, nil
}

func buildThreadContext(thread *conversations.ConversationApiView, messages []ThreadMessage) string {
	const maxThreadContextBytes = 64 * 1024
	var contextBuilder strings.Builder
	appendTurn := func(role, content string) {
		content = strings.TrimSpace(content)
		if content == "" || contextBuilder.Len() >= maxThreadContextBytes {
			return
		}
		remaining := maxThreadContextBytes - contextBuilder.Len()
		turn := strings.TrimSpace(role) + ": " + content + "\n"
		if len(turn) > remaining {
			turn = turn[:remaining]
		}
		contextBuilder.WriteString(turn)
	}

	if thread != nil {
		appendTurn("user", thread.UserInput)
	}
	for _, message := range messages {
		appendTurn(message.Role, message.Content)
	}
	if len(messages) == 0 && thread != nil {
		appendTurn("assistant", thread.Result)
	}
	return strings.TrimSpace(contextBuilder.String())
}

func (h *developerHandlers) getThread(
	ctx context.Context,
	userID int,
	orgID int,
	threadID int,
) (*conversations.ConversationApiView, error) {
	if threadID > math.MaxInt32 {
		return nil, huma.Error404NotFound("Thread not found")
	}

	var orgFilter *int
	if orgID != 0 {
		orgFilter = &orgID
	}

	thread, err := h.convService.GetConversation(ctx, strconv.Itoa(userID), orgFilter, threadID)
	if err != nil || thread == nil {
		return nil, huma.Error404NotFound("Thread not found")
	}

	return thread, nil
}

func (h *developerHandlers) resolveOrgPolicy(ctx context.Context, ids handler.AuthIDs) (*int32, bool, error) {
	if ids.OrgID32 == nil {
		return nil, false, nil
	}
	if h.q == nil {
		return nil, false, huma.Error500InternalServerError("Failed to verify organization access")
	}
	_, err := h.q.GetMembership(ctx, runhandlers.MembershipLookupInput{
		OrganizationID: *ids.OrgID32,
		UserID:         ids.UserID32,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, false, huma.Error403Forbidden("Unauthorized")
		}
		return nil, false, huma.Error500InternalServerError("Failed to verify organization access")
	}
	org, err := h.q.GetOrganizationByID(ctx, *ids.OrgID32)
	if err != nil {
		return nil, false, huma.Error500InternalServerError("Failed to load organization policy")
	}
	return ids.OrgID32, org.NoTraining, nil
}
