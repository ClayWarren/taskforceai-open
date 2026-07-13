package orchestrator

import (
	"testing"
)

func TestRequiresScienceReference(t *testing.T) {
	tests := []struct {
		input    string
		expected bool
	}{
		{
			input:    "What is the correct answer to this question: What is 2+2? Choices: (A) 4 (B) 5",
			expected: true,
		},
		{
			input:    "Tell me a story",
			expected: false,
		},
		{
			input:    "What is the correct answer to this question: but no choices",
			expected: false,
		},
	}

	for _, tt := range tests {
		if got := RequiresScienceReference(tt.input); got != tt.expected {
			t.Errorf("RequiresScienceReference(%q) = %v, want %v", tt.input, got, tt.expected)
		}
	}
}

func TestRequiresCurrentData(t *testing.T) {
	tests := []struct {
		input    string
		expected bool
	}{
		// Should return true for news/current events queries
		{"What's the latest news in AI?", true},
		{"Biggest news today", true},
		{"Current events in tech", true},
		{"What's happening in the stock market?", true},
		{"Top headlines this week", true},
		{"Recent developments in quantum computing", true},
		{"Breaking news about Tesla", true},
		{"What's new in 2026?", true},
		{"Weather forecast for today", true},
		{"Election results", true},
		{"Market price of Bitcoin", true},

		// Should return false for general queries
		{"What is machine learning?", false},
		{"Explain how neural networks work", false},
		{"Tell me about the history of computers", false},
		{"How do I learn Python?", false},
		{"Write a poem about nature", false},
		{"What is 2+2?", false},
	}

	for _, tt := range tests {
		if got := RequiresCurrentData(tt.input); got != tt.expected {
			t.Errorf("RequiresCurrentData(%q) = %v, want %v", tt.input, got, tt.expected)
		}
	}
}

func TestIsMathEvaluationQuery(t *testing.T) {
	tests := []struct {
		input    string
		expected bool
	}{
		{
			input:    "What is the correct answer to this question: 2+2?",
			expected: true,
		},
		{
			input:    "Solve the following equation: x^2 = 4",
			expected: true,
		},
		{
			input:    "Calculate the value of PI to 10 decimal places",
			expected: true,
		},
		{
			input:    "Solve the following problem: if x=1, what is x+1?",
			expected: true,
		},
		{
			input:    "Prove that the square root of 2 is irrational",
			expected: true,
		},
		{
			input:    "Choices: (a) 1 (b) 2",
			expected: true,
		},
		{
			input:    "Select one answer: option 1",
			expected: true,
		},
		{
			input:    "This is an AIME math problem",
			expected: true,
		},
		{
			input:    "Tell me about math",
			expected: false, // matches 'math' but also 'tell me about'
		},
		{
			input:    "Explain how to solve 2+2",
			expected: false, // matches math pattern but also 'explain'
		},
		{
			input:    "What is the latest news about math?",
			expected: false,
		},
		{
			input:    "Summarize this math problem",
			expected: false, // hits math pattern then summarize
		},
		{
			input:    "Who is the author of this math book?",
			expected: false,
		},
		{
			input:    "How can I solve this?",
			expected: false,
		},
		{
			input:    "Find the solution to X+Y=Z",
			expected: true,
		},
		{
			input:    "Select the correct option",
			expected: true,
		},
		{
			input:    "MLU math question",
			expected: true,
		},
		{
			input:    "Just a random chat message",
			expected: false,
		},
	}

	for _, tt := range tests {
		if got := IsMathEvaluationQuery(tt.input); got != tt.expected {
			t.Errorf("IsMathEvaluationQuery(%q) = %v, want %v", tt.input, got, tt.expected)
		}
	}
}

func TestMatchesRegexCaseInsensitive_InvalidPattern(t *testing.T) {
	if matchesRegexCaseInsensitive("input", "(") {
		t.Fatal("expected invalid regex pattern to return false")
	}
}

func TestRequiresScienceReference_CaseInsensitivePrefix(t *testing.T) {
	input := "WHAT IS THE CORRECT ANSWER TO THIS QUESTION: sample prompt. ChOiCeS: (A) 1 (B) 2"
	if !RequiresScienceReference(input) {
		t.Fatalf("expected case-insensitive science reference detection for %q", input)
	}
}

func TestRequiresCurrentData_AdditionalTemporalPhrases(t *testing.T) {
	tests := []struct {
		input    string
		expected bool
	}{
		{input: "Give me updates as of this month", expected: true},
		{input: "What happened yesterday in Chicago sports?", expected: true},
		{input: "Summarize the fundamentals of statistics", expected: false},
	}

	for _, tt := range tests {
		if got := RequiresCurrentData(tt.input); got != tt.expected {
			t.Errorf("RequiresCurrentData(%q) = %v, want %v", tt.input, got, tt.expected)
		}
	}
}
