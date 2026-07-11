package core

import (
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"
)

var summaryWhitespaceRE = regexp.MustCompile(`\s+`)

// SummaryGenerator produces a deterministic compaction summary.
// It avoids LLM calls while preserving context needed to continue.
type SummaryGenerator struct {
	MaxLines int
	MaxChars int
}

func (s SummaryGenerator) Generate(messages []Message) string {
	maxLines := s.MaxLines
	if maxLines <= 0 {
		maxLines = 24
	}
	maxChars := s.MaxChars
	if maxChars <= 0 {
		maxChars = 2000
	}

	userTexts := collectTexts(messages, RoleUser, 4)
	assistantTexts := collectTexts(messages, RoleAssistant, 4)
	tools := collectTools(messages, 8)
	files := collectFiles(messages, 12)

	var lines []string
	lines = append(lines, "Summary:")
	appendSection := func(title string, items []string) {
		if len(items) == 0 {
			return
		}
		lines = append(lines, title+":")
		for _, item := range items {
			lines = append(lines, "- "+item)
		}
	}

	appendSection("User Requests", userTexts)
	appendSection("Assistant Actions", assistantTexts)
	appendSection("Tools", tools)
	appendSection("Files", files)

	lastUser := lastText(messages, RoleUser)
	if lastUser != "" {
		appendSection("Next", []string{lastUser})
	}

	if len(lines) > maxLines {
		lines = lines[:maxLines]
	}
	out := strings.Join(lines, "\n")
	if utf8.RuneCountInString(out) > maxChars {
		out = truncateSummary(out, maxChars)
	}
	return strings.TrimSpace(out)
}

func collectTexts(messages []Message, role Role, limit int) []string {
	seen := []string{}
	for i := len(messages) - 1; i >= 0 && len(seen) < limit; i-- {
		msg := messages[i]
		if msg.Info.Role != role || msg.Info.Summary {
			continue
		}
		for j := len(msg.Parts) - 1; j >= 0 && len(seen) < limit; j-- {
			part := msg.Parts[j]
			if part.Type != PartText || part.Text == "" {
				continue
			}
			seen = append(seen, normalizeLine(part.Text))
		}
	}
	reverse(seen)
	return seen
}

func collectTools(messages []Message, limit int) []string {
	out := []string{}
	for i := len(messages) - 1; i >= 0 && len(out) < limit; i-- {
		msg := messages[i]
		for j := len(msg.Parts) - 1; j >= 0 && len(out) < limit; j-- {
			part := msg.Parts[j]
			if part.Type != PartTool || part.State == nil {
				continue
			}
			title := part.Tool
			if part.State.Title != nil && *part.State.Title != "" {
				title += ": " + *part.State.Title
			}
			out = append(out, normalizeLine(title))
		}
	}
	reverse(out)
	return out
}

func collectFiles(messages []Message, limit int) []string {
	seen := map[string]struct{}{}
	out := []string{}
	for i := len(messages) - 1; i >= 0 && len(out) < limit; i-- {
		msg := messages[i]
		for j := len(msg.Parts) - 1; j >= 0 && len(out) < limit; j-- {
			part := msg.Parts[j]
			if part.Type != PartTool || part.State == nil {
				continue
			}
			for _, key := range []string{"filePath", "path", "filepath", "file"} {
				if val, ok := part.State.Input[key]; ok {
					if s, ok := val.(string); ok && s != "" {
						if _, exists := seen[s]; !exists {
							seen[s] = struct{}{}
							out = append(out, s)
						}
					}
				}
			}
		}
	}
	reverse(out)
	return out
}

func truncateSummary(text string, maxChars int) string {
	if maxChars <= 0 || text == "" {
		return text
	}
	if len(text) <= maxChars {
		return text
	}
	runes := []rune(text)
	if len(runes) <= maxChars {
		return text
	}
	cut := runes[:maxChars]
	lastNewline := -1
	for i, c := range slices.Backward(cut) {
		if c == '\n' {
			lastNewline = i
			break
		}
	}
	if lastNewline > maxChars/2 {
		cut = cut[:lastNewline]
	}
	return string(cut)
}

func lastText(messages []Message, role Role) string {
	for _, msg := range slices.Backward(messages) {
		if msg.Info.Role != role {
			continue
		}
		for _, part := range slices.Backward(msg.Parts) {
			if part.Type == PartText && part.Text != "" {
				return normalizeLine(part.Text)
			}
		}
	}
	return ""
}

func normalizeLine(input string) string {
	input = strings.TrimSpace(input)
	if input == "" {
		return ""
	}
	return summaryWhitespaceRE.ReplaceAllString(input, " ")
}

func reverse(items []string) {
	for i, j := 0, len(items)-1; i < j; i, j = i+1, j-1 {
		items[i], items[j] = items[j], items[i]
	}
}
