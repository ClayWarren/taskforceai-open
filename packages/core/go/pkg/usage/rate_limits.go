package usage

import "time"

// RateLimit pairs a request budget with its rolling window.
type RateLimit struct {
	Limit  int
	Window time.Duration
}

// Product rate limits for agent task execution (runs and pulse turns) and
// attachment uploads. Enforcement mechanics live with the delivery layer;
// the budgets themselves are product policy.
var (
	TaskRunsPerUser                = RateLimit{Limit: 10, Window: time.Minute}
	TaskRunsPerOrganization        = RateLimit{Limit: 50, Window: time.Minute}
	AttachmentUploadsPerUser       = RateLimit{Limit: 30, Window: time.Minute}
	RealtimeVoiceSetupsPerUser     = RateLimit{Limit: 6, Window: time.Minute}
	SpeechGenerationsPerUser       = RateLimit{Limit: 12, Window: time.Minute}
	DictationTranscriptionsPerUser = RateLimit{Limit: 12, Window: time.Minute}
)

// VoiceOperation identifies a paid voice operation with its own request budget.
type VoiceOperation string

const (
	VoiceOperationRealtimeSetup VoiceOperation = "realtime-setup"
	VoiceOperationSpeech        VoiceOperation = "speech"
	VoiceOperationDictation     VoiceOperation = "dictation"
)

// VoiceRateLimit returns the per-user budget for a supported voice operation.
func VoiceRateLimit(operation VoiceOperation) (RateLimit, bool) {
	switch operation {
	case VoiceOperationRealtimeSetup:
		return RealtimeVoiceSetupsPerUser, true
	case VoiceOperationSpeech:
		return SpeechGenerationsPerUser, true
	case VoiceOperationDictation:
		return DictationTranscriptionsPerUser, true
	default:
		return RateLimit{}, false
	}
}
