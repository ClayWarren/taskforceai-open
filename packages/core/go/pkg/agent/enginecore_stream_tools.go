package agent

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"time"

	enginecore "github.com/TaskForceAI/core/pkg/enginecore/core"
	"github.com/TaskForceAI/core/pkg/platform"
	"github.com/TaskForceAI/core/pkg/tools"
)

// toolCallResult holds the output of a single tool execution.
type toolCallResult struct {
	event         enginecore.Event
	message       ChatCompletionMessage
	imageBase64   string // non-empty if the tool returned a screenshot
	generatedFile *GeneratedFile
}

func (s *agentStream) executeToolCall(deps *ToolCallHandlerDeps, toolCall ToolCall) toolCallResult {
	toolCall = s.repairSearchToolCallArguments(toolCall)
	if deps == nil {
		ev, text := s.toolErrorEvent(toolCall, time.Now(), "Tool dependencies not configured")
		return toolCallResult{
			event:   ev,
			message: ChatCompletionMessage{Role: RoleTool, Content: text, ToolID: toolCall.ID},
		}
	}
	start := time.Now()
	toolName := toolCall.Function.Name
	argsRaw := toolCall.Function.Arguments
	platform.GetLogger().Debug("Executing agent tool call", "tool", toolName, "args", argsRaw)

	tool, ok := deps.DiscoveredTools[toolName]
	if !ok {
		ev, text := s.toolErrorEvent(toolCall, start, fmt.Sprintf("Unknown tool: %s", toolName))
		return toolCallResult{
			event:   ev,
			message: ChatCompletionMessage{Role: RoleTool, Content: text, ToolID: toolCall.ID},
		}
	}

	if s.opts.toolLogger != nil {
		s.opts.toolLogger(ToolEvent{
			InvocationID: toolCall.ID,
			ToolName:     toolName,
			Arguments:    argsRaw,
			Status:       "running",
			Success:      true,
		})
	}

	result, execErr := executeToolSafely(s.opts.ctx, tool, argsRaw)
	durationMs := time.Since(start).Milliseconds()
	if execErr != nil {
		platform.GetLogger().Warn("Tool execution failed", "tool", toolName, "error", execErr)
		ev, text := s.toolErrorEvent(toolCall, start, execErr.Error())
		if s.opts.toolLogger != nil {
			s.opts.toolLogger(ToolEvent{
				InvocationID: toolCall.ID,
				ToolName:     toolName,
				Arguments:    argsRaw,
				Status:       "failed",
				Success:      false,
				Error:        execErr.Error(),
				DurationMs:   durationMs,
			})
		}
		return toolCallResult{
			event:   ev,
			message: ChatCompletionMessage{Role: RoleTool, Content: text, ToolID: toolCall.ID},
		}
	}

	// Extract image data.
	imageBase64, _ := result["image_base64"].(string)
	generatedFile := generatedFileFromToolResult(toolName, result)
	resultForJSON := sanitizeToolResult(result)

	toolJSON, err := json.Marshal(resultForJSON)
	if err != nil {
		toolJSON = []byte(fmt.Sprintf(`{"error":"failed to serialize result: %v"}`, err))
	}
	toolMessage := string(toolJSON)
	platform.GetLogger().Debug("Tool execution completed", "tool", toolName, "durationMs", durationMs, "outputLen", len(toolMessage))
	preview := truncateStringForPreview(toolMessage)
	sources := sourcesFromSearchResult(toolName, resultForJSON)

	if deps.LogToolEvent != nil {
		deps.LogToolEvent(ToolEvent{
			InvocationID:  toolCall.ID,
			ToolName:      toolName,
			Arguments:     argsRaw,
			Status:        "completed",
			Success:       true,
			DurationMs:    durationMs,
			ResultPreview: preview,
			ImageBase64:   imageBase64,
			Sources:       sources,
			GeneratedFile: generatedFile,
		})
	}

	state := toolStateFromResult(resultForJSON, argsRaw, toolMessage)
	// Ensure the screenshot is passed to the UI state
	if imageBase64 != "" {
		state["screenshot"] = "data:image/png;base64," + imageBase64
	}

	return toolCallResult{
		event: enginecore.Event{
			Type:      enginecore.EventTool,
			Tool:      &enginecore.ToolCall{Name: toolName},
			ToolState: state,
		},
		message:       ChatCompletionMessage{Role: RoleTool, Content: toolMessage, ToolID: toolCall.ID},
		imageBase64:   imageBase64,
		generatedFile: generatedFile,
	}
}

