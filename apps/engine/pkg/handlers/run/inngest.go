package run

import (
	"context"
	"encoding/json"
	"log/slog"
	"math"
	"net/http"
	"os"
	"strings"
	"sync"

	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/go-engine/pkg/run"
	"github.com/danielgtaylor/huma/v2"
	"github.com/inngest/inngestgo"
)

var orchestrateTask = run.OrchestrateTask
var orchestratePulseTurn = run.OrchestratePulseTurn

var acquireTaskExecutionSlot = run.AcquireTaskExecutionSlot
var registerTaskExecuteInngestFunction = func(client inngestgo.Client, shutdownGroup *sync.WaitGroup) error {
	_, err := inngestgo.CreateFunction(
		client,
		inngestgo.FunctionOpts{
			ID:   "task-execute",
			Name: "Execute queued task",
		},
		inngestgo.EventTrigger("task.execute", nil),
		newTaskExecuteInngestFunction(shutdownGroup),
	)
	return err
}
var registerAgentPulseInngestFunction = func(client inngestgo.Client, shutdownGroup *sync.WaitGroup) error {
	_, err := inngestgo.CreateFunction(
		client,
		inngestgo.FunctionOpts{
			ID:   "agent-pulse",
			Name: "Execute agent pulse",
		},
		inngestgo.EventTrigger("agent.pulse", nil),
		newAgentPulseInngestFunction(shutdownGroup),
	)
	return err
}

type taskExecuteEventData struct {
	TaskID  string                     `json:"taskId"`
	UserID  int                        `json:"userId"`
	Prompt  string                     `json:"prompt"`
	ModelID string                     `json:"modelId"`
	Source  string                     `json:"source"`
	IsEval  bool                       `json:"isEval"`
	Options run.OrchestrateTaskOptions `json:"options"`
}

type agentPulseEventData struct {
	AgentID string `json:"agentId"`
	Reason  string `json:"reason"`
}

type inngestCallbackBody struct {
	Name string          `json:"name"`
	Data json.RawMessage `json:"data"`
}

type inngestTaskExecuteCallbackData struct {
	TaskID  string                    `json:"taskId"`
	UserID  float64                   `json:"userId"`
	Prompt  string                    `json:"prompt"`
	ModelID string                    `json:"modelId"`
	Source  string                    `json:"source"`
	IsEval  bool                      `json:"isEval"`
	Options inngestLenientTaskOptions `json:"options"`
	Opts    inngestLenientTaskOptions `json:"opts"`
}

type inngestLenientTaskOptions struct {
	value   run.OrchestrateTaskOptions
	set     bool
	invalid bool
	err     error
}

func (o *inngestLenientTaskOptions) UnmarshalJSON(data []byte) error {
	if len(data) == 0 || string(data) == "null" {
		return nil
	}
	var opts run.OrchestrateTaskOptions
	decodeErr := json.Unmarshal(data, &opts)
	if decodeErr != nil {
		o.invalid = true
		o.err = decodeErr
		//nolint:nilerr // Invalid legacy option payloads are logged and handled with default options.
		return nil
	}
	o.value = opts
	o.set = true
	return nil
}

func parseInngestTaskOptions(raw inngestTaskExecuteCallbackData) run.OrchestrateTaskOptions {
	options := raw.Options
	if !options.set && !options.invalid {
		options = raw.Opts
	}
	if options.set {
		return options.value
	}
	if options.invalid {
		slog.Warn("[Inngest] Failed to unmarshal task options, proceeding with defaults", "error", options.err, "taskId", raw.TaskID)
	}
	return run.OrchestrateTaskOptions{}
}

func parseInngestTaskExecuteData(data json.RawMessage) (taskExecuteEventData, error) {
	var raw inngestTaskExecuteCallbackData
	if err := json.Unmarshal(data, &raw); err != nil {
		return taskExecuteEventData{}, huma.Error400BadRequest("Missing or invalid task execution event data")
	}

	if raw.TaskID == "" {
		return taskExecuteEventData{}, huma.Error400BadRequest("Missing or invalid 'taskId' in event data")
	}
	if raw.UserID == 0 {
		return taskExecuteEventData{}, huma.Error400BadRequest("Missing or invalid 'userId' in event data")
	}
	if raw.UserID != math.Trunc(raw.UserID) {
		return taskExecuteEventData{}, huma.Error400BadRequest("'userId' must be an integer")
	}
	if raw.UserID < 1 || raw.UserID > math.MaxInt32 {
		return taskExecuteEventData{}, huma.Error400BadRequest("'userId' out of range")
	}
	if raw.Prompt == "" {
		return taskExecuteEventData{}, huma.Error400BadRequest("Missing or invalid 'prompt' in event data")
	}
	if raw.ModelID == "" {
		return taskExecuteEventData{}, huma.Error400BadRequest("Missing or invalid 'modelId' in event data")
	}

	opts := parseInngestTaskOptions(raw)
	opts.Source = raw.Source
	opts.IsEval = raw.IsEval

	return taskExecuteEventData{
		TaskID:  raw.TaskID,
		UserID:  int(raw.UserID),
		Prompt:  raw.Prompt,
		ModelID: raw.ModelID,
		Source:  raw.Source,
		IsEval:  raw.IsEval,
		Options: opts,
	}, nil
}

