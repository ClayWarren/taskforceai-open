package run

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/inngest/inngestgo"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/TaskForceAI/adapters/pkg/account"
	"github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/adapters/pkg/server"
	corechat "github.com/TaskForceAI/core/pkg/chat"
	coreengine "github.com/TaskForceAI/core/pkg/engine"
	handlercommon "github.com/TaskForceAI/go-engine/pkg/handlers/common"
	"github.com/TaskForceAI/go-engine/pkg/handlers/taskruntime"
	"github.com/TaskForceAI/go-engine/pkg/run"
)

type attachmentTempFile interface {
	io.Reader
	io.Writer
	io.Seeker
	io.Closer
	Name() string
}

var (
	createAttachmentTempFile = func() (attachmentTempFile, error) {
		return os.CreateTemp("", "taskforce-upload-*")
	}
	readAttachmentPreview = io.ReadFull
	copyAttachmentToTemp  = func(dst io.Writer, src io.Reader, maxBytes int64) (int64, error) {
		return io.Copy(dst, io.LimitReader(src, maxBytes))
	}
	attachmentByteLimit = coreengine.AttachmentByteLimit
)

var executionTracePayloadBudgetBytes = server.VercelFunctionSafeJSONPayloadBytes

// RunQueries defines the database operations needed by run handlers.
type RunQueries interface {
	GetOrganizationByID(ctx context.Context, id int32) (OrganizationRow, error)
	GetMembership(ctx context.Context, arg MembershipLookupInput) (MembershipRow, error)
	GetExecutionTrace(ctx context.Context, taskID string) (ExecutionTraceRow, error)
	GetAgent(ctx context.Context, id string) (AgentRow, error)
}

type MembershipLookupInput struct {
	OrganizationID int32
	UserID         int32
}

type MembershipRow = account.Membership

type OrganizationRow = account.Organization

type ExecutionTraceRow struct {
	ID        string
	TaskID    string
	UserID    *int32
	Goal      string
	Plan      []byte
	Steps     []byte
	SelfEval  []byte
	Report    []byte
	Artifacts []byte
	CreatedAt pgtype.Timestamp
}

type AgentRow struct {
	ID     string
	UserID int32
}

// TaskRegistry defines the operations used by run handlers.
type TaskRegistry interface {
	Register(taskID string, userID int, prompt, modelID string, opts run.OrchestrateTaskOptions) error
	Get(taskID string) *run.TaskState
}

var registryGetter = func() TaskRegistry {
	return run.GetRegistry()
}

var storeAttachmentsFn = storeAttachments

func detectTaskSource(userAgent string) string {
	source := "web"
	switch {
	case strings.Contains(userAgent, "taskforceai-cli"):
		source = "cli"
	case strings.Contains(userAgent, "TaskForceAI-Desktop"):
		source = "desktop"
	case strings.Contains(userAgent, "TaskForceAI-Mobile"):
		source = "mobile"
	}
	return source
}

// RegisterHandlers registers the run handlers.
func RegisterHandlers(api huma.API, q RunQueries, inngest run.InngestSender) {
	registerRunTaskHandler(api, q, inngest)
	registerActiveTasksHandler(api)
	registerAttachmentUploadHandler(api)
	registerPulseHandler(api, q, inngest)
	registerTraceHandler(api, q)
	registerApproveHandler(api)
	registerCancelHandler(api)
}

type taskLister interface {
	ListByUser(ctx context.Context, userID int, opts run.TaskListOptions) ([]run.TaskState, error)
}

type attachmentUploadFormData struct {
	File huma.FormFile `form:"file"`
}

func registerActiveTasksHandler(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "list-active-tasks",
		Method:      http.MethodGet,
		Path:        "/api/v1/tasks/active",
		Summary:     "List active tasks for the current user",
		Tags:        []string{"Tasks"},
	}, func(ctx context.Context, input *struct {
		Limit int `query:"limit" minimum:"1" maximum:"100" default:"25"`
		handler.SessionAuthContext
	}) (*struct{ Body *TaskListResponse }, error) {
		lister, ok := run.GetRegistry().(taskLister)
		if !ok {
			return &struct{ Body *TaskListResponse }{Body: &TaskListResponse{Tasks: []TaskSummary{}}}, nil
		}

		tasks, err := lister.ListByUser(ctx, input.User.ID, run.TaskListOptions{Limit: input.Limit})
		if err != nil {
			slog.Error("[RunHandler] Failed to list active tasks", "userId", input.User.ID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to list active tasks")
		}

		summaries := make([]TaskSummary, 0, len(tasks))
		for _, task := range tasks {
			summaries = append(summaries, taskSummaryFromState(task))
		}

		return &struct{ Body *TaskListResponse }{Body: &TaskListResponse{Tasks: summaries}}, nil
	})
}

