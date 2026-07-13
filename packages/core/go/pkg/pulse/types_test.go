package pulse

import (
	"testing"
	"time"
)

func TestDedupeResponse(t *testing.T) {
	now := time.Date(2026, 2, 12, 10, 0, 0, 0, time.UTC)

	tests := []struct {
		name       string
		state      PulseState
		text       string
		now        time.Time
		wantDedupe bool
	}{
		{
			name:       "empty text - no dedupe",
			state:      PulseState{LastResponse: "prev", LastSentAt: now.Add(-1 * time.Hour)},
			text:       "",
			now:        now,
			wantDedupe: false,
		},
		{
			name:       "empty last response - no dedupe",
			state:      PulseState{LastResponse: "", LastSentAt: now.Add(-1 * time.Hour)},
			text:       "hello",
			now:        now,
			wantDedupe: false,
		},
		{
			name:       "same text within 24h - dedupe",
			state:      PulseState{LastResponse: "hello", LastSentAt: now.Add(-1 * time.Hour)},
			text:       "hello",
			now:        now,
			wantDedupe: true,
		},
		{
			name:       "different text within 24h - no dedupe",
			state:      PulseState{LastResponse: "hello", LastSentAt: now.Add(-1 * time.Hour)},
			text:       "world",
			now:        now,
			wantDedupe: false,
		},
		{
			name:       "same text after 24h - no dedupe",
			state:      PulseState{LastResponse: "hello", LastSentAt: now.Add(-25 * time.Hour)},
			text:       "hello",
			now:        now,
			wantDedupe: false,
		},
		{
			name:       "exactly 24h ago - dedupe (boundary)",
			state:      PulseState{LastResponse: "hello", LastSentAt: now.Add(-24 * time.Hour)},
			text:       "hello",
			now:        now,
			wantDedupe: true, // > 24h returns false, but == 24h returns true
		},
		{
			name:       "just under 24h - dedupe",
			state:      PulseState{LastResponse: "hello", LastSentAt: now.Add(-23*time.Hour - 59*time.Minute)},
			text:       "hello",
			now:        now,
			wantDedupe: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.state.DedupeResponse(tt.text, tt.now)
			if got != tt.wantDedupe {
				t.Errorf("DedupeResponse() = %v, want %v", got, tt.wantDedupe)
			}
		})
	}
}
