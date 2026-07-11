package agent

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/core/pkg/engine"
	enginecoreconfig "github.com/TaskForceAI/core/pkg/enginecore/config"
	enginecore "github.com/TaskForceAI/core/pkg/enginecore/core"
	enginecorepermission "github.com/TaskForceAI/core/pkg/enginecore/permission"
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	enginecoreutil "github.com/TaskForceAI/core/pkg/enginecore/util"
	"github.com/TaskForceAI/core/pkg/hitl"
	"github.com/TaskForceAI/core/pkg/platform"
	"github.com/TaskForceAI/core/pkg/tools"
	"github.com/TaskForceAI/core/pkg/tools/google"
)

type GatewayAgent struct {
	config               config.Config
	client               ILLMClient
	agentID              int
	agentLabel           string
	taskID               string
	temperature          *float64
	reasoningEffort      string
	usageLogger          UsageLogger
	toolLogger           ToolLogger
	registry             *tools.ToolRegistry
	webSearchEnabled     bool
	codeExecutionEnabled bool
	computerUseEnabled   bool
	googleDriveClient    any
	rawSystemPrompt      bool
	ApprovalRegistry     any // IApprovalRegistry
	OnReasoning          func(string)

	// Team integration
	TeamInbox TeamInbox
	TeamName  string
	AgentName string
}

type TeamInbox interface {
	Unread(teamName, agentName string) ([]InboxMessage, error)
	MarkRead(teamName, agentName string) ([]InboxMessage, error)
}

type InboxMessage struct {
	ID        string `json:"id"`
	From      string `json:"from"`
	Text      string `json:"text"`
	Timestamp int64  `json:"timestamp"`
	Read      bool   `json:"read"`
}

type IFileUploader interface {
	UploadFile(ctx context.Context, reader io.Reader, filename, mimeType string) (string, error)
}

type AgentOptions struct {
	AgentID              int
	AgentLabel           string
	TaskID               string
	Temperature          *float64
	UsageLogger          UsageLogger
	ToolLogger           ToolLogger
	Registry             *tools.ToolRegistry
	WebSearchEnabled     bool
	CodeExecutionEnabled bool
	ComputerUseEnabled   bool
	GoogleDriveClient    any
	RawSystemPrompt      bool
	ApprovalRegistry     any // IApprovalRegistry
	OnReasoning          func(string)

	// Team integration
	TeamInbox TeamInbox
	TeamName  string
	AgentName string
}

func NewGatewayAgent(cfg config.Config, client ILLMClient, opts AgentOptions) *GatewayAgent {
	id := opts.AgentID
	label := opts.AgentLabel
	if label == "" {
		label = "agent"
	}
	temperature := opts.Temperature
	if temperature == nil {
		temperature = cfg.Agent.Temperature
	}
	uLogger := opts.UsageLogger
	tLogger := opts.ToolLogger
	taskID := opts.TaskID
	reg := opts.Registry
	webSearch := opts.WebSearchEnabled
	codeExec := opts.CodeExecutionEnabled
	computerUse := opts.ComputerUseEnabled
	driveClient := opts.GoogleDriveClient
	rawSystemPrompt := opts.RawSystemPrompt
	approvalRegistry := opts.ApprovalRegistry

	return &GatewayAgent{
		config:               cfg,
		client:               client,
		agentID:              id,
		agentLabel:           label,
		taskID:               taskID,
		temperature:          temperature,
		reasoningEffort:      cfg.Agent.ReasoningEffort,
		usageLogger:          uLogger,
		toolLogger:           tLogger,
		registry:             reg,
		webSearchEnabled:     webSearch,
		codeExecutionEnabled: codeExec,
		computerUseEnabled:   computerUse,
		googleDriveClient:    driveClient,
		rawSystemPrompt:      rawSystemPrompt,
		ApprovalRegistry:     approvalRegistry,
		OnReasoning:          opts.OnReasoning,
		TeamInbox:            opts.TeamInbox,
		TeamName:             opts.TeamName,
		AgentName:            opts.AgentName,
	}
}