func taskSummaryFromState(task run.TaskState) TaskSummary {
	summary := TaskSummary{
		TaskID:         task.TaskID,
		Status:         string(task.Status),
		Prompt:         task.Prompt,
		ModelID:        task.ModelID,
		Source:         task.Options.Source,
		ComputerUse:    task.Options.ComputerUseEnabled,
		ClientMCPTools: mapClientMCPTools(task.Options.ClientMCPTools),
		UpdatedAt:      task.UpdatedAt,
		ConversationID: task.ConversationID,
		TraceID:        task.TraceID,
		BudgetUsage:    task.BudgetUsage,
	}
	if task.PendingApproval != nil {
		summary.PendingApproval = &TaskApprovalSummary{
			ApprovalID: task.PendingApproval.ApprovalID,
			Permission: task.PendingApproval.Permission,
			AgentName:  task.PendingApproval.AgentName,
			Patterns:   task.PendingApproval.Patterns,
			Metadata:   task.PendingApproval.Metadata,
		}
	}
	return summary
}

func mapClientMCPTools(tools []run.ClientMCPTool) []TaskMCPToolSummary {
	if len(tools) == 0 {
		return nil
	}
	resp := make([]TaskMCPToolSummary, 0, len(tools))
	for _, tool := range tools {
		resp = append(resp, TaskMCPToolSummary{
			ServerName: tool.ServerName,
			ToolName:   tool.ToolName,
			Title:      tool.Title,
		})
	}
	return resp
}

func registerAttachmentUploadHandler(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "upload-attachment",
		Method:      http.MethodPost,
		Path:        "/api/v1/attachments/upload",
		Summary:     "Upload a binary attachment",
		Tags:        []string{"Tasks"},
	}, func(ctx context.Context, input *struct {
		RawBody huma.MultipartFormFiles[attachmentUploadFormData]
		handler.AuthContext
	}) (*attachmentUploadHandlerResponse, error) {
		if rateLimitErr := enforceAttachmentUploadRateLimit(ctx, input.User.Email, input.User.ID); rateLimitErr != nil {
			return nil, rateLimitErr
		}

		form := input.RawBody.Form
		if form != nil {
			defer func() { _ = form.RemoveAll() }()
		}
		return handleAttachmentUploadForm(ctx, input.User.ID, input.RawBody.Data())
	})
}

type attachmentUploadHandlerResponse struct {
	Body *AttachmentUploadResponse
}

