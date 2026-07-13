package orchestrator

import (
	"regexp"
	"strings"

	"github.com/TaskForceAI/core/pkg/platform"
)

// RequiresCurrentData detects queries that need fresh, current information
// and should bypass the cache (news, current events, recent developments, etc.)
func RequiresCurrentData(userInput string) bool {
	normalized := strings.ToLower(userInput)

	// Time-sensitive keywords that indicate need for current data
	currentDataPatterns := []string{
		`(latest|newest|recent|current|today'?s?|this week'?s?|this month'?s?)`,
		`(news|headlines|updates?|developments?|happenings?|events?)`,
		`what('?s| is) (happening|going on|new)`,
		`(biggest|top|major|breaking) (news|story|stories|headlines?)`,
		`(right now|currently|at the moment|as of)`,
		`(2024|2025|2026)`, // Current years - adjust as needed
		`(yesterday|last week|last month)`,
		`(stock|market|price|weather|score|election|vote)`,
	}

	return matchesAnyRegex(normalized, currentDataPatterns)
}

func RequiresScienceReference(userInput string) bool {
	normalized := strings.ToLower(userInput)
	return strings.HasPrefix(normalized, "what is the correct answer to this question:") &&
		strings.Contains(normalized, "choices:")
}

func IsMathEvaluationQuery(userInput string) bool {
	normalized := strings.ToLower(userInput)

	evalPatterns := []string{
		`what is the correct answer to this question:`,
		`solve (the )?following (problem|equation)`,
		`calculate|compute|find the (value|solution)`,
		`prove (that|the following)`,
		`choices:\s*\([a-e]\)`,
		`select (the correct|one) (answer|option)`,
		`aime|gpqa|mmlu|math (problem|question)`,
	}

	if !matchesAnyRegex(normalized, evalPatterns) {
		return false
	}

	conversationalPatterns := []string{
		`what('?s| is) the (latest|biggest|top|recent|current) (news|update|story|development)`,
		`tell me about`,
		`explain (what|how|why)`,
		`how (do|does|can|should)`,
		`who (is|are|was|were)`,
		`summarize|overview`,
	}

	return !matchesAnyRegex(normalized, conversationalPatterns)
}

func matchesAnyRegex(input string, patterns []string) bool {
	for _, pattern := range patterns {
		if matchesRegexCaseInsensitive(input, pattern) {
			return true
		}
	}
	return false
}

func matchesRegexCaseInsensitive(input string, pattern string) bool {
	match, err := regexp.MatchString("(?i)"+pattern, input)
	if err != nil {
		platform.GetLogger().Error("Invalid query classifier regex pattern", "pattern", pattern, "error", err)
		return false
	}
	return match
}