// RunMultimodal runs the agent with image content parts in the initial user message.
// Subsequent tool-loop messages are text-only.
func (a *GatewayAgent) RunMultimodal(ctx context.Context, input string, images []ContentPart, onChunk func(string)) (string, error) {
	return a.runWithEngine(ctx, input, images, onChunk)
}

func (a *GatewayAgent) Run(ctx context.Context, input string, onChunk func(string)) (string, error) {
	return a.runWithEngine(ctx, input, nil, onChunk)
}

func (a *GatewayAgent) runWithEngine(ctx context.Context, input string, images []ContentPart, onChunk func(string)) (string, error) {
	systemPrompt := a.buildSystemPrompt()
	toolsDef := a.buildToolsDefinition()
	messages := a.buildInitialMessages(systemPrompt, input, images)

	stream := newAgentStream(agentStreamOptions{
		ctx:                      ctx,
		client:                   a.client,
		model:                    a.config.Gateway.Model,
		temperature:              a.temperature,
		reasoningEffort:          a.reasoningEffort,
		tools:                    toolsDef,
		messages:                 messages,
		maxIterations:            a.maxIterations(),
		agentLabel:               a.agentLabel,
		usageLogger:              a.usageLogger,
		toolLogger:               a.toolLogger,
		handlerDeps:              a.buildToolHandlerDeps(),
		requireGeneratedFileTool: requiresGeneratedFileTool(systemPrompt, toolsDef),
		onChunk:                  onChunk,
		onReasoning:              a.OnReasoning,
		TeamInbox:                a.TeamInbox,
		TeamName:                 a.TeamName,
		AgentName:                a.AgentName,
	})

	eng := engine.New(a.engineOptions(ctx))
	transcript, err := eng.RunStream(ctx, engine.RunInput{
		SessionID:  a.sessionID(),
		Prompt:     input,
		Stream:     stream,
		System:     systemSlice(systemPrompt),
		UserSystem: "",
		Cwd:        "",
		Root:       "",
	})
	if err != nil {
		platform.GetLogger().Error("Agent execution failed", "agentLabel", a.agentLabel, "error", err)
		return "", err
	}
	text := transcriptText(transcript)
	platform.GetLogger().Info("Agent execution completed", "agentLabel", a.agentLabel, "resultLen", len(text))
	return text, nil
}

func requiresGeneratedFileTool(systemPrompt string, toolsDef []ToolDefinition) bool {
	if !strings.Contains(systemPrompt, "file-generation specialist") {
		return false
	}
	for _, tool := range toolsDef {
		if isGeneratedFileToolName(tool.Function.Name) {
			return true
		}
	}
	return false
}

func (a *GatewayAgent) engineOptions(ctx context.Context) engine.Options {
	opts := engine.Options{
		Instruction: enginecore.InstructionLoader{RootDir: enginecoreutil.Worktree()},
	}
	info, err := enginecoreconfig.Get()
	if err == nil && info != nil && info.Permission != nil {
		perms := enginecorepermission.CheckerFromConfig(map[string]any(info.Permission))
		if perms != nil {
			opts.Permission = perms
		}
	}
	if opts.Permission == nil {
		// Gateway agents are single-turn and tools are filtered by registry; default allow avoids
		// blocking in headless runs. Revisit if multi-turn or broader tool scopes are added.
		opts.Permission = &enginecorepermission.RuleBasedPermission{
			Rules:         enginecorepermission.DefaultRules(),
			DefaultAction: enginecorepermission.PermissionAllow,
		}
	}

	// Wrap with HITL if registry is provided
	if a.ApprovalRegistry != nil && a.taskID != "" {
		if reg, ok := a.ApprovalRegistry.(IApprovalRegistry); ok {
			opts.Permission = NewHITLPermissionChecker(ctx, opts.Permission, reg, a.taskID, a.AgentName)
		}
	}

	// Cost, Store, and Compaction are intentionally left unset for single-turn gateway usage.
	return opts
}