func handleAttachmentUploadForm(ctx context.Context, userID int, formData *attachmentUploadFormData) (*attachmentUploadHandlerResponse, error) {
	uploadFile, err := requireAttachmentUploadFormData(formData)
	if err != nil {
		return nil, err
	}

	file := uploadFile.File
	defer func() { _ = file.Close() }()

	// 1. Detect content type using a small buffer
	head := make([]byte, 512)
	n, err := readAttachmentPreview(file, head)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return nil, huma.Error500InternalServerError("Failed to read file preview")
	}
	detectedType := http.DetectContentType(head[:n])
	if idx := strings.Index(detectedType, ";"); idx != -1 {
		detectedType = strings.TrimSpace(detectedType[:idx])
	}
	detectedType = run.NormalizeUploadedAttachmentMIME(uploadFile.Filename, detectedType)

	// 2. Stream to a temporary file to bound memory usage
	tempFile, err := createAttachmentTempFile()
	if err != nil {
		return nil, huma.Error500InternalServerError("Failed to create temporary store")
	}
	defer func() { _ = os.Remove(tempFile.Name()) }()
	defer func() { _ = tempFile.Close() }()

	// Write the header we already read
	if _, err := tempFile.Write(head[:n]); err != nil {
		return nil, huma.Error500InternalServerError("Failed to initialize temporary store")
	}

	// Copy the rest, enforcing the absolute max limit (Bug 13)
	maxBytes := int64(coreengine.MaxVideoAttachmentBytes) - int64(n)
	size, err := copyAttachmentToTemp(tempFile, file, maxBytes)
	if err != nil {
		return nil, huma.Error500InternalServerError("Failed to stream attachment to disk")
	}
	totalSize := size + int64(n)
	// When size == maxBytes, LimitReader may have stopped exactly at the limit.
	// We must check if there is more data beyond what was consumed to determine if
	// the file actually exceeds the budget. A file that exactly fills the limit is valid.
	if size == maxBytes {
		checkBuf := make([]byte, 1)
		if n, _ := file.Read(checkBuf); n > 0 {
			return nil, huma.Error400BadRequest("File too large")
		}
	}

	// 3. Enforce tiered limits based on detected type
	limit, _, _ := attachmentByteLimit(detectedType)
	if limit <= 0 {
		limit = int64(coreengine.MaxAttachmentBytes)
	}
	if totalSize > limit {
		return nil, huma.Error400BadRequest(fmt.Sprintf("File type %s exceeds limit of %d MB", detectedType, limit/(1024*1024)))
	}

	// 4. Final read for Redis storage (since the client expects []byte)
	// Note: Future improvement should stream directly to a blob store.
	if _, err := tempFile.Seek(0, 0); err != nil {
		return nil, huma.Error500InternalServerError("Failed to read from temporary store")
	}
	content, err := io.ReadAll(tempFile)
	if err != nil {
		return nil, huma.Error500InternalServerError("Failed to finalize attachment")
	}

	fileID := fmt.Sprintf("u:%d:%s", userID, uuid.New().String())
	if err := run.StoreAttachment(ctx, fileID, content, 10*time.Minute); err != nil {
		return nil, huma.Error500InternalServerError("Failed to store attachment in Redis")
	}
	if err := run.StoreAttachmentInfo(ctx, fileID, run.AttachmentInfo{
		MimeType: detectedType,
		Name:     uploadFile.Filename,
		Size:     totalSize,
	}, 10*time.Minute); err != nil {
		return nil, huma.Error500InternalServerError("Failed to store attachment metadata")
	}

	return &attachmentUploadHandlerResponse{Body: &AttachmentUploadResponse{
		ID:       fileID,
		MimeType: detectedType,
		Size:     totalSize,
	}}, nil
}

func requireAttachmentUploadFormData(formData *attachmentUploadFormData) (huma.FormFile, error) {
	if formData == nil {
		return huma.FormFile{}, missingAttachmentUploadFileError()
	}
	return requireAttachmentUploadFile(formData.File)
}

func requireAttachmentUploadFile(file huma.FormFile) (huma.FormFile, error) {
	if !file.IsSet || file.File == nil {
		return huma.FormFile{}, missingAttachmentUploadFileError()
	}
	return file, nil
}

func missingAttachmentUploadFileError() error {
	return huma.Error400BadRequest("Missing file")
}

