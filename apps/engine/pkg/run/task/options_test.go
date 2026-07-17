package task

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestNormalizeTaskMode(t *testing.T) {
	cases := []struct {
		input string
		want  string
	}{
		{input: "chat", want: TaskModeChat},
		{input: "work", want: TaskModeWork},
		{input: "code", want: TaskModeCode},
		{input: " Work ", want: TaskModeWork},
		{input: "CODE", want: TaskModeCode},
		{input: ""},
		{input: "unknown"},
		{input: "agent"},
	}
	for _, testCase := range cases {
		assert.Equal(t, testCase.want, NormalizeTaskMode(testCase.input), "input %q", testCase.input)
	}
}
