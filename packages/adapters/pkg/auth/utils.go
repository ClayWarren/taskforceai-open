package auth

import (
	"regexp"
	"strings"

	"github.com/TaskForceAI/adapters/pkg/utils"
)

var (
	// UsernameRegex defines the allowed characters and length for a username.
	UsernameRegex = regexp.MustCompile(`^[a-zA-Z0-9._-]{3,32}$`)

	sanitize1Regex = regexp.MustCompile(`[^a-z0-9._-]+`)
	sanitize2Regex = regexp.MustCompile(`^[._-]+|[._-]+$`)
)

// IsValidUsername checks if a username meets the required criteria.
func IsValidUsername(username string) bool {
	return UsernameRegex.MatchString(username)
}

// IsValidEmail checks if an email address is valid.
func IsValidEmail(email string) bool {
	return utils.IsValidEmail(email)
}

// SanitizeUsernameCandidate normalizes an input string into a safe username.
func SanitizeUsernameCandidate(input string) string {
	trimmed := strings.ToLower(strings.TrimSpace(input))
	cleaned := sanitize1Regex.ReplaceAllString(trimmed, "")
	stripped := sanitize2Regex.ReplaceAllString(cleaned, "")
	if stripped == "" {
		stripped = "user"
	}
	if len(stripped) > 32 {
		stripped = sanitize2Regex.ReplaceAllString(stripped[:32], "")
	}
	return stripped
}