func (s *agentStream) repairSearchToolCallArguments(toolCall ToolCall) ToolCall {
	if toolCall.Function.Name != "search_web" || searchToolCallHasQuery(toolCall.Function.Arguments) {
		return toolCall
	}

	query := fallbackSearchQueryFromMessages(s.opts.messages)
	if query == "" {
		return toolCall
	}

	payload, err := marshalSearchQueryArguments(map[string]string{"query": query})
	if err != nil {
		return toolCall
	}

	platform.GetLogger().Warn("Repaired search_web tool call missing query", "queryLength", len(query))
	toolCall.Function.Arguments = string(payload)
	return toolCall
}

func searchToolCallHasQuery(arguments string) bool {
	trimmed := strings.TrimSpace(arguments)
	if trimmed == "" {
		return false
	}
	var args map[string]any
	if err := json.Unmarshal([]byte(trimmed), &args); err != nil {
		return true
	}
	query, ok := args["query"].(string)
	return ok && strings.TrimSpace(query) != ""
}

func fallbackSearchQueryFromMessages(messages []ChatCompletionMessage) string {
	for _, message := range slices.Backward(messages) {
		if message.Role != RoleUser {
			continue
		}
		query := strings.TrimSpace(message.TextContent())
		if query == "" {
			continue
		}
		return truncateStringForPreview(query)
	}
	return ""
}

func (s *agentStream) toolErrorEvent(toolCall ToolCall, start time.Time, message string) (enginecore.Event, string) {
	durationMs := time.Since(start).Milliseconds()
	if s.opts.toolLogger != nil {
		s.opts.toolLogger(ToolEvent{
			InvocationID: toolCall.ID,
			ToolName:     toolCall.Function.Name,
			Arguments:    toolCall.Function.Arguments,
			Status:       "failed",
			Success:      false,
			DurationMs:   durationMs,
			Error:        message,
		})
	}
	state := map[string]any{
		"status": "error",
		"input":  map[string]any{"raw": toolCall.Function.Arguments},
		"error":  message,
	}
	toolMessage, err := json.Marshal(struct {
		Error string `json:"error"`
	}{Error: message})
	if err != nil {
		toolMessage = []byte(`{"error":"tool failed"}`)
	}
	return enginecore.Event{
		Type:      enginecore.EventTool,
		Tool:      &enginecore.ToolCall{Name: toolCall.Function.Name},
		ToolState: state,
	}, string(toolMessage)
}

func toolStateFromResult(result tools.ToolResult, argsRaw string, resultJSON string) map[string]any {
	state := map[string]any{
		"status": "completed",
		"input":  map[string]any{"raw": argsRaw},
	}
	if result == nil {
		return state
	}
	if errMsg, ok := result["error"].(string); ok && errMsg != "" {
		state["status"] = "error"
		state["error"] = errMsg
	}
	if title, ok := result["title"].(string); ok && title != "" {
		state["title"] = title
	}
	if metadata, ok := result["metadata"].(map[string]any); ok {
		state["metadata"] = metadata
	}
	if attachments, ok := result["attachments"].([]map[string]any); ok {
		state["attachments"] = attachments
	}
	if content, ok := result["content"].(string); ok {
		state["output"] = content
		return state
	}
	if resultJSON != "" {
		state["output"] = resultJSON
		return state
	}
	if raw, err := json.Marshal(result); err == nil {
		state["output"] = string(raw)
	}
	return state
}

