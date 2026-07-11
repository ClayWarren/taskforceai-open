package core

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSummaryGenerator(t *testing.T) {
	s := SummaryGenerator{MaxLines: 10, MaxChars: 100}

	messages := []Message{
		{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "request 1"}}},
		{Info: MessageInfo{Role: RoleAssistant}, Parts: []Part{
			{Type: PartText, Text: "thought 1"},
			{Type: PartTool, Tool: "read", State: &ToolState{Status: "completed", Input: map[string]any{"filePath": "f1.txt"}}},
		}},
	}

	t.Run("Generate", func(t *testing.T) {
		sum := s.Generate(messages)
		assert.Contains(t, sum, "Summary:")
		assert.Contains(t, sum, "request 1")
		assert.Contains(t, sum, "f1.txt")
	})

	t.Run("truncateSummary", func(t *testing.T) {
		long := strings.Repeat("a", 200)
		trunc := truncateSummary(long, 50)
		assert.LessOrEqual(t, len(trunc), 50)

		// Truncate at newline
		withNewline := `line 1
line 2
line 3`
		trunc2 := truncateSummary(withNewline, 10)
		assert.Equal(t, "line 1", trunc2)
	})

	t.Run("helpers skip summaries and normalize content", func(t *testing.T) {
		title := "readme"
		richMessages := []Message{
			{Info: MessageInfo{Role: RoleUser, Summary: true}, Parts: []Part{{Type: PartText, Text: "old"}}},
			{Info: MessageInfo{Role: RoleUser}, Parts: []Part{{Type: PartText, Text: "  hello\nworld  "}}},
			{Info: MessageInfo{Role: RoleAssistant}, Parts: []Part{
				{Type: PartReason, Text: "skip"},
				{Type: PartTool, Tool: "read", State: &ToolState{Title: &title, Input: map[string]any{"path": "src/main.go"}}},
				{Type: PartTool, Tool: "write", State: &ToolState{Input: map[string]any{"filepath": "src/main.go"}}},
				{Type: PartTool, Tool: "edit", State: &ToolState{Input: map[string]any{"file": "README.md"}}},
			}},
		}

		assert.Equal(t, []string{"hello world"}, collectTexts(richMessages, RoleUser, 4))
		assert.Equal(t, []string{"read: readme", "write", "edit"}, collectTools(richMessages, 8))
		assert.Equal(t, []string{"src/main.go", "README.md"}, collectFiles(richMessages, 8))
		assert.Equal(t, "hello world", lastText(richMessages, RoleUser))
		assert.Empty(t, normalizeLine("   "))
		assert.Empty(t, truncateSummary("", 10))
		assert.Equal(t, "unchanged", truncateSummary("unchanged", 0))
	})
}
