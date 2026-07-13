package utils

import "strings"

func Truncate(str string, maxLength int) string {
	if maxLength <= 0 {
		return ""
	}
	if len(str) <= maxLength {
		return str
	}
	prefixLength := maxLength - 3
	prefixCutoff := 0
	count := 0
	for i := range str {
		if maxLength > 3 && count == prefixLength {
			prefixCutoff = i
		}
		if count == maxLength {
			if maxLength <= 3 {
				return strings.Repeat(".", maxLength)
			}
			return str[:prefixCutoff] + "..."
		}
		count++
	}
	return str
}
