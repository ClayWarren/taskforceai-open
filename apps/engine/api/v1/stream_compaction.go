package stream

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"maps"
	"reflect"
	"strings"

	"github.com/TaskForceAI/core/pkg/agent"
)

const progressPreviewLimit = 600
const progressArgumentJSONParseLimit = 4096

func normalizeAgentStatuses(raw any) any {
	if raw == nil {
		return []any{}
	}
	switch statuses := raw.(type) {
	case []any:
		if statuses == nil {
			return []any{}
		}
		return raw
	case []map[string]any:
		if statuses == nil {
			return []any{}
		}
		return raw
	case map[string]any:
		if statuses == nil {
			return []any{}
		}
		return raw
	}
	v := reflect.ValueOf(raw)
	kind := v.Kind()
	if kind == reflect.Chan ||
		kind == reflect.Func ||
		kind == reflect.Interface ||
		kind == reflect.Map ||
		kind == reflect.Pointer ||
		kind == reflect.Slice {
		if v.IsNil() {
			return []any{}
		}
	}
	return raw
}

// extractAgentInfo extracts agent count and first agent status from agent statuses.
func extractAgentInfo(agentStatuses any) (int, string) {
	statuses, ok := agentStatuses.([]any)
	if !ok {
		if agentStatuses != nil {
			slog.Warn("[Stream] Unexpected agentStatuses shape", "type", fmt.Sprintf("%T", agentStatuses))
		}
		return 0, ""
	}

	count := len(statuses)
	if count == 0 {
		return 0, ""
	}

	var firstStatus string
	if m, ok := statuses[0].(map[string]any); ok {
		if s, ok := m["status"].(string); ok {
			firstStatus = s
		} else if v := m["status"]; v != nil {
			slog.Warn("[Stream] Unexpected status type in agentStatus", "type", fmt.Sprintf("%T", v))
		}
	} else if sm := statuses[0]; sm != nil {
		slog.Warn("[Stream] Unexpected item shape in agentStatuses", "type", fmt.Sprintf("%T", sm))
	}
	return count, firstStatus
}

func truncateProgressText(value any) any {
	truncated, _ := truncateProgressTextChanged(value)
	return truncated
}

func truncateProgressTextChanged(value any) (any, bool) {
	text, ok := value.(string)
	if !ok || len(text) <= progressPreviewLimit {
		return value, false
	}
	return text[:progressPreviewLimit] + "...", true
}

func compactProgressAgentStatuses(raw any) any {
	statuses, ok := raw.([]any)
	if !ok {
		return raw
	}

	compacted := make([]any, 0, len(statuses))
	for _, item := range statuses {
		statusMap, ok := item.(map[string]any)
		if !ok {
			compacted = append(compacted, item)
			continue
		}

		var result any
		resultChanged := false
		if value, ok := statusMap["result"]; ok {
			result, resultChanged = truncateProgressTextChanged(value)
		}
		var reasoning any
		reasoningChanged := false
		if value, ok := statusMap["reasoning"]; ok {
			reasoning, reasoningChanged = truncateProgressTextChanged(value)
		}
		if !resultChanged && !reasoningChanged {
			compacted = append(compacted, item)
			continue
		}

		if next, ok := compactAgentStatusMap(statusMap, result, resultChanged, reasoning, reasoningChanged); ok {
			compacted = append(compacted, next)
			continue
		}

		next := make(map[string]any, len(statusMap))
		maps.Copy(next, statusMap)
		if resultChanged {
			next["result"] = result
		}
		if reasoningChanged {
			next["reasoning"] = reasoning
		}
		compacted = append(compacted, next)
	}
	return compacted
}

type compactedAgentStatus struct {
	AgentID   any `json:"agent_id,omitempty"`
	Status    any `json:"status,omitempty"`
	Progress  any `json:"progress,omitempty"`
	Model     any `json:"model,omitempty"`
	Result    any `json:"result,omitempty"`
	Reasoning any `json:"reasoning,omitempty"`
}

