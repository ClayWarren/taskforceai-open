package platform

import (
	"html"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

const MaxPromptLength = 10000

var suspiciousPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)<script\b[^>]*>[\s\S]*?<\/script>`),
	regexp.MustCompile(`(?i)<script\b[^>]*>`),
	regexp.MustCompile(`(?i)javascript:`),
	regexp.MustCompile(`(?i)<iframe\b[^>]*>`),
	regexp.MustCompile(`(?i)<\/iframe>`),
	regexp.MustCompile(`(?i)<object\b[^>]*>`),
	regexp.MustCompile(`(?i)<\/object>`),
	regexp.MustCompile(`(?i)<embed\b[^>]*>`),
}

var eventHandlerAttrStripPattern = regexp.MustCompile(`(?i)\s*\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)`)

type SanitizationResult struct {
	Sanitized string
	Warnings  []string
	IsSafe    bool
}

func SanitizePrompt(input string) SanitizationResult {
	warnings := []string{}
	sanitized := input

	decoded := html.UnescapeString(sanitized)
	if decoded != sanitized {
		sanitized = decoded
		warnings = append(warnings, "HTML entities decoded from input")
	}

	if utf8.RuneCountInString(sanitized) > MaxPromptLength {
		warnings = append(warnings, "Input truncated to 10000 characters")
		sanitized = string([]rune(sanitized)[:MaxPromptLength])
	}

	if strings.Contains(sanitized, "\x00") {
		warnings = append(warnings, "Null bytes removed from input")
		sanitized = strings.ReplaceAll(sanitized, "\x00", "")
	}

	for {
		changed := false
		for _, pattern := range suspiciousPatterns {
			if pattern.MatchString(sanitized) {
				match := pattern.FindString(sanitized)
				cleanMatch := strings.ReplaceAll(match, "\\", "")
				updated := pattern.ReplaceAllString(sanitized, "")
				if updated != sanitized {
					warnings = append(warnings, "Suspicious pattern removed: "+cleanMatch)
					sanitized = updated
					changed = true
				}
			}
		}

		if eventHandlerAttrStripPattern.MatchString(sanitized) {
			updated := eventHandlerAttrStripPattern.ReplaceAllString(sanitized, "")
			if updated != sanitized {
				warnings = append(warnings, "Suspicious event handler attributes removed")
				sanitized = updated
				changed = true
			}
		}

		if !changed {
			break
		}
	}

	sanitized = strings.TrimSpace(sanitized)

	return SanitizationResult{
		Sanitized: sanitized,
		Warnings:  warnings,
		IsSafe:    len(warnings) == 0,
	}
}

func ValidatePrompt(input string) (bool, string) {
	if input == "" {
		return false, "Prompt must be a non-empty string"
	}
	if isPromptEffectivelyEmpty(input) {
		return false, "Prompt cannot be empty"
	}

	if utf8.RuneCountInString(input) > MaxPromptLength {
		return false, "Prompt is too long"
	}

	return true, ""
}

func isPromptEffectivelyEmpty(input string) bool {
	for _, r := range input {
		if unicode.IsSpace(r) || isInvisiblePromptRune(r) {
			continue
		}
		return false
	}
	return true
}

func isInvisiblePromptRune(r rune) bool {
	switch r {
	case '\u200B', '\u200C', '\u200D', '\u2060', '\uFEFF':
		return true
	default:
		return false
	}
}
