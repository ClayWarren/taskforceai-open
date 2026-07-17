package agent

import (
	"context"
)

type ILLMClient interface {
	CreateChatCompletion(ctx context.Context, params ChatCompletionCreateParams) (*ChatCompletion, error)
	CreateChatCompletionStream(ctx context.Context, params ChatCompletionCreateParams, onChunk func(ChatCompletionChunk)) error
}