type ApprovalRequest = hitl.ApprovalRequest
type IApprovalRegistry = hitl.ApprovalRegistry
type HITLPermissionChecker = hitl.PermissionChecker

func NewHITLPermissionChecker(ctx context.Context, base protocol.PermissionChecker, registry IApprovalRegistry, taskID string, agent string) *HITLPermissionChecker {
	return hitl.NewPermissionChecker(ctx, base, registry, taskID, agent)
}

func (a *GatewayAgent) sessionID() string {
	return fmt.Sprintf("gateway_%d", time.Now().UnixNano())
}

func (a *GatewayAgent) buildInitialMessages(systemPrompt string, input string, images []ContentPart) []ChatCompletionMessage {
	systemMsg := ChatCompletionMessage{Role: RoleSystem, Content: systemPrompt}
	if cacheableSystemPrompt(systemPrompt) {
		systemMsg.CacheControl = &CacheControl{Type: "ephemeral"}
	}
	if len(images) == 0 {
		return []ChatCompletionMessage{
			systemMsg,
			{Role: RoleUser, Content: input},
		}
	}
	parts := make([]ContentPart, 0, 1+len(images))
	parts = append(parts, ContentPart{Type: ContentPartText, Text: input})
	parts = append(parts, images...)
	userMsg := ChatCompletionMessage{
		Role:         RoleUser,
		ContentParts: parts,
	}
	return []ChatCompletionMessage{systemMsg, userMsg}
}

func cacheableSystemPrompt(systemPrompt string) bool {
	return approximatePromptTokens(systemPrompt) >= 1024
}

func approximatePromptTokens(prompt string) int {
	words := len(strings.Fields(prompt))
	chars := len([]rune(prompt))
	wordEstimate := (words*4 + 2) / 3
	charEstimate := (chars + 3) / 4
	return max(wordEstimate, charEstimate)
}

func (a *GatewayAgent) buildSystemPrompt() string {
	currentDate := currentDateSystemInstruction(time.Now())
	if a.rawSystemPrompt {
		return strings.TrimSpace(strings.Join(filterEmpty([]string{
			a.config.SystemPrompt,
			currentDate,
		}), "\n\n"))
	}
	model := parseProviderModel(a.config.Gateway.Model)
	system := []string{}
	if base := strings.TrimSpace(a.config.ResolveSystemPrompt(a.config.Gateway.Model)); base != "" {
		system = append(system, base)
	} else {
		system = append(system, enginecore.SystemPromptProvider(model)...)
	}
	system = append(system, currentDate)
	return strings.TrimSpace(strings.Join(filterEmpty(system), "\n"))
}

func currentDateSystemInstruction(now time.Time) string {
	return fmt.Sprintf(
		"Current date: %s. For news, latest, recent, current, or today/tomorrow/yesterday queries, ground the answer in this date, prioritize the newest available information, and avoid presenting older year roundups as current unless the user explicitly asks for that period.",
		now.Format("Monday, January 2, 2006"),
	)
}

func (a *GatewayAgent) maxIterations() int {
	maxIterations := a.config.Agent.MaxIterations
	if maxIterations <= 0 {
		return 5
	}
	return maxIterations
}

func parseProviderModel(model string) enginecore.ProviderModel {
	model = strings.TrimSpace(model)
	if model == "" {
		return enginecore.ProviderModel{ProviderID: protocol.DefaultProviderID, ModelID: protocol.DefaultModelID}
	}
	if strings.Contains(model, "/") {
		parts := strings.SplitN(model, "/", 2)
		return enginecore.ProviderModel{ProviderID: parts[0], ModelID: parts[1]}
	}
	return enginecore.ProviderModel{ProviderID: protocol.DefaultProviderID, ModelID: model}
}

func filterEmpty(items []string) []string {
	out := make([]string, 0, len(items))
	for _, item := range items {
		if strings.TrimSpace(item) == "" {
			continue
		}
		out = append(out, item)
	}
	return out
}

