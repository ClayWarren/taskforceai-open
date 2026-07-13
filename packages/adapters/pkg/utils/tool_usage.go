package utils

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// ToolUsageEventLike represents a partial tool usage event.
type ToolUsageEventLike struct {
	ToolName      *string `json:"toolName,omitempty"`
	Arguments     any     `json:"arguments,omitempty"`
	ResultPreview *string `json:"resultPreview,omitempty"`
	Error         *string `json:"error,omitempty"`
	Success       *bool   `json:"success,omitempty"`
	DurationMs    *int    `json:"durationMs,omitempty"`
}

// CodeExecutionArgs holds arguments for a code execution tool.
type CodeExecutionArgs struct {
	Code     string `json:"code,omitempty"`
	Language string `json:"language,omitempty"`
	Timeout  int    `json:"timeout,omitempty"`
}

// SearchArgs holds arguments for a search tool.
type SearchArgs struct {
	Query string `json:"query,omitempty"`
}

// CodeExecutionPreview holds the result of a code execution.
type CodeExecutionPreview struct {
	Output string `json:"output,omitempty"`
	Errors string `json:"errors,omitempty"`
	Raw    string `json:"raw,omitempty"`
}

// SearchPreviewResult represents a single result in a search preview.
type SearchPreviewResult struct {
	URL     string `json:"url"`
	Title   string `json:"title,omitempty"`
	Snippet string `json:"snippet,omitempty"`
}

// SearchPreview holds the combined results of a search.
type SearchPreview struct {
	Results      []SearchPreviewResult `json:"results"`
	TotalResults int                   `json:"totalResults,omitempty"`
}

func sj(v any) any {
	if s, ok := v.(string); ok {
		if !json.Valid([]byte(s)) {
			return s
		}
		var res any
		_ = json.Unmarshal([]byte(s), &res)
		return res
	}
	return v
}

func decodeJSONLike(v any, target any) error {
	if s, ok := v.(string); ok {
		if err := json.Unmarshal([]byte(s), target); err != nil {
			return fmt.Errorf("unmarshal JSON value: %w", err)
		}
		return nil
	}

	data, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("marshal JSON value: %w", err)
	}
	if err := json.Unmarshal(data, target); err != nil {
		return fmt.Errorf("unmarshal JSON value: %w", err)
	}
	return nil
}

func isTool(e ToolUsageEventLike, name string) bool {
	if e.ToolName == nil {
		return false
	}
	return strings.ToLower(strings.TrimSpace(*e.ToolName)) == name
}

// IsCodeExecutionEvent checks if the event is a code execution event.
func IsCodeExecutionEvent(e ToolUsageEventLike) bool { return isTool(e, "execute_code") }

// IsSearchEvent checks if the event is a search event.
func IsSearchEvent(e ToolUsageEventLike) bool { return isTool(e, "search_web") }

// ExtractCodeExecutionArgs extracts code execution arguments from a raw value.
func ExtractCodeExecutionArgs(a any) (CodeExecutionArgs, error) {
	var res CodeExecutionArgs
	if err := decodeJSONLike(a, &res); err != nil {
		return CodeExecutionArgs{}, fmt.Errorf("extract code execution args: %w", err)
	}
	return res, nil
}

// ExtractSearchArgs extracts search arguments from a raw value.
func ExtractSearchArgs(a any) (SearchArgs, error) {
	var res SearchArgs
	if err := decodeJSONLike(a, &res); err != nil {
		return SearchArgs{}, fmt.Errorf("extract search args: %w", err)
	}
	return res, nil
}

// ParseCodeExecutionPreview parses a code execution preview string.
func ParseCodeExecutionPreview(p string) (CodeExecutionPreview, error) {
	var res CodeExecutionPreview
	if err := decodeJSONLike(p, &res); err != nil {
		return CodeExecutionPreview{Raw: p}, fmt.Errorf("parse code execution preview: %w", err)
	}
	if res.Output != "" || res.Errors != "" {
		return res, nil
	}
	return CodeExecutionPreview{Raw: p}, nil
}

// ParseSearchPreview parses a search preview string.
func ParseSearchPreview(p string) (SearchPreview, error) {
	type searchPrevInternal struct {
		Results      []SearchPreviewResult `json:"results"`
		Links        []SearchPreviewResult `json:"links"`
		TotalResults *int                  `json:"totalResults,omitempty"`
	}
	var sp searchPrevInternal
	if err := decodeJSONLike(p, &sp); err != nil {
		return SearchPreview{Results: []SearchPreviewResult{}}, fmt.Errorf("parse search preview: %w", err)
	}

	res := SearchPreview{}
	if len(sp.Results) > 0 {
		res.Results = sp.Results
	} else {
		res.Results = sp.Links
	}

	if sp.TotalResults != nil {
		res.TotalResults = *sp.TotalResults
	} else {
		res.TotalResults = len(res.Results)
	}
	return res, nil
}

// SafeArgsForDisplay converts raw arguments into a map for display, ensuring they are valid.
func SafeArgsForDisplay(a any) Result[map[string]any] {
	v := sj(a)
	if m, ok := v.(map[string]any); ok {
		return Ok(m)
	}
	return Err[map[string]any](errors.New("INVALID_ARGS"))
}
