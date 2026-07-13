package tools

import (
	"fmt"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
)

// question simply returns the prompt for external UI handling.
func toolQuestion(ctx protocol.ToolContext, args map[string]any) ToolResult {
	state := NewToolResult(args)
	parsed, missing, invalid := parseQuestionArgs(args)
	if len(missing) > 0 {
		return invalidArgs("question", args, missing...)
	}
	if invalid {
		return invalidArgs("question", args, "invalid questions")
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
