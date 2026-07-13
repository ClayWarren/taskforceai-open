package utils

import (
	"strings"
	"testing"
)

func TestValidation(t *testing.T) {
	t.Run("IsValidEmail", func(t *testing.T) {
		assert := func(email string, expected bool) {
			if got := IsValidEmail(email); got != expected {
				t.Errorf("IsValidEmail(%q) = %v, want %v", email, got, expected)
			}
		}
		assert("test@example.com", true)
		assert("test.name@example.com", true)
		assert("USER.Name+tag@example.com", true)
		assert("test@sub.example.technology", true)
		assert("", false)
		assert(strings.Repeat("a", MaxEmailLength+1), false)
		assert("invalid-email", false)
		assert("@example.com", false)
		assert("test@", false)
		assert(".user@example.com", false)
		assert("user.@example.com", false)
		assert("a..b@example.com", false)
		assert("user@-example.com", false)
		assert("user@example..com", false)
		assert(strings.Repeat("a", 64)+"@example.com", true)
		assert(strings.Repeat("a", 65)+"@example.com", false)
	})
}