func sanitizeToolResult(result tools.ToolResult) tools.ToolResult {
	if result == nil {
		return nil
	}
	needsCopy := false
	for key, value := range result {
		switch key {
		case "image_base64", "generated_file":
			needsCopy = true
		case "metadata":
			if metadataContainsGeneratedFile(value) {
				needsCopy = true
			}
		}
		if needsCopy {
			break
		}
	}
	if !needsCopy {
		return result
	}
	sanitized := make(tools.ToolResult, len(result))
	for key, value := range result {
		if key == "image_base64" {
			continue
		}
		switch key {
		case "generated_file":
			sanitized[key] = sanitizeGeneratedFileValue(value)
		case "metadata":
			sanitized[key] = sanitizeToolMetadata(value)
		default:
			sanitized[key] = value
		}
	}
	return sanitized
}

func metadataContainsGeneratedFile(value any) bool {
	metadata, ok := value.(map[string]any)
	if !ok {
		return false
	}
	_, ok = metadata["generated_file"]
	return ok
}

func sanitizeToolMetadata(value any) any {
	metadata, ok := value.(map[string]any)
	if !ok {
		return value
	}
	sanitized := make(map[string]any, len(metadata))
	for key, item := range metadata {
		if key == "generated_file" {
			sanitized[key] = sanitizeGeneratedFileValue(item)
			continue
		}
		sanitized[key] = item
	}
	return sanitized
}

func sanitizeGeneratedFileValue(value any) any {
	file, ok := value.(map[string]any)
	if !ok {
		return value
	}
	sanitized := make(map[string]any, len(file))
	for key, item := range file {
		if key == "local_path" {
			continue
		}
		sanitized[key] = item
	}
	return sanitized
}

func generatedFileFromToolResult(toolName string, result tools.ToolResult) *GeneratedFile {
	if result == nil || !isGeneratedFileToolName(toolName) {
		return nil
	}
	file, ok := result["generated_file"].(map[string]any)
	if !ok || file == nil {
		return nil
	}
	filename := stringFromAny(file["filename"])
	if filename == "" {
		return nil
	}
	return &GeneratedFile{
		Filename:  filename,
		Filepath:  rawStringFromAny(file["filepath"]),
		MimeType:  firstStringFromAny(file["mimeType"], file["mime_type"]),
		Bytes:     int64FromAny(file["bytes"]),
		ToolName:  toolName,
		LocalPath: rawStringFromAny(file["local_path"]),
	}
}

func rawStringFromAny(value any) string {
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return text
}

func stringFromAny(value any) string {
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(text)
}

func firstStringFromAny(values ...any) string {
	for _, value := range values {
		if text := stringFromAny(value); text != "" {
			return text
		}
	}
	return ""
}

func int64FromAny(value any) int64 {
	switch v := value.(type) {
	case int:
		return int64(v)
	case int32:
		return int64(v)
	case int64:
		return v
	case float64:
		return int64(v)
	case json.Number:
		if n, err := v.Int64(); err == nil {
			return n
		}
	}
	return 0
}

func sourcesFromSearchResult(toolName string, result tools.ToolResult) []SourceReference {
	if toolName != "search_web" || result == nil {
		return nil
	}
	items, ok := result["results"].([]tools.SearchResultItem)
	if !ok {
		return nil
	}
	sources := make([]SourceReference, 0, len(items))
	seen := make(map[string]struct{})
	for _, item := range items {
		if item.URL == "" {
			continue
		}
		if _, exists := seen[item.URL]; exists {
			continue
		}
		seen[item.URL] = struct{}{}
		sources = append(sources, SourceReference{
			URL:     item.URL,
			Title:   item.Title,
			Snippet: item.Snippet,
		})
	}
	return sources
}

var marshalSearchQueryArguments = json.Marshal
