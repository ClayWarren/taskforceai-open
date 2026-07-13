package core

type Transcript struct {
	Messages []Message
}

type Role string

const (
	RoleUser      Role = "user"
	RoleAssistant Role = "assistant"
)

type PartType string

const (
	PartText       PartType = "text"
	PartTool       PartType = "tool"
	PartStepFinish PartType = "step-finish"
	PartSystem     PartType = "system"
	PartReason     PartType = "reason"
)

type StatusType string

const (
	StatusBusy  StatusType = "busy"
	StatusIdle  StatusType = "idle"
	StatusRetry StatusType = "retry"
)

type Message struct {
	Info  MessageInfo `json:"info"`
	Parts []Part      `json:"parts"`
}

type MessageInfo struct {
	ID          string        `json:"id,omitempty"`
	SessionID   string        `json:"sessionID,omitempty"`
	TimeCreated int64         `json:"time,omitempty"`
	Role        Role          `json:"role"`
	Agent       string        `json:"agent"`
	Model       *ModelRef     `json:"model,omitempty"`
	ModelID     string        `json:"modelID,omitempty"`
	ProviderID  string        `json:"providerID,omitempty"`
	Mode        string        `json:"mode,omitempty"`
	Tokens      *Tokens       `json:"tokens,omitempty"`
	Finish      string        `json:"finish,omitempty"`
	Summary     bool          `json:"summary,omitempty"`
	Path        *MessagePath  `json:"path,omitempty"`
	Cost        float64       `json:"cost,omitempty"`
	Error       *MessageError `json:"error,omitempty"`
}

type MessageError struct {
	Name string         `json:"name"`
	Data map[string]any `json:"data,omitempty"`
}

type CostCalculator interface {
	FromUsage(usage Usage, metadata map[string]any) float64
}

type MessagePath struct {
	Cwd  string `json:"cwd"`
	Root string `json:"root"`
}

type ModelRef struct {
	ProviderID string `json:"providerID"`
	ModelID    string `json:"modelID"`
}

type Tokens struct {
	Input     int       `json:"input"`
	Output    int       `json:"output"`
	Reasoning int       `json:"reasoning"`
	Cache     CacheInfo `json:"cache"`
}

type Usage struct {
	InputTokens     int `json:"inputTokens"`
	OutputTokens    int `json:"outputTokens"`
	ReasoningTokens int `json:"reasoningTokens"`
	CacheRead       int `json:"cacheRead"`
	CacheWrite      int `json:"cacheWrite"`
}

type CacheInfo struct {
	Read  int `json:"read"`
	Write int `json:"write"`
}

type Part struct {
	ID        string     `json:"id,omitempty"`
	SessionID string     `json:"sessionID,omitempty"`
	MessageID string     `json:"messageID,omitempty"`
	Type      PartType   `json:"type"`
	Text      string     `json:"text,omitempty"`
	Tool      string     `json:"tool,omitempty"`
	State     *ToolState `json:"state,omitempty"`
	Reason    string     `json:"reason,omitempty"`
	Tokens    *Tokens    `json:"tokens,omitempty"`
	System    string     `json:"system,omitempty"`
}

type IDGenerator interface {
	Next(prefix string) string
}

type ToolState struct {
	Status      string           `json:"status"`
	Input       map[string]any   `json:"input"`
	Output      string           `json:"output,omitempty"`
	Title       *string          `json:"title,omitempty"`
	Metadata    map[string]any   `json:"metadata,omitempty"`
	Attachments []map[string]any `json:"attachments,omitempty"`
	Error       string           `json:"error,omitempty"`
}

// EventType models normalized stream events from LLM adapters and processors.
type EventType string

const (
	EventStart      EventType = "start"
	EventText       EventType = "text"
	EventTool       EventType = "tool"
	EventError      EventType = "error"
	EventFinishStep EventType = "finish-step"
)

type Event struct {
	Type      EventType
	Text      string
	Reasoning string
	Tool      *ToolCall
	// ToolState holds precomputed tool state for streams that already executed tools.
	ToolState  map[string]any
	FinishStep *FinishStepData
	Err        error
}

type FinishStepData struct {
	Usage        *Usage         `json:"usage,omitempty"`
	FinishReason string         `json:"finishReason,omitempty"`
	Metadata     map[string]any `json:"metadata,omitempty"`
}

// Tool context/types live in the protocol package to avoid cycles.

type StatusInfo struct {
	Type    StatusType `json:"type"`
	Attempt int        `json:"attempt,omitempty"`
	Message string     `json:"message,omitempty"`
	Next    int64      `json:"next,omitempty"`
}

type ToolCall struct {
	Name string
	Args map[string]any
}
