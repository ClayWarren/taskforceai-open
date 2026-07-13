// Package billing provides payment related data types and utilities.
package billing

import corepayments "github.com/TaskForceAI/core/pkg/payments"

type NormalizedSubscriptionSource = corepayments.NormalizedSubscriptionSource

const (
	NormalizedSourceStripe    = corepayments.NormalizedSourceStripe
	NormalizedSourceAppStore  = corepayments.NormalizedSourceAppStore
	NormalizedSourcePlayStore = corepayments.NormalizedSourcePlayStore
)

// NormalizeSubscriptionSource normalizes the source string.
// Returns normalized string and true if valid, or empty and false.
func NormalizeSubscriptionSource(source string) (NormalizedSubscriptionSource, bool) {
	return corepayments.NormalizeSubscriptionSource(source)
}
