package platform

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestSanitizePrompt(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
		safe     bool
	}{
		{
			name:     "Clean input",
			input:    "Hello world",
			expected: "Hello world",
			safe:     true,
		},
		{
			name:     "Input with script tag",
			input:    "Hello <script>alert('xss')</script> world",
			expected: "Hello  world",
			safe:     false,
		},
		{
			name:     "Input with javascript protocol",
			input:    "Click [here](javascript:alert('xss'))",
			expected: "Click [here](alert('xss'))",
			safe:     false,
		},
		{
			name:     "Input with event handler",
			input:    "<img src=x onerror=alert('xss')>",
			expected: "<img src=x>",
			safe:     false,
		},
		{
			name:     "Encoded event handler with quoted tag boundary",
			input:    `<img title="&gt;" onerror=alert(1)>`,
			expected: `<img title=">">`,
			safe:     false,
		},
		{
			name:     "Input with iframe",
			input:    "<iframe src='http://malicious.com'></iframe>",
			expected: "",
			safe:     false,
		},
		{
			name:     "Encoded javascript protocol",
			input:    `<a href="javascript&#58;alert(1)">x</a>`,
			expected: `<a href="alert(1)">x</a>`,
			safe:     false,
		},
		{
			name:     "Nested script tag bypass",
			input:    `Hello <scr<script>ipt>alert(1)</scr<script>ipt> world`,
			expected: "Hello  world",
			safe:     false,
		},
		{
			name:     "Plain assignment preserved",
			input:    "someone=alice",
			expected: "someone=alice",
			safe:     true,
		},
		{
			name:     "Input with null bytes",
			input:    "Hello\x00world",
			expected: "Helloworld",
			safe:     false,
		},
		{
			name:     "Input needing trim",
			input:    "  Hello world  ",
			expected: "Hello world",
			safe:     true,
		},
		{
			name:     "Long input truncation",
			input:    strings.Repeat("a", MaxPromptLength+10),
			expected: strings.Repeat("a", MaxPromptLength),
			safe:     false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := SanitizePrompt(tt.input)
			if result.Sanitized != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, result.Sanitized)
			}
			if result.IsSafe != tt.safe {
				t.Errorf("expected IsSafe %v, got %v", tt.safe, result.IsSafe)
			}
		})
	}
}

func TestSanitizePrompt_TruncateMaintainsUTF8(t *testing.T) {
	multibyte := make([]rune, 0, MaxPromptLength+1)
	for range MaxPromptLength - 1 {
		multibyte = append(multibyte, 'a')
	}
	multibyte = append(multibyte, '😀', '😀')

	result := SanitizePrompt(string(multibyte))
	if !utf8.ValidString(result.Sanitized) {
		t.Fatalf("Sanitized output is invalid UTF-8")
	}
	if utf8.RuneCountInString(result.Sanitized) != MaxPromptLength {
		t.Fatalf("Sanitized rune count = %d, want %d", utf8.RuneCountInString(result.Sanitized), MaxPromptLength)
	}
}

func TestValidatePrompt(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		isValid bool
	}{
		{
			name:    "Valid prompt",
			input:   "Hello world",
			isValid: true,
		},
		{
			name:    "Empty prompt",
			input:   "",
			isValid: false,
		},
		{
			name:    "Whitespace prompt",
			input:   "   ",
			isValid: false,
		},
		{
			name:    "Zero width only prompt",
			input:   "\u200B\u200B",
			isValid: false,
		},
		{
			name:    "Zero width with visible text",
			input:   "\u200Bhello",
			isValid: true,
		},
		{
			name:    "Too long prompt",
			input:   strings.Repeat("a", MaxPromptLength+1),
			isValid: false,
		},
		{
			name:    "Unicode within limit",
			input:   strings.Repeat("😀", 3000),
			isValid: true,
		},
		{
			name:    "Unicode over limit",
			input:   strings.Repeat("😀", MaxPromptLength+1),
			isValid: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			isValid, _ := ValidatePrompt(tt.input)
			if isValid != tt.isValid {
				t.Errorf("expected isValid %v, got %v", tt.isValid, isValid)
			}
		})
	}
}
