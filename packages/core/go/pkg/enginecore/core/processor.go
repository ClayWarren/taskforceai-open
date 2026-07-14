package core

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"maps"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	tools "github.com/TaskForceAI/core/pkg/enginecore/tools"
)

var readRandomBytes = rand.Read

// Processor consumes normalized events and builds a transcript.
type Processor struct {
	ctx   protocol.ToolContext
	ids   IDGenerator
	path  *MessagePath
	model ProviderModel
	cost  CostCalculator
}

func NewProcessorWithIDs(cwd string, ids IDGenerator) *Processor {
	return &Processor{
		ctx: protocol.ToolContext{
			Ctx:       context.Background(),
			Cwd:       cwd,
			ReadFiles: map[string]bool{},
			Todo:      tools.NewTodoStore(),
		},
		ids:   ids,
		model: ProviderModel{ProviderID: protocol.DefaultProviderID, ModelID: protocol.DefaultModelID},
		cost:  ZeroCostCalculator{},
	}
}

func (p *Processor) SetModel(model ProviderModel) {
	p.model = model
}

func (p *Processor) SetCostCalculator(calc CostCalculator) {
	p.cost = calc
}

func (p *Processor) SetPath(cwd, root string) {
	if cwd == "" && root == "" {
		p.path = nil
		return
	}
	p.path = &MessagePath{Cwd: cwd, Root: root}
}

func (p *Processor) SetInstructionResolver(resolver protocol.InstructionResolver) {
	p.ctx.Instruction = resolver
}

func (p *Processor) SetPermissionChecker(checker protocol.PermissionChecker) {
	p.ctx.Permission = checker
}

func (p *Processor) SetContext(ctx context.Context) { //nolint:contextcheck,fatcontext // Processor stores the current run context for tool calls.
	if ctx == nil {
		ctx = context.Background()
	}
	p.ctx.Ctx = ctx //nolint:fatcontext // The processor intentionally replaces its per-run tool context.
}

func (p *Processor) SetQuestionAnswer(answer string) {
	p.ctx.QuestionAnswer = answer
	p.ctx.QuestionAnswerSet = answer != ""
}

func (p *Processor) Clone() *Processor {
	newP := *p
	// Deep copy ToolContext
	newP.ctx.ReadFiles = make(map[string]bool, len(p.ctx.ReadFiles))
	maps.Copy(newP.ctx.ReadFiles, p.ctx.ReadFiles)
	newP.ctx.Todo = tools.CloneTodoStore(p.ctx.Todo)
	return &newP
}

// Process converts normalized events into a transcript.
func (p *Processor) Process(prompt string, events []Event) (Transcript, error) {
	user, assistant := p.Begin(prompt, "")
	for _, ev := range events {
		p.ApplyEvent(&assistant, ev)
	}
	return Transcript{Messages: []Message{user, assistant}}, nil
}

func (p *Processor) Begin(prompt string, sessionID string) (Message, Message) {
	return p.newConversationMessages(prompt, nil, sessionID)
}

func (p *Processor) BeginWithSystem(prompt string, system []string, sessionID string) (Message, Message) {
	user, assistant := p.newConversationMessages(prompt, system, sessionID)
	p.assignIDs(&user)
	p.assignIDs(&assistant)
	return user, assistant
}

func (p *Processor) newConversationMessages(prompt string, system []string, sessionID string) (Message, Message) {
	user := Message{
		Info: MessageInfo{
			Role:      RoleUser,
			Agent:     "build",
			Model:     &ModelRef{ProviderID: p.model.ProviderID, ModelID: p.model.ModelID},
			SessionID: sessionID,
			Path:      p.path,
		},
		Parts: []Part{{Type: PartText, Text: prompt}},
	}
	if len(system) > 0 {
		systemParts := make([]Part, 0, len(system))
		for _, entry := range system {
			systemParts = append(systemParts, Part{Type: PartSystem, System: entry})
		}
		user.Parts = append(systemParts, user.Parts...)
	}

	assistant := Message{
		Info: MessageInfo{
			Role:       RoleAssistant,
			ModelID:    QualifiedModelID(p.model.ProviderID, p.model.ModelID),
			ProviderID: p.model.ProviderID,
			Mode:       "build",
			Agent:      "build",
			SessionID:  sessionID,
			Path:       p.path,
			Tokens:     defaultTokens(),
			Finish:     "stop",
		},
		Parts: []Part{},
	}

	return user, assistant
}

