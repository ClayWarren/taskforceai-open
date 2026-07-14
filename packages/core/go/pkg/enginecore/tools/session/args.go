package session

import "github.com/TaskForceAI/core/pkg/enginecore/tools/internal/toolutil"

type questionItem struct {
	header   string
	question string
	options  []map[string]any
}

type questionArgs struct {
	questions []questionItem
}

func parseQuestionArgs(args map[string]any) (questionArgs, []string, bool) {
	raw, ok := args["questions"].([]any)
	if !ok || len(raw) == 0 {
		return questionArgs{}, []string{"missing questions"}, false
	}
	questions := make([]questionItem, 0, len(raw))
	invalid := false
	for _, entry := range raw {
		q, okEntry := entry.(map[string]any)
		if !okEntry {
			invalid = true
			q = map[string]any{}
		}
		header, headerOk := q["header"].(string)
		question, okQ := q["question"].(string)
		options, hasOptions := q["options"].([]any)
		if question == "" || !okQ || header == "" || !headerOk || !hasOptions {
			invalid = true
		}
		opts := make([]map[string]any, 0, len(options))
		for _, opt := range options {
			if m, ok := opt.(map[string]any); ok {
				opts = append(opts, m)
			} else {
				invalid = true
			}
		}
		questions = append(questions, questionItem{
			header:   header,
			question: question,
			options:  opts,
		})
	}
	return questionArgs{questions: questions}, nil, invalid
}

type taskArgs struct {
	description string
	prompt      string
	subagent    string
}

func parseTaskArgs(args map[string]any) (taskArgs, []string) {
	out := taskArgs{
		description: toolutil.GetString(args, "description"),
		prompt:      toolutil.GetString(args, "prompt"),
		subagent:    toolutil.GetString(args, "subagent_type"),
	}
	missing := []string{}
	if out.description == "" {
		missing = append(missing, "missing description")
	}
	if out.prompt == "" {
		missing = append(missing, "missing prompt")
	}
	if out.subagent == "" {
		missing = append(missing, "missing subagent_type")
	}
	return out, missing
}

type todoArgs struct {
	todos []map[string]any
}

func parseTodoArgs(args map[string]any) (todoArgs, []string, bool) {
	raw, ok := args["todos"].([]any)
	if !ok {
		return todoArgs{}, []string{"missing todos"}, false
	}
	normalized := make([]map[string]any, 0, len(raw))
	invalid := false
	for _, item := range raw {
		todo, ok := item.(map[string]any)
		if !ok {
			invalid = true
			todo = map[string]any{}
		}
		contentMissing := isMissingString(todo, "content")
		statusMissing := isMissingString(todo, "status")
		priorityMissing := isMissingString(todo, "priority")
		idMissing := isMissingString(todo, "id")
		if contentMissing || statusMissing || priorityMissing || (idMissing && (!statusMissing || contentMissing || priorityMissing)) {
			invalid = true
		}
		normalized = append(normalized, todo)
	}
	return todoArgs{todos: normalized}, nil, invalid
}
