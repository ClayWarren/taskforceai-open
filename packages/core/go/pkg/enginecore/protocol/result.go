package protocol

// ToolResult is the normalized result returned by an enginecore tool handler.
type ToolResult struct {
	Status      string
	Input       map[string]any
	Output      string
	Title       string
	TitleSet    bool
	Metadata    map[string]any
	Attachments []map[string]any
	Error       string
}