func compactAgentStatusMap(statusMap map[string]any, result any, resultChanged bool, reasoning any, reasoningChanged bool) (compactedAgentStatus, bool) {
	var next compactedAgentStatus
	for key, value := range statusMap {
		if value == nil {
			return compactedAgentStatus{}, false
		}
		switch key {
		case "agent_id":
			next.AgentID = value
		case "status":
			next.Status = value
		case "progress":
			next.Progress = value
		case "model":
			next.Model = value
		case "result":
			if resultChanged {
				next.Result = result
			} else {
				next.Result = value
			}
		case "reasoning":
			if reasoningChanged {
				next.Reasoning = reasoning
			} else {
				next.Reasoning = value
			}
		default:
			return compactedAgentStatus{}, false
		}
	}
	return next, true
}

func mapValue(value any) (map[string]any, bool) {
	if m, ok := value.(map[string]any); ok {
		return m, true
	}

	data, err := json.Marshal(value)
	if err != nil {
		return nil, false
	}
	var decoded map[string]any
	if err := json.Unmarshal(data, &decoded); err != nil {
		return nil, false
	}
	return decoded, true
}

func normalizeToolName(value any) string {
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(strings.ToLower(text))
}

type compactedSearchArguments string

func (args compactedSearchArguments) MarshalJSON() ([]byte, error) {
	type searchArguments struct {
		Query string `json:"query"`
	}
	return json.Marshal(searchArguments{Query: string(args)})
}

func compactArgumentsMapForNormalized(toolName string, expected string, raw any) (map[string]any, bool) {
	if toolName != expected {
		return nil, false
	}
	args, ok := mapValue(raw)
	if !ok {
		text, isString := raw.(string)
		if !isString {
			return nil, false
		}
		if len(text) > progressArgumentJSONParseLimit {
			return nil, false
		}
		if err := json.Unmarshal([]byte(text), &args); err != nil {
			return nil, false
		}
	}
	return args, true
}

func compactSearchArgumentsForNormalized(toolName string, raw any) (any, bool) {
	args, ok := compactArgumentsMapForNormalized(toolName, "search_web", raw)
	if !ok {
		return nil, false
	}

	query, ok := args["query"].(string)
	if !ok || query == "" {
		return nil, false
	}
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, false
	}
	truncatedQuery := truncateProgressText(query).(string) //nolint:forcetypeassert // query is already validated as a string.
	return compactedSearchArguments(truncatedQuery), true
}

type compactedComputerUseArguments struct {
	Action          any `json:"action,omitempty"`
	CoordinateX     any `json:"coordinate_x,omitempty"`
	CoordinateY     any `json:"coordinate_y,omitempty"`
	ScrollDirection any `json:"scroll_direction,omitempty"`
	ScrollAmount    any `json:"scroll_amount,omitempty"`
	Text            any `json:"text,omitempty"`
	Duration        any `json:"duration,omitempty"`
	EndX            any `json:"end_x,omitempty"`
	EndY            any `json:"end_y,omitempty"`
}

func compactComputerUseArgumentsForNormalized(toolName string, raw any) (any, bool) {
	args, ok := compactArgumentsMapForNormalized(toolName, "computer_use", raw)
	if !ok {
		return nil, false
	}

	compacted := compactedComputerUseArguments{
		Action:          compactArgumentValue(args, "action"),
		CoordinateX:     compactArgumentValue(args, "coordinate_x"),
		CoordinateY:     compactArgumentValue(args, "coordinate_y"),
		ScrollDirection: compactArgumentValue(args, "scroll_direction"),
		ScrollAmount:    compactArgumentValue(args, "scroll_amount"),
		Text:            compactArgumentValue(args, "text"),
		Duration:        compactArgumentValue(args, "duration"),
		EndX:            compactArgumentValue(args, "end_x"),
		EndY:            compactArgumentValue(args, "end_y"),
	}
	if compacted == (compactedComputerUseArguments{}) {
		return nil, false
	}
	return compacted, true
}

