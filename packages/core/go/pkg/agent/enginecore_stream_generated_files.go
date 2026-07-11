package agent

import (
	"strings"
)

func (s *agentStream) shouldRequireGeneratedFileTool(content string, toolCalls []ToolCall, generatedFileToolUsed bool) bool {
	if !s.opts.requireGeneratedFileTool || generatedFileToolUsed {
		return false
	}
	if hasGeneratedFileToolCall(toolCalls) {
		return false
	}
	if strings.TrimSpace(content) != "" {
		return true
	}
	return hasPrematureGeneratedFileCompletionCall(toolCalls)
}

func generatedFileToolRequiredCorrection() string {
	return "You must create the requested downloadable file by calling the matching generated-file tool now. Do not explain how to create it manually, do not provide copy/paste instructions, and do not call mark_task_complete before creating the file."
}

func hasGeneratedFileToolCall(toolCalls []ToolCall) bool {
	for _, toolCall := range toolCalls {
		if isGeneratedFileToolName(toolCall.Function.Name) {
			return true
		}
	}
	return false
}

func hasPrematureGeneratedFileCompletionCall(toolCalls []ToolCall) bool {
	for _, toolCall := range toolCalls {
		if toolCall.Function.Name == "mark_task_complete" {
			return true
		}
	}
	return false
}

func isGeneratedFileToolName(name string) bool {
	switch name {
	case "create_spreadsheet", "create_document", "create_presentation", "create_archive", "create_csv", "create_pdf", "create_chart", "create_site":
		return true
	default:
		return false
	}
}
