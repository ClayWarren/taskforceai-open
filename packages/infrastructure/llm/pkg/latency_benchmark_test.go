package pkg

import (
	"context"
	"io"
	"sort"
	"testing"
	"time"

	"github.com/TaskForceAI/core/pkg/agent"
)

type benchmarkLLMProvider struct {
	firstChunkDelay time.Duration
	terminalDelay   time.Duration
}

func (p benchmarkLLMProvider) CreateChatCompletion(context.Context, agent.ChatCompletionCreateParams) (*agent.ChatCompletion, error) {
	return &agent.ChatCompletion{
		ID: "chatcmpl-benchmark",
		Choices: []agent.ChatCompletionChoice{{
			Message: agent.ChatCompletionMessage{Role: agent.RoleAssistant, Content: "complete"},
		}},
		Usage: agent.ChatCompletionUsage{PromptTokens: 8, CompletionTokens: 4, TotalTokens: 12},
	}, nil
}

func (p benchmarkLLMProvider) CreateChatCompletionStream(ctx context.Context, _ agent.ChatCompletionCreateParams, onChunk func(agent.ChatCompletionChunk)) error {
	if p.firstChunkDelay > 0 {
		select {
		case <-time.After(p.firstChunkDelay):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	onChunk(agent.ChatCompletionChunk{Choices: []agent.ChatCompletionChunkChoice{{
		Delta: agent.ChatCompletionChunkDelta{Content: "first"},
	}}})
	if p.terminalDelay > 0 {
		select {
		case <-time.After(p.terminalDelay):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	onChunk(agent.ChatCompletionChunk{Usage: &agent.ChatCompletionUsage{
		PromptTokens: 8, CompletionTokens: 4, TotalTokens: 12,
	}})
	return nil
}

func (p benchmarkLLMProvider) UploadFile(context.Context, io.Reader, string, string) (string, error) {
	return "file-benchmark", nil
}

func BenchmarkLLMStreamingLatencyProfile(b *testing.B) {
	provider := benchmarkLLMProvider{
		firstChunkDelay: time.Millisecond,
		terminalDelay:   time.Millisecond,
	}
	adapter := &RoutingAdapter{
		openai:       provider,
		anthropic:    provider,
		gemini:       provider,
		defaultModel: "openai/gpt-5.6-sol",
	}
	params := agent.ChatCompletionCreateParams{
		Model: "openai/gpt-5.6-sol",
		Messages: []agent.ChatCompletionMessage{{
			Role:    agent.RoleUser,
			Content: "Summarize the benchmark fixture.",
		}},
	}
	firstTokenSamples := make([]time.Duration, 0, b.N)
	terminalSamples := make([]time.Duration, 0, b.N)

	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		startedAt := time.Now()
		firstRecorded := false
		err := adapter.CreateChatCompletionStream(context.Background(), params, func(chunk agent.ChatCompletionChunk) {
			if !firstRecorded && len(chunk.Choices) > 0 && chunk.Choices[0].Delta.Content != "" {
				firstTokenSamples = append(firstTokenSamples, time.Since(startedAt))
				firstRecorded = true
			}
		})
		terminalSamples = append(terminalSamples, time.Since(startedAt))
		if err != nil {
			b.Fatal(err)
		}
		if !firstRecorded {
			b.Fatal("first token was not recorded")
		}
	}
	b.StopTimer()

	reportLLMStreamingLatencyProfile(b, "first_token", firstTokenSamples)
	reportLLMStreamingLatencyProfile(b, "terminal_event", terminalSamples)
}

func reportLLMStreamingLatencyProfile(b *testing.B, name string, samples []time.Duration) {
	b.Helper()
	if len(samples) == 0 {
		b.Fatalf("no %s latency samples recorded", name)
	}
	ordered := append([]time.Duration(nil), samples...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	b.ReportMetric(llmStreamingDurationMicroseconds(llmStreamingPercentileDuration(ordered, 0.50)), name+"_p50_us")
	b.ReportMetric(llmStreamingDurationMicroseconds(llmStreamingPercentileDuration(ordered, 0.95)), name+"_p95_us")
	b.ReportMetric(llmStreamingDurationMicroseconds(llmStreamingPercentileDuration(ordered, 0.99)), name+"_p99_us")
}

func llmStreamingPercentileDuration(ordered []time.Duration, percentile float64) time.Duration {
	if len(ordered) == 0 {
		return 0
	}
	index := int(float64(len(ordered))*percentile + 0.999999)
	if index < 1 {
		index = 1
	}
	if index > len(ordered) {
		index = len(ordered)
	}
	return ordered[index-1]
}

func llmStreamingDurationMicroseconds(duration time.Duration) float64 {
	return float64(duration.Nanoseconds()) / float64(time.Microsecond)
}
