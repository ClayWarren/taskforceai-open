package pulse

import (
	"fmt"
	"io"
	"log/slog"
	"sync/atomic"
	"testing"
	"time"
)

func init() {
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func BenchmarkEventStoreEnqueueCappedSession(b *testing.B) {
	store := NewEventStore()
	sessionKey := " session-1 "
	contextKey := " Context-Key "

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		store.Enqueue(sessionKey, fmt.Sprintf("event-%d", i), contextKey)
	}
}

func BenchmarkEventStoreEnqueuePrecomputedCappedSession(b *testing.B) {
	store := NewEventStore()
	sessionKey := " session-1 "
	contextKey := " Context-Key "
	texts := make([]string, 1024)
	for i := range texts {
		texts[i] = fmt.Sprintf("event-%d", i)
	}

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		store.Enqueue(sessionKey, texts[i%len(texts)], contextKey)
	}
}

func BenchmarkIsWithinActiveHoursNamedTimezone(b *testing.B) {
	active := &ActiveHours{
		Start:    "09:00",
		End:      "17:00",
		Timezone: "America/Chicago",
		Days:     []int32{1, 2, 3, 4, 5},
	}
	now := time.Date(2026, 6, 19, 15, 30, 0, 0, time.UTC)

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		if !IsWithinActiveHours(now, active) {
			b.Fatal("expected time to be active")
		}
	}
}

func BenchmarkIsWithinActiveHoursWrappingWindow(b *testing.B) {
	active := &ActiveHours{
		Start:    "22:00",
		End:      "06:00",
		Timezone: "UTC",
		Days:     []int32{5},
	}
	now := time.Date(2026, 6, 20, 2, 30, 0, 0, time.UTC)

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		if !IsWithinActiveHours(now, active) {
			b.Fatal("expected time to be active")
		}
	}
}

func BenchmarkRunnerTickNotDueAgents(b *testing.B) {
	runner := NewRunner(nil, nil, nil)
	for i := 0; i < 1000; i++ {
		runner.UpsertAgent(fmt.Sprintf("agent-%04d", i), time.Hour, nil)
	}

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		runner.tick()
	}
}

func BenchmarkRunnerTickDueAgents(b *testing.B) {
	var triggers atomic.Int64
	runner := NewRunner(
		func(string, string) error {
			triggers.Add(1)
			return nil
		},
		func(string) bool { return false },
		nil,
	)
	for i := 0; i < 100; i++ {
		runner.UpsertAgent(fmt.Sprintf("agent-%04d", i), time.Hour, nil)
	}

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		runner.mu.Lock()
		nextDue := time.Now().Add(-time.Second)
		for _, state := range runner.agents {
			state.NextDue = nextDue
		}
		runner.mu.Unlock()

		runner.tick()
	}
}
