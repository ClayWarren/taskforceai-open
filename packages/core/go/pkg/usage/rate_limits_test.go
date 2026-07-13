package usage

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestRateLimitPolicies(t *testing.T) {
	tests := []struct {
		name string
		got  RateLimit
		want RateLimit
	}{
		{name: "task runs per user", got: TaskRunsPerUser, want: RateLimit{Limit: 10, Window: time.Minute}},
		{name: "task runs per organization", got: TaskRunsPerOrganization, want: RateLimit{Limit: 50, Window: time.Minute}},
		{name: "attachment uploads per user", got: AttachmentUploadsPerUser, want: RateLimit{Limit: 30, Window: time.Minute}},
		{name: "realtime voice setups per user", got: RealtimeVoiceSetupsPerUser, want: RateLimit{Limit: 6, Window: time.Minute}},
		{name: "speech generations per user", got: SpeechGenerationsPerUser, want: RateLimit{Limit: 12, Window: time.Minute}},
		{name: "dictation transcriptions per user", got: DictationTranscriptionsPerUser, want: RateLimit{Limit: 12, Window: time.Minute}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, tt.got)
		})
	}
}

func TestVoiceRateLimit(t *testing.T) {
	tests := []struct {
		operation VoiceOperation
		want      RateLimit
		ok        bool
	}{
		{VoiceOperationRealtimeSetup, RealtimeVoiceSetupsPerUser, true},
		{VoiceOperationSpeech, SpeechGenerationsPerUser, true},
		{VoiceOperationDictation, DictationTranscriptionsPerUser, true},
		{VoiceOperation("unknown"), RateLimit{}, false},
	}
	for _, test := range tests {
		got, ok := VoiceRateLimit(test.operation)
		assert.Equal(t, test.want, got)
		assert.Equal(t, test.ok, ok)
	}
}

func TestTaskRunsForPlan(t *testing.T) {
	assert.Equal(t, RateLimit{Limit: 1, Window: 7 * 24 * time.Hour}, TaskRunsForPlan("free"))
	assert.Equal(t, RateLimit{Limit: 2, Window: time.Hour}, TaskRunsForPlan("pro"))
	assert.Equal(t, RateLimit{Limit: 20, Window: time.Hour}, TaskRunsForPlan("super"))
	assert.Equal(t, TaskRunsPerUser, TaskRunsForPlan(""))
}
