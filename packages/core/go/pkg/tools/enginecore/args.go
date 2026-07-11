package tools

type readArgs struct {
	filePath string
	offset   int
	limit    int
}

func parseReadArgs(args map[string]any) (readArgs, []string) {
	out := readArgs{limit: 2000}
	out.filePath = getString(args, "filePath")
	missing := []string{}
	if out.filePath == "" {
		missing = append(missing, "missing filePath")
	}
	if v, ok := args["limit"]; ok {
		if n, ok := toInt(v); ok {
			out.limit = n
		}
	}
	if v, ok := args["offset"]; ok {
		if n, ok := toInt(v); ok {
			out.offset = n
		}
	}
	return out, missing
}

type writeArgs struct {
	filePath string
	content  string
}

func parseWriteArgs(args map[string]any) (writeArgs, []string) {
	filePath, hasFilePath := args["filePath"].(string)
	content, hasContent := args["content"].(string)
	out := writeArgs{
		filePath: filePath,
		content:  content,
	}
	missing := []string{}
	if !hasFilePath || out.filePath == "" {
		missing = append(missing, "missing filePath")
	}
	if !hasContent {
		missing = append(missing, "missing content")
	}
	return out, missing
}

type editArgs struct {
	filePath  string
	oldString string
	newString string
	hasOld    bool
	hasNew    bool
}

func parseEditArgs(args map[string]any) (editArgs, []string) {
	fpVal, hasFile := args["filePath"]
	oldVal, hasOld := args["oldString"]
	newVal, hasNew := args["newString"]
	fpStr, fpOk := fpVal.(string)
	oldStr, oldOk := oldVal.(string)
	newStr, newOk := newVal.(string)
	hasFile = hasFile && fpOk
	hasOld = hasOld && oldOk
	hasNew = hasNew && newOk
	out := editArgs{
		filePath:  fpStr,
		oldString: oldStr,
		newString: newStr,
		hasOld:    hasOld,
		hasNew:    hasNew,
	}
	missing := []string{}
	if !hasFile || out.filePath == "" {
		missing = append(missing, "missing filePath")
	}
	if !out.hasOld {
		missing = append(missing, "missing oldString")
	}
	if !out.hasNew {
		missing = append(missing, "missing newString")
	}
	return out, missing
}

type globArgs struct {
	pattern string
	path    string
}

func parseGlobArgs(args map[string]any) (globArgs, []string) {
	out := globArgs{
		pattern: getString(args, "pattern"),
		path:    getString(args, "path"),
	}
	missing := []string{}
	if out.pattern == "" {
		missing = append(missing, "missing pattern")
	}
	return out, missing
}

type grepArgs struct {
	pattern string
	path    string
	include string
}

func parseGrepArgs(args map[string]any) (grepArgs, []string) {
	out := grepArgs{
		pattern: getString(args, "pattern"),
		path:    getString(args, "path"),
		include: getString(args, "include"),
	}
	missing := []string{}
	if out.pattern == "" {
		missing = append(missing, "missing pattern")
	}
	return out, missing
}

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
		description: getString(args, "description"),
		prompt:      getString(args, "prompt"),
		subagent:    getString(args, "subagent_type"),
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

type webFetchArgs struct {
	url string
}

func parseWebFetchArgs(args map[string]any) webFetchArgs {
	return webFetchArgs{url: getString(args, "url")}
}