func registerRunTaskHandler(api huma.API, q RunQueries, inngest run.InngestSender) {
	huma.Register(api, huma.Operation{
		OperationID: "run-task",
		Method:      http.MethodPost,
		Path:        "/api/v1/run",
		Summary:     "Run a task",
		Tags:        []string{"Tasks"},
	}, func(ctx context.Context, input *struct {
		Body      RunRequest
		UserAgent string `header:"User-Agent"`
		handler.AuthContext
	}) (*struct{ Body *RunResponse }, error) {
		source := detectTaskSource(input.UserAgent)
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		// 1. Rate Limiting
		if rateLimitErr := enforceRunRateLimit(ctx, input.User.Email, input.User.ID, input.OrgID); rateLimitErr != nil {
			return nil, rateLimitErr
		}

		modelID := strings.TrimSpace(input.Body.ModelID)
		reasoningEffort := strings.ToLower(strings.TrimSpace(input.Body.ReasoningEffort))
		if reasoningEffort != "" {
			if modelID == "" {
				return nil, huma.Error400BadRequest("modelId is required when reasoningEffort is set")
			}
			if err := corechat.ValidateReasoningEffort(modelID, reasoningEffort); err != nil {
				return nil, huma.Error400BadRequest(err.Error())
			}
		}

		attachments, unauthorizedAttachmentIDs := taskruntime.ResolveAttachmentsForUser(ctx, input.Body.AttachmentIDs, input.User.ID, func(attachmentID string, err error) {
			slog.Warn("[RunHandler] Failed to fetch attachment from Redis", "id", attachmentID, "error", err)
		})
		if len(unauthorizedAttachmentIDs) > 0 {
			return nil, huma.Error403Forbidden("One or more attachments are not accessible")
		}
		// Explicit policy: if the caller provided attachment IDs but none could be resolved,
		// reject the request rather than silently running with no context.
		if len(input.Body.AttachmentIDs) > 0 && len(attachments.Files) == 0 {
			return nil, huma.Error400BadRequest("None of the provided attachments could be resolved")
		}

		// 3. Task Params
		var projectID *int32
		if input.Body.ProjectID != 0 {
			if input.Body.ProjectID < math.MinInt32 || input.Body.ProjectID > math.MaxInt32 {
				return nil, huma.Error400BadRequest("Invalid project ID")
			}
			pID := int32(input.Body.ProjectID) // #nosec G115
			projectID = &pID
		}

		// Check no-training policy from the request and Org.
		noTraining := input.Body.PrivateChat
		var orgID *int32
		if ids.OrgID32 != nil {
			_, err := q.GetMembership(ctx, MembershipLookupInput{
				OrganizationID: *ids.OrgID32,
				UserID:         ids.UserID32,
			})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return nil, huma.Error403Forbidden("Unauthorized")
				}
				return nil, huma.Error500InternalServerError("Failed to verify organization access")
			}

			org, err := q.GetOrganizationByID(ctx, *ids.OrgID32)
			if err == nil {
				noTraining = noTraining || org.NoTraining
			}
			orgID = ids.OrgID32
		}

		requestedQuickMode, requestedQuickModeSet := taskruntime.ReadBoolOption(input.Body.Options, "quickModeEnabled")
		requestedAutonomy, _ := taskruntime.ReadBoolOption(input.Body.Options, "autonomyEnabled")
		requestedComputerUse, _ := taskruntime.ReadBoolOption(input.Body.Options, "computerUseEnabled")
		orchOpts := taskruntime.BuildOrchestrateTaskOptions(taskruntime.BuildOptionsParams{
			Options:          input.Body.Options,
			UserID:           ids.UserIDString,
			UserEmail:        input.User.Email,
			UserPlan:         input.User.Plan,
			IsAdmin:          input.User.IsAdmin,
			ProjectID:        projectID,
			OrgID:            orgID,
			NoTraining:       noTraining,
			QuickModeDefault: input.User.QuickModeEnabled,
			Source:           source,
			IsEval:           false,
			RoleModels:       input.Body.RoleModels,
			Budget:           input.Body.Budget,
			ReasoningEffort:  reasoningEffort,
		})

		slog.Info(
			"[RunHandler] Run submission accepted",
			"userId", input.User.ID,
			"orgId", input.OrgID,
			"source", source,
			"modelId", modelID,
			"isAdmin", input.User.IsAdmin,
			"quickMode", orchOpts.QuickModeEnabled,
			"requestedQuickMode", requestedQuickMode,
			"requestedQuickModeSet", requestedQuickModeSet,
			"autonomy", orchOpts.AutonomyEnabled,
			"requestedAutonomy", requestedAutonomy,
			"computerUse", orchOpts.ComputerUseEnabled,
			"computerUseTarget", orchOpts.ComputerUseTarget,
			"requestedComputerUse", requestedComputerUse,
			"computerUseDowngraded", requestedComputerUse && !orchOpts.ComputerUseEnabled,
			"privateChat", input.Body.PrivateChat,
			"attachmentCount", len(attachments.Files),
			"hasProject", projectID != nil,
		)

		submission, err := run.SubmitTask(ctx, run.TaskSubmissionRequest{
			UserID:         input.User.ID,
			Prompt:         input.Body.Prompt,
			ModelID:        modelID,
			Options:        orchOpts,
			Source:         source,
			IsEval:         false,
			IdempotencyKey: taskruntime.ReadStringOption(input.Body.Options, "idempotencyKey"),
			Attachments:    attachments,
		}, run.TaskSubmissionDeps{
			Registry: registryGetter(),
			Inngest:  inngest,
			StoreAttachments: func(ctx context.Context, attachments run.Attachments, taskID string) error {
				return storeAttachmentsFn(ctx, attachments, taskID)
			},
		})
		if err != nil {
			return nil, handlercommon.MapTaskSubmissionError(err, func(message string, args ...any) {
				slog.Error("[RunHandler] "+message, args...)
			})
		}

		slog.Info(
			"[RunHandler] Run submission queued",
			"taskId", submission.TaskID,
			"status", submission.Status,
			"userId", input.User.ID,
			"orgId", input.OrgID,
			"source", source,
			"modelId", modelID,
			"quickMode", orchOpts.QuickModeEnabled,
		)

		return &struct{ Body *RunResponse }{Body: runResponseFromSubmission(submission)}, nil
	})
}

