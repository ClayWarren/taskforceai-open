package filesystem

import "github.com/TaskForceAI/core/pkg/enginecore/tools/internal/toolutil"

type readArgs struct {
	filePath string
	offset   int
	limit    int
}

func parseReadArgs(args map[string]any) (readArgs, []string) {
	out := readArgs{limit: 2000, filePath: toolutil.GetString(args, "filePath")}
	missing := []string{}
	if out.filePath == "" {
		missing = append(missing, "missing filePath")
	}
	if value, ok := args["limit"]; ok {
		if number, valid := toolutil.ToInt(value); valid {
			out.limit = number
		}
	}
	if value, ok := args["offset"]; ok {
		if number, valid := toolutil.ToInt(value); valid {
			out.offset = number
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
	out := writeArgs{filePath: filePath, content: content}
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
	filePathValue, hasFile := args["filePath"]
	oldValue, hasOld := args["oldString"]
	newValue, hasNew := args["newString"]
	filePath, filePathOK := filePathValue.(string)
	oldString, oldOK := oldValue.(string)
	newString, newOK := newValue.(string)
	hasFile = hasFile && filePathOK
	hasOld = hasOld && oldOK
	hasNew = hasNew && newOK
	out := editArgs{
		filePath:  filePath,
		oldString: oldString,
		newString: newString,
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
		pattern: toolutil.GetString(args, "pattern"),
		path:    toolutil.GetString(args, "path"),
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
		pattern: toolutil.GetString(args, "pattern"),
		path:    toolutil.GetString(args, "path"),
		include: toolutil.GetString(args, "include"),
	}
	missing := []string{}
	if out.pattern == "" {
		missing = append(missing, "missing pattern")
	}
	return out, missing
}
