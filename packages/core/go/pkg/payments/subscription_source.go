package payments

import "strings"

type NormalizedSubscriptionSource string

const (
	NormalizedSourceStripe    NormalizedSubscriptionSource = "stripe"
	NormalizedSourceAppStore  NormalizedSubscriptionSource = "app_store"
	NormalizedSourcePlayStore NormalizedSubscriptionSource = "play_store"
)

// NormalizeSubscriptionSource normalizes supported subscription source strings.
// It returns false for empty or unsupported sources.
func NormalizeSubscriptionSource(source string) (NormalizedSubscriptionSource, bool) {
	switch strings.ToUpper(strings.TrimSpace(source)) {
	case "STRIPE":
		return NormalizedSourceStripe, true
	case "APP_STORE":
		return NormalizedSourceAppStore, true
	case "PLAY_STORE":
		return NormalizedSourcePlayStore, true
	default:
		return "", false
	}
}
