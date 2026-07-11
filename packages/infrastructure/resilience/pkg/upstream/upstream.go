package upstream

import (
	"strings"
	"time"
	"unicode"

	"github.com/TaskForceAI/infrastructure/resilience/pkg/circuitbreaker"
)

var commonTransientFragments = []string{
	"rate limit",
	"rate_limit",
	"rate limited",
	"too many requests",
	"429",
	"500",
	"502",
	"503",
	"504",
	"timeout",
	"timed out",
	"context deadline exceeded",
	"connection refused",
	"connection reset",
	"service unavailable",
}

// CommonTransientFragments contains the default transient error fragments.
//
// Deprecated: use DefaultTransientFragments. IsTransientError does not read
// this mutable slice, so changing it does not alter package-level
// classification behavior.
var CommonTransientFragments = append([]string(nil), commonTransientFragments...)

// DefaultTransientFragments returns a copy of the default transient error fragments.
func DefaultTransientFragments() []string {
	return append([]string(nil), commonTransientFragments...)
}

func ErrorContainsAny(err error, fragments ...string) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return messageContainsAny(msg, fragments)
}

func messageContainsAny(msg string, fragments []string) bool {
	for _, fragment := range fragments {
		normalized := strings.ToLower(fragment)
		if isStatusCodeFragment(normalized) {
			if containsHTTPStatusCode(msg, normalized) {
				return true
			}
			continue
		}
		if strings.Contains(msg, normalized) {
			return true
		}
	}
	return false
}

func isStatusCodeFragment(fragment string) bool {
	if len(fragment) != 3 {
		return false
	}
	for _, r := range fragment {
		if !unicode.IsDigit(r) {
			return false
		}
	}
	return true
}

func containsHTTPStatusCode(msg string, code string) bool {
	trimmed := strings.TrimSpace(msg)
	if trimmed == code {
		return true
	}
	if strings.HasPrefix(trimmed, code) && isBoundaryAfterStatusCode(trimmed, len(code)) {
		return true
	}

	searchStart := 0
	for {
		index := strings.Index(msg[searchStart:], code)
		if index < 0 {
			return false
		}
		index += searchStart
		afterCode := index + len(code)
		if hasStatusCodeBoundaryAfter(msg, afterCode) && hasStatusKeywordBefore(msg, index) {
			return true
		}
		searchStart = afterCode
	}
}

func hasStatusKeywordBefore(msg string, codeIndex int) bool {
	end := trimStatusSpacesBack(msg, codeIndex)
	if end > 0 && (msg[end-1] == ':' || msg[end-1] == '=') {
		end = trimStatusSpacesBack(msg, end-1)
	}

	if hasKeywordSuffix(msg, end, "http") ||
		hasKeywordSuffix(msg, end, "status") ||
		hasKeywordSuffix(msg, end, "code") ||
		hasKeywordSuffix(msg, end, "error") {
		return true
	}

	return hasCompoundKeywordSuffix(msg, end, "http", "status") ||
		hasCompoundKeywordSuffix(msg, end, "status", "code")
}

func hasCompoundKeywordSuffix(msg string, end int, left string, right string) bool {
	leftEnd, ok := keywordSuffixStart(msg, end, right)
	if !ok {
		return false
	}
	leftEnd, ok = trimStatusSeparatorBack(msg, leftEnd)
	if !ok {
		return false
	}
	return hasKeywordSuffix(msg, leftEnd, left)
}

func hasKeywordSuffix(msg string, end int, keyword string) bool {
	start, ok := keywordSuffixStart(msg, end, keyword)
	return ok && hasWordBoundaryBefore(msg, start)
}

func keywordSuffixStart(msg string, end int, keyword string) (int, bool) {
	start := end - len(keyword)
	if start < 0 || msg[start:end] != keyword {
		return 0, false
	}
	return start, true
}

func trimStatusSpacesBack(msg string, end int) int {
	for end > 0 && isStatusWhitespace(msg[end-1]) {
		end--
	}
	return end
}

func trimStatusSeparatorBack(msg string, end int) (int, bool) {
	start := end
	for end > 0 && (isStatusWhitespace(msg[end-1]) || msg[end-1] == '_') {
		end--
	}
	if end == start {
		return start, false
	}
	return end, true
}

func isStatusWhitespace(b byte) bool {
	return b == ' ' || b == '\t' || b == '\n' || b == '\r' || b == '\f' || b == '\v'
}

func hasWordBoundaryBefore(msg string, index int) bool {
	return index == 0 || !isRegexWordChar(msg[index-1])
}

func hasStatusCodeBoundaryAfter(msg string, index int) bool {
	return isBoundaryAfterStatusCode(msg, index)
}

func isRegexWordChar(b byte) bool {
	return b == '_' || (b >= '0' && b <= '9') || (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z')
}

func isBoundaryAfterStatusCode(msg string, index int) bool {
	if len(msg) == index {
		return true
	}
	next := rune(msg[index])
	return !unicode.IsLetter(next) && !unicode.IsDigit(next)
}

func IsTransientError(err error, providerFragments ...string) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	if messageContainsAny(msg, commonTransientFragments) {
		return true
	}
	return messageContainsAny(msg, providerFragments)
}

func NewCircuitBreaker(name string, resetTimeout time.Duration, isTransient func(error) bool) *circuitbreaker.CircuitBreaker {
	return circuitbreaker.New(circuitbreaker.Config{
		Name:                name,
		FailureThreshold:    5,
		ResetTimeout:        resetTimeout,
		SuccessThreshold:    2,
		MaxHalfOpenRequests: 1,
		IsTransient:         isTransient,
	})
}
