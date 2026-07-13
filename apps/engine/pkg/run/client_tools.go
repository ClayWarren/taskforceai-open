package run

import "strings"

const (
	ClientToolSourceMCP      = "mcp"
	ClientToolActionToolCall = "tool_call"
)

type ClientMCPTool struct {
	ServerName  string `json:"serverName"`
	ToolName    string `json:"toolName"`
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
}

func (t ClientMCPTool) IsZero() bool {
	return strings.TrimSpace(t.ServerName) == "" || strings.TrimSpace(t.ToolName) == ""
}

type ApprovalDecision struct {
	Approved bool           `json:"approved"`
	Result   map[string]any `json:"result,omitempty"`
	Error    string         `json:"error,omitempty"`
}
