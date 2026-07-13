package agent

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestChatCompletionMessage_HasImages(t *testing.T) {
	tests := []struct {
		name     string
		message  ChatCompletionMessage
		expected bool
	}{
		{
			name: "no content parts",
			message: ChatCompletionMessage{
				Content: "hello",
			},
			expected: false,
		},
		{
			name: "text only parts",
			message: ChatCompletionMessage{
				ContentParts: []ContentPart{
					{Type: ContentPartText, Text: "hello"},
				},
			},
			expected: false,
		},
		{
			name: "with image part",
			message: ChatCompletionMessage{
				ContentParts: []ContentPart{
					{Type: ContentPartText, Text: "look at this"},
					{Type: ContentPartImageURL, ImageURL: &ImageURLPart{URL: "http://example.com/img.png"}},
				},
			},
			expected: true,
		},
		{
			name: "image part with nil URL",
			message: ChatCompletionMessage{
				ContentParts: []ContentPart{
					{Type: ContentPartImageURL, ImageURL: nil},
				},
			},
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, tt.message.HasImages())
		})
	}
}

func TestChatCompletionMessage_TextContent(t *testing.T) {
	tests := []struct {
		name     string
		message  ChatCompletionMessage
		expected string
	}{
		{
			name: "simple content",
			message: ChatCompletionMessage{
				Content: "hello",
			},
			expected: "hello",
		},
		{
			name: "multiple text parts",
			message: ChatCompletionMessage{
				ContentParts: []ContentPart{
					{Type: ContentPartText, Text: "hello"},
					{Type: ContentPartText, Text: "world"},
				},
			},
			expected: "hello\nworld",
		},
		{
			name: "text and image parts",
			message: ChatCompletionMessage{
				ContentParts: []ContentPart{
					{Type: ContentPartText, Text: "hello"},
					{Type: ContentPartImageURL, ImageURL: &ImageURLPart{URL: "..."}},
					{Type: ContentPartText, Text: "world"},
				},
			},
			expected: "hello\nworld",
		},
		{
			name: "empty content parts",
			message: ChatCompletionMessage{
				ContentParts: []ContentPart{},
				Content:      "fallback",
			},
			expected: "fallback",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, tt.message.TextContent())
		})
	}
}
