package run

import (
	"fmt"
	"strconv"
	"strings"
	"testing"

	"github.com/TaskForceAI/core/pkg/agent"
)

var benchmarkMessageMetadataSources []byte
var benchmarkMessageSources []messageSource
var benchmarkUsageID string

func BenchmarkBuildMessageMetadataTypedToolEvents(b *testing.B) {
	agentStatuses := []map[string]any{{
		"agent_id": 0,
		"status":   "COMPLETED",
		"model":    "gpt-5.6-sol",
	}}
	toolEvents := make([]agent.ToolEvent, 0, 160)
	for i := range 160 {
		toolEvents = append(toolEvents, agent.ToolEvent{
			AgentLabel:    "Agent",
			ToolName:      "search_web",
			Success:       true,
			DurationMs:    int64(i * 3),
			Arguments:     map[string]any{"query": "latest taskforce progress"},
			ResultPreview: strings.Repeat("preview ", 20),
			Sources: []agent.SourceReference{{
				URL:     "https://example.com/source",
				Title:   "Example",
				Snippet: "Snippet",
			}},
		})
	}
	task := &TaskState{
		AgentStatuses: agentStatuses,
		ToolEvents:    toolEvents,
	}

	b.ReportAllocs()
	for b.Loop() {
		sourcesData, _, _, err := buildMessageMetadata(task)
		if err != nil {
			b.Fatal(err)
		}
		benchmarkMessageMetadataSources = sourcesData
	}
}

func BenchmarkExtractSourcesFromAnyMapToolEvents(b *testing.B) {
	toolEvents := make([]any, 0, 160)
	for i := range 160 {
		toolEvents = append(toolEvents, map[string]any{
			"toolName": "search_web",
			"sources": []any{map[string]any{
				"url":     fmt.Sprintf("https://example.com/source/%d", i%16),
				"title":   "Example",
				"snippet": "Snippet",
			}},
		})
	}

	b.Run("previous", func(b *testing.B) {
		b.ReportAllocs()
		for b.Loop() {
			sources, ok := extractSourcesFromAnyMapToolEventsPrevious(toolEvents)
			if !ok {
				b.Fatal("expected sources")
			}
			benchmarkMessageSources = sources
		}
	})
	b.Run("direct", func(b *testing.B) {
		b.ReportAllocs()
		for b.Loop() {
			sources, ok := extractSourcesFromToolEvents(toolEvents)
			if !ok {
				b.Fatal("expected sources")
			}
			benchmarkMessageSources = sources
		}
	})
}

func extractSourcesFromAnyMapToolEventsPrevious(events []any) ([]messageSource, bool) {
	maps := make([]map[string]any, 0, len(events))
	for _, event := range events {
		eventMap, ok := event.(map[string]any)
		if !ok {
			return nil, false
		}
		maps = append(maps, eventMap)
	}
	return extractSourcesFromMapEvents(maps), true
}

func BenchmarkUsageIDFormatting(b *testing.B) {
	b.Run("fmt", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			benchmarkUsageID = fmt.Sprintf("%d", i)
		}
	})
	b.Run("itoa", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			benchmarkUsageID = strconv.Itoa(i)
		}
	})
}