func compactArgumentValue(args map[string]any, key string) any {
	value, ok := args[key]
	if !ok {
		return nil
	}
	return truncateProgressText(value)
}

func compactToolEventArguments(normalizedToolName string, rawValues ...any) (any, bool) {
	for _, raw := range rawValues {
		if arguments, ok := compactSearchArgumentsForNormalized(normalizedToolName, raw); ok {
			return arguments, true
		}
		if arguments, ok := compactComputerUseArgumentsForNormalized(normalizedToolName, raw); ok {
			return arguments, true
		}
	}
	return nil, false
}

func compactProgressToolEvents(raw any) any {
	if raw == nil {
		return nil
	}
	if events, ok := raw.([]agent.ToolEvent); ok {
		return compactAgentToolEvents(events)
	}
	if events, ok := raw.([]any); ok {
		return compactAnyToolEvents(events)
	}
	if events, ok := raw.([]map[string]any); ok {
		return compactMapToolEvents(events)
	}

	value := reflect.ValueOf(raw)
	if !value.IsValid() || value.Kind() != reflect.Slice {
		return raw
	}
	if value.IsNil() {
		return nil
	}

	compacted := make([]any, 0, value.Len())
	for i := 0; i < value.Len(); i++ {
		eventMap, ok := mapValue(value.Index(i).Interface())
		if !ok {
			compacted = append(compacted, value.Index(i).Interface())
			continue
		}
		compacted = append(compacted, compactToolEventMapStruct(eventMap))
	}
	return compacted
}

func compactAnyToolEvents(events []any) any {
	if events == nil {
		return nil
	}
	compacted := make([]compactedMapToolEvent, 0, len(events))
	var fallback []any
	for _, event := range events {
		eventMap, ok := mapValue(event)
		if !ok {
			if fallback == nil {
				fallback = make([]any, 0, len(events))
				for _, compactedEvent := range compacted {
					fallback = append(fallback, compactedEvent)
				}
			}
			fallback = append(fallback, event)
			continue
		}
		next := compactToolEventMapStruct(eventMap)
		if fallback != nil {
			fallback = append(fallback, next)
			continue
		}
		compacted = append(compacted, next)
	}
	if fallback != nil {
		return fallback
	}
	return compacted
}

func compactMapToolEvents(events []map[string]any) any {
	if events == nil {
		return nil
	}
	compacted := make([]compactedMapToolEvent, 0, len(events))
	for _, eventMap := range events {
		compacted = append(compacted, compactToolEventMapStruct(eventMap))
	}
	return compacted
}

type compactedMapToolEvent struct {
	InvocationID  any `json:"invocationId,omitempty"`
	AgentID       any `json:"agentId,omitempty"`
	AgentLabel    any `json:"agentLabel,omitempty"`
	ToolName      any `json:"toolName,omitempty"`
	Success       any `json:"success,omitempty"`
	Status        any `json:"status,omitempty"`
	DurationMs    any `json:"durationMs,omitempty"`
	Error         any `json:"error,omitempty"`
	Timestamp     any `json:"timestamp,omitempty"`
	ImageBase64   any `json:"image_base64,omitempty"`
	Sources       any `json:"sources,omitempty"`
	Arguments     any `json:"arguments,omitempty"`
	ResultPreview any `json:"resultPreview,omitempty"`
}

func firstPresent(src map[string]any, keys ...string) any {
	for _, key := range keys {
		if value, ok := src[key]; ok {
			return value
		}
	}
	return nil
}

