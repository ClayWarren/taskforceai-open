package auth

import (
	"regexp"
	"strings"
)

const (
	maxEmailLength          = 254
	maxEmailLocalPartLength = 64
)

var emailPattern = regexp.MustCompile(`^[A-Za-z0-9_%+\-]+(?:\.[A-Za-z0-9_%+\-]+)*@[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?)+$`)

func isValidEmail(email string) bool {
	if len(email) == 0 || len(email) > maxEmailLength {
		return false
	}
	at := strings.IndexByte(email, '@')
	if at <= 0 || at != strings.LastIndexByte(email, '@') || at == len(email)-1 {
		return false
	}
	return len(email[:at]) <= maxEmailLocalPartLength && emailPattern.MatchString(email)
}