func shouldExecuteInngestCallbacksAsync() bool {
	return strings.TrimSpace(os.Getenv("INNGEST_DEV")) != ""
}

// RegisterInngestHandler registers the Inngest callback handler.
func RegisterInngestHandler(api huma.API, shutdownGroup *sync.WaitGroup) {
	huma.Register(api, huma.Operation{
		OperationID: "inngest-callback",
		Method:      http.MethodPost,
		Path:        "/api/inngest",
		Summary:     "Inngest callback handler",
		Tags:        []string{"Internal"},
	}, func(ctx context.Context, input *struct {
		Body inngestCallbackBody
	}) (*struct{ Body string }, error) {
		event := input.Body

		if event.Name == "agent.pulse" {
			var data agentPulseEventData
			if err := json.Unmarshal(event.Data, &data); err != nil {
				return nil, huma.Error400BadRequest("Missing or invalid agent pulse event data")
			}

			if err := executeInngestPulse(ctx, shutdownGroup, data.AgentID, data.Reason); err != nil {
				slog.Warn("[Inngest] Rejecting pulse due to task capacity", "agentId", data.AgentID, "limit", run.TaskExecutionSlotCapacity())
				return nil, huma.Error429TooManyRequests("Task execution capacity reached, retry later")
			}

			return &struct{ Body string }{Body: "ok"}, nil
		}

		if event.Name != "task.execute" {
			return &struct{ Body string }{Body: "ok"}, nil
		}

		data, err := parseInngestTaskExecuteData(event.Data)
		if err != nil {
			return nil, err
		}

		if err := executeInngestTask(ctx, shutdownGroup, data); err != nil {
			slog.Warn("[Inngest] Rejecting task due to task capacity", "taskId", data.TaskID, "limit", run.TaskExecutionSlotCapacity())
			return nil, huma.Error429TooManyRequests("Task execution capacity reached, retry later")
		}

		return &struct{ Body string }{Body: "ok"}, nil
	})
}

func NewInngestServeHandler(shutdownGroup *sync.WaitGroup) http.Handler {
	client, err := run.NewInngestSDKClient()
	if err != nil {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "Inngest is not configured", http.StatusServiceUnavailable)
		})
	}

	if err := registerTaskExecuteInngestFunction(client, shutdownGroup); err != nil {
		slog.Error("[Inngest] Failed to register task.execute function", "error", err)
	}

	if err := registerAgentPulseInngestFunction(client, shutdownGroup); err != nil {
		slog.Error("[Inngest] Failed to register agent.pulse function", "error", err)
	}

	return client.Serve()
}

func newTaskExecuteInngestFunction(shutdownGroup *sync.WaitGroup) func(context.Context, inngestgo.Input[taskExecuteEventData]) (any, error) {
	return func(ctx context.Context, input inngestgo.Input[taskExecuteEventData]) (any, error) {
		data := input.Event.Data
		data.Options.Source = data.Source
		data.Options.IsEval = data.IsEval
		return "ok", executeInngestTask(ctx, shutdownGroup, data)
	}
}

func newAgentPulseInngestFunction(shutdownGroup *sync.WaitGroup) func(context.Context, inngestgo.Input[agentPulseEventData]) (any, error) {
	return func(ctx context.Context, input inngestgo.Input[agentPulseEventData]) (any, error) {
		data := input.Event.Data
		return "ok", executeInngestPulse(ctx, shutdownGroup, data.AgentID, data.Reason)
	}
}

func executeInngestPulse(ctx context.Context, shutdownGroup *sync.WaitGroup, agentID, reason string) error {
	releaseTaskSlot, acquired := acquireTaskExecutionSlot()
	if !acquired {
		return run.ErrTaskExecutionCapacity
	}

	if shutdownGroup != nil {
		shutdownGroup.Add(1)
	}

	runPulse := func() {
		pulseCtx := context.WithoutCancel(ctx)
		defer releaseTaskSlot()
		if shutdownGroup != nil {
			defer shutdownGroup.Done()
		}
		orchestratePulseTurn(pulseCtx, agentID, reason)
	}

	if shouldExecuteInngestCallbacksAsync() {
		adapterhandler.Go("inngestPulse_"+agentID, runPulse)
		return nil
	}

	runPulse()
	return nil
}

func executeInngestTask(ctx context.Context, shutdownGroup *sync.WaitGroup, data taskExecuteEventData) error {
	releaseTaskSlot, acquired := acquireTaskExecutionSlot()
	if !acquired {
		return run.ErrTaskExecutionCapacity
	}

	if shutdownGroup != nil {
		shutdownGroup.Add(1)
	}

	// Production executes inside the callback request because Vercel can freeze
	// or terminate background goroutines once a serverless response returns.
	runTask := func() {
		taskCtx := context.WithoutCancel(ctx)
		defer releaseTaskSlot()
		if shutdownGroup != nil {
			defer shutdownGroup.Done()
		}
		orchestrateTask(taskCtx, data.TaskID, data.UserID, data.Prompt, data.ModelID, data.Options)
	}

	if shouldExecuteInngestCallbacksAsync() {
		adapterhandler.Go("inngestTask_"+data.TaskID, runTask)
		return nil
	}

	runTask()
	return nil
}
