package session

import (
	"fmt"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/internal/toolutil"
)

// question simply returns the prompt for external UI handling.
func ExecuteQuestion(ctx protocol.ToolContext, args map[string]any) protocol.ToolResult {
	state := toolutil.NewResult(args)
	parsed, missing, invalid := parseQuestionArgs(args)
	if len(missing) > 0 {
		return toolutil.InvalidArgs("question", args, missing...)
	}
	if invalid {
		return toolutil.InvalidArgs("question", args, "invalid questions")
	}
	if ctx.QuestionAnswerSet && len(parsed.questions) > 0 {
		answer := ctx.QuestionAnswer
		questionText := parsed.questions[0].question
		state.Output = fmt.Sprintf("User has answered your questions: \"%s\"=\"%s\". You can now continue with the user's answers in mind.", questionText, answer)
		state.Title = "Asked 1 question"
		state.TitleSet = true
		state.Metadata = map[string]any{
			"answers":   [][]string{{answer}},
			"truncated": false,
		}
		return state
	}
	state.Output = "Question"
	state.Title = "Question"
	state.TitleSet = true
	state.Metadata = map[string]any{}
	return state
}
