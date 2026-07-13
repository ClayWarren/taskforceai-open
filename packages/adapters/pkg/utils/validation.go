package utils

import (
	"regexp"
	"strings"
)

var emailRegex = regexp.MustCompile(`^[A-Za-z0-9_%+\-]+(?:\.[A-Za-z0-9_%+\-]+)*@[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?)+$`)

const (
	MaxEmailLength          = 254
	MaxEmailLocalPartLength = 64
)

func IsValidEmail(email string) bool {
	if len(email) == 0 || len(email) > MaxEmailLength {
		return false
	}

	firstAt := strings.IndexByte(email, '@')
	lastAt := strings.LastIndexByte(email, '@')
	if firstAt <= 0 || firstAt != lastAt || firstAt == len(email)-1 {
		return false
	}

	if len(email[:firstAt]) > MaxEmailLocalPartLength {
		return false
	}

	return emailRegex.MatchString(email)
}
