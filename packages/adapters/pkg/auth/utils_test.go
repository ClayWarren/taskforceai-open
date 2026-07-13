package auth

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsValidUsername(t *testing.T) {
	tests := []struct {
		username string
		expected bool
	}{
		{"user123", true},
		{"user.name", true},
		{"user_name", true},
		{"user-name", true},
		{"us", false},                    // too short
		{strings.Repeat("a", 33), false}, // too long
		{"user!", false},                 // invalid char
	}

	for _, tt := range tests {
		t.Run(tt.username, func(t *testing.T) {
			assert.Equal(t, tt.expected, IsValidUsername(tt.username))
		})
	}
}

func TestIsValidEmail(t *testing.T) {
	tests := []struct {
		email    string
		expected bool
	}{
		{"test@example.com", true},
		{"USER.Name+tag@example.com", true},
		{"test@sub.example.technology", true},
		{"invalid-email", false},
		{"@example.com", false},
		{"test@", false},
		{"user@example..com", false},
	}

	for _, tt := range tests {
		t.Run(tt.email, func(t *testing.T) {
			assert.Equal(t, tt.expected, IsValidEmail(tt.email))
		})
	}
}

func TestSanitizeUsernameCandidate(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"basic", "JohnDoe", "johndoe"},
		{"whitespace", "  John Doe  ", "johndoe"},
		{"special chars", "John!@#Doe", "johndoe"},
		{"dots and dashes", ".John-Doe_", "john-doe"},
		{"empty results", "!!!", "user"},
		{"too long", "a" + strings.Repeat("b", 40), "abbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
		{"too long then empty", strings.Repeat(".", 40), "user"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, SanitizeUsernameCandidate(tt.input))
		})
	}
}