func (p *Processor) ApplyEvent(assistant *Message, ev Event) {
	switch ev.Type {
	case EventStart:
		return
	case EventText:
		part := Part{Type: PartText, Text: ev.Text}
		p.assignPartIDs(assistant, &part)
		assistant.Parts = append(assistant.Parts, part)
		if ev.Reasoning != "" {
			rPart := Part{Type: PartReason, Text: ev.Reasoning}
			p.assignPartIDs(assistant, &rPart)
			assistant.Parts = append(assistant.Parts, rPart)
		}
	case EventTool:
		var partState *ToolState
		if ev.ToolState != nil {
			partState = toToolState(ev.ToolState)
		} else {
			result := tools.ExecuteTool(p.ctx, ev.Tool.Name, ev.Tool.Args)
			partState = toToolStateFromResult(result)
		}
		if partState != nil && partState.Input == nil {
			partState.Input = map[string]any{}
		}
		part := Part{Type: PartTool, Tool: ev.Tool.Name, State: partState}
		p.assignPartIDs(assistant, &part)
		assistant.Parts = append(assistant.Parts, part)
	case EventFinishStep:
		if ev.FinishStep != nil {
			if ev.FinishStep.Usage != nil {
				p.applyUsage(assistant, *ev.FinishStep.Usage)
			}
			if ev.FinishStep.FinishReason != "" {
				assistant.Info.Finish = ev.FinishStep.FinishReason
			}
			if p.cost != nil && ev.FinishStep.Usage != nil {
				assistant.Info.Cost += p.cost.FromUsage(*ev.FinishStep.Usage, ev.FinishStep.Metadata)
			}
		}
		reason := "stop"
		if ev.FinishStep != nil && ev.FinishStep.FinishReason != "" {
			reason = ev.FinishStep.FinishReason
		}
		tokens := defaultTokens()
		if ev.FinishStep != nil && ev.FinishStep.Usage != nil {
			tokens = tokensFromUsage(*ev.FinishStep.Usage)
		}
		part := Part{
			Type:   PartStepFinish,
			Reason: reason,
			Tokens: tokens,
		}
		p.assignPartIDs(assistant, &part)
		assistant.Parts = append(assistant.Parts, part)
	case EventError:
		assistant.Info.Error = &MessageError{
			Name: "UnknownError",
			Data: map[string]any{
				"message": errorMessage(ev.Err),
			},
		}
		assistant.Info.Tokens = &Tokens{
			Input:     0,
			Output:    0,
			Reasoning: 0,
			Cache:     CacheInfo{Read: 0, Write: 0},
		}
		assistant.Info.Finish = ""
	}
}

func (p *Processor) applyUsage(msg *Message, usage Usage) {
	msg.Info.Tokens = tokensFromUsage(usage)
}

func tokensFromUsage(usage Usage) *Tokens {
	return &Tokens{
		Input:     nonNegative(usage.InputTokens),
		Output:    nonNegative(usage.OutputTokens),
		Reasoning: nonNegative(usage.ReasoningTokens),
		Cache: CacheInfo{
			Read:  nonNegative(usage.CacheRead),
			Write: nonNegative(usage.CacheWrite),
		},
	}
}

func defaultTokens() *Tokens {
	return &Tokens{Input: 1, Output: 1}
}

func generateFallbackID(prefix string) string {
	b := make([]byte, 8)
	if _, err := readRandomBytes(b); err != nil {
		// This should never happen in practice with crypto/rand
		return prefix + "_fixed_id"
	}
	return prefix + "_" + hex.EncodeToString(b)
}

func (p *Processor) assignIDs(msg *Message) {
	if msg.Info.ID == "" {
		msg.Info.ID = p.nextID("message")
	}
	for i := range msg.Parts {
		p.assignPartIDs(msg, &msg.Parts[i])
	}
}

func (p *Processor) assignPartIDs(msg *Message, part *Part) {
	if part.ID == "" {
		part.ID = p.nextID("part")
	}
	if part.SessionID == "" {
		part.SessionID = msg.Info.SessionID
	}
	if part.MessageID == "" {
		if msg.Info.ID == "" {
			msg.Info.ID = p.nextID("message")
		}
		part.MessageID = msg.Info.ID
	}
}

func (p *Processor) nextID(prefix string) string {
	if p.ids != nil {
		return p.ids.Next(prefix)
	}
	return generateFallbackID(prefix)
}

func toToolState(state map[string]any) *ToolState {
	if state == nil {
		return nil
	}
	out := &ToolState{}
	if v, ok := state["status"].(string); ok {
		out.Status = v
	}
	if v, ok := state["input"].(map[string]any); ok {
		out.Input = v
	}
	if out.Input == nil {
		if _, ok := state["input"]; ok {
			out.Input = map[string]any{}
		}
	}
	if v, ok := state["output"].(string); ok {
		out.Output = v
	}
	if v, ok := state["title"].(string); ok {
		title := v
		out.Title = &title
	}
	if v, ok := state["metadata"].(map[string]any); ok {
		out.Metadata = v
	}
	if v, ok := state["attachments"]; ok {
		switch items := v.(type) {
		case []map[string]any:
			out.Attachments = items
		case []any:
			attachments := make([]map[string]any, 0, len(items))
			for _, item := range items {
				if m, ok := item.(map[string]any); ok {
					attachments = append(attachments, m)
				}
			}
			out.Attachments = attachments
		}
	}
	if v, ok := state["error"].(string); ok {
		out.Error = v
	}
	return out
}

func toToolStateFromResult(result tools.ToolResult) *ToolState {
	out := &ToolState{
		Status:   result.Status,
		Input:    result.Input,
		Output:   result.Output,
		Metadata: result.Metadata,
		Error:    result.Error,
	}
	if result.TitleSet {
		title := result.Title
		out.Title = &title
	}
	if len(result.Attachments) > 0 {
		out.Attachments = result.Attachments
	}
	return out
}