func systemSlice(systemPrompt string) []string {
	if strings.TrimSpace(systemPrompt) == "" {
		return nil
	}
	return []string{systemPrompt}
}

func transcriptText(transcript enginecore.Transcript) string {
	platform.GetLogger().Debug("Extracting transcript text", "numMessages", len(transcript.Messages))
	var parts []string
	var toolCalls []string

	for i, msg := range transcript.Messages {
		if msg.Info.Role != enginecore.RoleAssistant {
			continue
		}
		platform.GetLogger().Debug("Processing assistant message", "index", i, "numParts", len(msg.Parts))
		for _, part := range msg.Parts {
			if (part.Type == enginecore.PartText || part.Type == enginecore.PartReason) && part.Text != "" {
				parts = append(parts, part.Text)
			}
			if part.Type == enginecore.PartTool && part.Tool != "" {
				toolCalls = append(toolCalls, part.Tool)
			}
		}
	}

	result := strings.Join(parts, "\n\n")
	platform.GetLogger().Debug("Transcript text extracted", "resultLen", len(result), "numToolCalls", len(toolCalls))
	if result == "" && len(toolCalls) > 0 {
		// Fallback: If no text was produced but tools were used, report the activity
		return fmt.Sprintf("Agent completed task using tools: %s. (No summary provided by model)", strings.Join(toolCalls, ", "))
	}

	return result
}

func (a *GatewayAgent) buildToolsDefinition() []ToolDefinition {
	// Gemini Image model does not support function calling
	if engine.IsImageGenerationModelID(a.config.Gateway.Model) {
		return nil
	}

	var toolsDef []ToolDefinition
	if a.registry != nil {
		for _, t := range a.registry.All() {
			if !a.isToolEnabled(t.Name()) {
				continue
			}

			toolsDef = append(toolsDef, ToolDefinition{
				Type: "function",
				Function: FunctionDefinition{
					Name:        t.Name(),
					Description: t.Description(),
					Parameters:  t.Parameters(),
				},
			})
		}
	}

	if a.googleDriveClient != nil {
		if client, ok := a.googleDriveClient.(google.GoogleDriveClient); ok {
			driveTools := []tools.ITool{
				google.CreateListGoogleDriveFilesTool(client),
				google.CreateReadGoogleDriveFileTool(client),
			}
			for _, t := range driveTools {
				toolsDef = append(toolsDef, ToolDefinition{
					Type: "function",
					Function: FunctionDefinition{
						Name:        t.Name(),
						Description: t.Description(),
						Parameters:  t.Parameters(),
					},
				})
			}
		}
	}
	return toolsDef
}

func (a *GatewayAgent) buildToolHandlerDeps() *ToolCallHandlerDeps {
	handlerDeps := &ToolCallHandlerDeps{
		DiscoveredTools:     make(map[string]tools.ITool),
		LogToolEvent:        a.toolLogger,
		RegisterToolFailure: func(name string) int { return 0 },
		ResetToolFailures:   func(name string) {},
	}
	if a.registry != nil {
		for _, t := range a.registry.All() {
			if !a.isToolEnabled(t.Name()) {
				continue
			}
			handlerDeps.DiscoveredTools[t.Name()] = t
		}
	}

	if a.googleDriveClient != nil {
		if client, ok := a.googleDriveClient.(google.GoogleDriveClient); ok {
			handlerDeps.DiscoveredTools["google_drive_list"] = google.CreateListGoogleDriveFilesTool(client)
			handlerDeps.DiscoveredTools["google_drive_read"] = google.CreateReadGoogleDriveFileTool(client)
		}
	}
	return handlerDeps
}

func (a *GatewayAgent) isToolEnabled(name string) bool {
	if name == "search_web" && !a.webSearchEnabled {
		return false
	}
	if (name == "execute_code" || name == "calculate") && !a.codeExecutionEnabled {
		return false
	}
	if name == "computer_use" && !a.computerUseEnabled {
		return false
	}
	return true
}