func compactToolEventMapStruct(eventMap map[string]any) compactedMapToolEvent {
	next := compactedMapToolEvent{
		InvocationID: firstPresent(eventMap, "invocationId", "invocation_id"),
		AgentID:      firstPresent(eventMap, "agentId", "agent_id"),
		AgentLabel:   firstPresent(eventMap, "agentLabel", "agent_label"),
		ToolName:     firstPresent(eventMap, "toolName", "tool_name"),
		Success:      firstPresent(eventMap, "success"),
		Status:       firstPresent(eventMap, "status"),
		DurationMs:   firstPresent(eventMap, "durationMs", "duration_ms"),
		Error:        firstPresent(eventMap, "error"),
		Timestamp:    firstPresent(eventMap, "timestamp"),
		ImageBase64:  firstPresent(eventMap, "image_base64"),
		Sources:      firstPresent(eventMap, "sources"),
	}

	toolName, _ := next.ToolName.(string)
	normalizedToolName := normalizeToolName(toolName)
	if arguments, ok := compactToolEventArguments(normalizedToolName, eventMap["arguments"], eventMap["tool_input"]); ok {
		next.Arguments = arguments
	}

	if preview, ok := eventMap["resultPreview"]; ok {
		next.ResultPreview = truncateProgressText(preview)
	} else if preview, ok := eventMap["tool_output"]; ok {
		next.ResultPreview = truncateProgressText(preview)
	}
	return next
}

type compactedAgentToolEvent struct {
	InvocationID  string                  `json:"invocationId,omitempty"`
	AgentID       *int                    `json:"agentId,omitempty"`
	AgentLabel    string                  `json:"agentLabel"`
	ToolName      string                  `json:"toolName"`
	Status        string                  `json:"status,omitempty"`
	Success       bool                    `json:"success"`
	DurationMs    int64                   `json:"durationMs"`
	Error         string                  `json:"error,omitempty"`
	ImageBase64   string                  `json:"image_base64,omitempty"`
	Sources       []agent.SourceReference `json:"sources,omitempty"`
	Arguments     any                     `json:"arguments,omitempty"`
	ResultPreview any                     `json:"resultPreview,omitempty"`
}

func compactAgentToolEvents(events []agent.ToolEvent) any {
	if events == nil {
		return nil
	}
	compacted := make([]compactedAgentToolEvent, 0, len(events))
	for _, event := range events {
		next := compactedAgentToolEvent{
			InvocationID: event.InvocationID,
			AgentID:      event.AgentID,
			AgentLabel:   event.AgentLabel,
			ToolName:     event.ToolName,
			Status:       event.Status,
			Success:      event.Success,
			DurationMs:   event.DurationMs,
			Error:        event.Error,
			ImageBase64:  event.ImageBase64,
			Sources:      event.Sources,
		}

		normalizedToolName := normalizeToolName(event.ToolName)
		if arguments, ok := compactToolEventArguments(normalizedToolName, event.Arguments); ok {
			next.Arguments = arguments
		}
		if event.ResultPreview != "" {
			next.ResultPreview = truncateProgressText(event.ResultPreview)
		}
		compacted = append(compacted, next)
	}
	return compacted
}

func compactCompleteToolEvents(raw any) any {
	return stripCompleteToolEventImages(compactProgressToolEvents(raw))
}

func stripCompleteToolEventImages(compacted any) any {
	switch events := compacted.(type) {
	case []compactedMapToolEvent:
		stripped := make([]compactedMapToolEvent, len(events))
		copy(stripped, events)
		for i := range stripped {
			stripped[i].ImageBase64 = nil
		}
		return stripped
	case []compactedAgentToolEvent:
		stripped := make([]compactedAgentToolEvent, len(events))
		copy(stripped, events)
		for i := range stripped {
			stripped[i].ImageBase64 = ""
		}
		return stripped
	case []any:
		stripped := make([]any, 0, len(events))
		for _, event := range events {
			switch typed := event.(type) {
			case compactedMapToolEvent:
				typed.ImageBase64 = nil
				stripped = append(stripped, typed)
			case compactedAgentToolEvent:
				typed.ImageBase64 = ""
				stripped = append(stripped, typed)
			case map[string]any:
				next := make(map[string]any, len(typed))
				maps.Copy(next, typed)
				delete(next, "image_base64")
				stripped = append(stripped, next)
			default:
				stripped = append(stripped, event)
			}
		}
		return stripped
	default:
		return compacted
	}
}