func runResponseFromSubmission(submission run.TaskSubmissionResult) *RunResponse {
	response := &RunResponse{
		TaskID: submission.TaskID,
		Status: string(submission.Status),
	}
	if submission.Status != run.StatusCompleted {
		return response
	}

	task := registryGetter().Get(submission.TaskID)
	if task == nil {
		return response
	}
	if strings.TrimSpace(task.Result) != "" {
		response.Result = &task.Result
	}
	if task.ConversationID != 0 {
		response.ConversationID = &task.ConversationID
	}
	response.TraceID = task.TraceID
	return response
}

func registerPulseHandler(api huma.API, q RunQueries, inngest run.InngestSender) {
	huma.Register(api, huma.Operation{
		OperationID: "run-pulse",
		Method:      http.MethodPost,
		Path:        "/api/v1/run/pulse",
		Summary:     "Trigger a pulse turn for an agent",
		Tags:        []string{"Tasks"},
	}, func(ctx context.Context, input *struct {
		Body PulseRequest
		handler.AuthContext
	}) (*struct{ Body string }, error) {
		agent, err := q.GetAgent(ctx, input.Body.AgentID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, huma.Error404NotFound("Agent not found")
			}
			return nil, huma.Error500InternalServerError("Failed to verify agent access")
		}
		if int(agent.UserID) != input.User.ID {
			return nil, huma.Error403Forbidden("Unauthorized")
		}
		if rateLimitErr := enforcePulseRateLimit(ctx, input.User.Email, input.User.ID, input.OrgID); rateLimitErr != nil {
			return nil, rateLimitErr
		}

		// Queue the pulse turn via Inngest
		_, err = inngest.Send(ctx, inngestgo.GenericEvent[map[string]any]{
			Name: "agent.pulse",
			Data: map[string]any{
				"agentId": input.Body.AgentID,
				"reason":  input.Body.Reason,
				"ts":      input.Body.TS,
			},
		})
		if err != nil {
			slog.Error("Failed to queue pulse via Inngest", "agentId", input.Body.AgentID, "reason", input.Body.Reason, "error", err)
			return nil, huma.Error500InternalServerError("Failed to queue pulse")
		}

		return &struct{ Body string }{Body: "pulse queued"}, nil
	})
}

func registerTraceHandler(api huma.API, q RunQueries) {
	huma.Register(api, huma.Operation{
		OperationID: "get-execution-trace",
		Method:      http.MethodGet,
		Path:        "/api/v1/tasks/{taskId}/trace",
		Summary:     "Get execution trace for a task",
		Tags:        []string{"Tasks"},
	}, func(ctx context.Context, input *struct {
		TaskId string `path:"taskId"`
		handler.AuthContext
	}) (*struct{ Body *ExecutionTraceResponse }, error) {
		trace, err := q.GetExecutionTrace(ctx, input.TaskId)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, huma.Error404NotFound("Trace not found")
			}
			return nil, huma.Error500InternalServerError("Failed to fetch trace")
		}

		// Verify ownership
		// #nosec G115
		if trace.UserID == nil || int(*trace.UserID) != input.User.ID {
			return nil, huma.Error403Forbidden("Unauthorized")
		}

		// Map to response type
		resp := &ExecutionTrace{
			ID:        trace.ID,
			TaskID:    trace.TaskID,
			UserID:    trace.UserID,
			Goal:      trace.Goal,
			CreatedAt: trace.CreatedAt.Time.Format(time.RFC3339),
		}

		traceFields := []struct {
			name   string
			raw    []byte
			target *any
		}{
			{name: "plan", raw: trace.Plan, target: &resp.Plan},
			{name: "steps", raw: trace.Steps, target: &resp.Steps},
			{name: "self_eval", raw: trace.SelfEval, target: &resp.SelfEval},
			{name: "report", raw: trace.Report, target: &resp.Report},
			{name: "artifacts", raw: trace.Artifacts, target: &resp.Artifacts},
		}
		for _, field := range traceFields {
			decoded, decodeErr := decodeTraceJSONField(field.name, field.raw)
			if decodeErr != nil {
				slog.Error(
					"[RunHandler] Invalid execution trace field JSON",
					"taskId",
					input.TaskId,
					"field",
					field.name,
					"error",
					decodeErr,
				)
				return nil, huma.Error500InternalServerError("Failed to decode execution trace")
			}
			*field.target = decoded
		}

		response := &ExecutionTraceResponse{Trace: resp}
		if _, err := server.EnsureJSONPayloadWithinBudget(response, executionTracePayloadBudgetBytes); err != nil {
			slog.Error("[RunHandler] Execution trace exceeds payload budget", "taskId", input.TaskId, "error", err)
			return nil, server.PayloadTooLargeError("Execution trace is too large for inline retrieval")
		}

		return &struct{ Body *ExecutionTraceResponse }{Body: response}, nil
	})
}

func registerApproveHandler(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "approve-task-action",
		Method:      http.MethodPost,
		Path:        "/api/v1/tasks/{taskId}/approve",
		Summary:     "Approve or deny a pending task action",
		Tags:        []string{"Tasks"},
	}, func(ctx context.Context, input *struct {
		TaskId string `path:"taskId"`
		Body   ApproveTaskRequest
		handler.SessionAuthContext
	}) (*struct{ Body string }, error) {
		// 1. Verify task ownership
		task := run.GetRegistry().Get(input.TaskId)
		if task == nil {
			return nil, huma.Error404NotFound("Task not found")
		}
		if task.UserID != input.User.ID {
			return nil, huma.Error403Forbidden("Unauthorized")
		}
		if task.Status != run.StatusAwaiting || task.PendingApproval == nil {
			return nil, huma.Error409Conflict("Task is not awaiting approval")
		}

		decisionID := input.TaskId
		if task.PendingApproval.ApprovalID != "" {
			decisionID = task.PendingApproval.ApprovalID
		}

		// 2. Send decision via Redis Pub/Sub
		if err := run.SendApprovalDecision(ctx, decisionID, run.ApprovalDecision{
			Approved: input.Body.Approved,
			Result:   input.Body.Result,
			Error:    input.Body.Error,
		}); err != nil {
			if errors.Is(err, run.ErrApprovalDecisionPayloadTooLarge) {
				return nil, huma.Error400BadRequest("Approval decision payload exceeds size limit")
			}
			return nil, huma.Error500InternalServerError("Failed to send approval decision")
		}

		return &struct{ Body string }{Body: "Decision sent"}, nil
	})
}

func registerCancelHandler(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "cancel-task",
		Method:      http.MethodPost,
		Path:        "/api/v1/tasks/{taskId}/cancel",
		Summary:     "Cancel a running task",
		Tags:        []string{"Tasks"},
	}, func(ctx context.Context, input *struct {
		TaskId string `path:"taskId"`
		handler.AuthContext
	}) (*struct{ Body *RunResponse }, error) {
		task := run.GetRegistry().Get(input.TaskId)
		if task == nil {
			return nil, huma.Error404NotFound("Task not found")
		}
		if task.UserID != input.User.ID {
			return nil, huma.Error403Forbidden("Unauthorized")
		}
		if task.Status == run.StatusCompleted || task.Status == run.StatusFailed || task.Status == run.StatusCanceled {
			return &struct{ Body *RunResponse }{Body: runResponseFromTaskState(task)}, nil
		}

		if err := run.GetRegistry().Update(ctx, input.TaskId, run.StatusCanceled, "", "Run canceled"); err != nil {
			slog.Error("[RunHandler] Failed to cancel task", "taskId", input.TaskId, "error", err)
			return nil, huma.Error500InternalServerError("Failed to cancel task")
		}
		run.CancelTaskExecution(input.TaskId)

		canceled := run.GetRegistry().Get(input.TaskId)
		if canceled == nil {
			return nil, huma.Error404NotFound("Task not found")
		}

		return &struct{ Body *RunResponse }{Body: runResponseFromTaskState(canceled)}, nil
	})
}

func runResponseFromTaskState(task *run.TaskState) *RunResponse {
	response := &RunResponse{
		TaskID:  task.TaskID,
		Status:  string(task.Status),
		TraceID: task.TraceID,
	}
	if task.Result != "" {
		response.Result = &task.Result
	}
	if task.ConversationID != 0 {
		response.ConversationID = &task.ConversationID
	}
	return response
}

func storeAttachments(ctx context.Context, attachments run.Attachments, taskID string) error {
	return run.StoreAttachments(ctx, attachments, taskID)
}

func decodeTraceJSONField(fieldName string, data []byte) (any, error) {
	if len(data) == 0 {
		return nil, nil //nolint:nilnil // An empty trace field is a valid absent JSON value.
	}
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, fmt.Errorf("failed to decode trace %s: %w", fieldName, err)
	}
	return value, nil
}
