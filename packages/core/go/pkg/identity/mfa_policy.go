package identity

import "time"

// MFA endpoint attempt budgets per client, per window. These bound
// brute-force attempts against TOTP codes and MFA state changes.
const (
	MFASetupMaxAttemptsPerWindow   = 5
	MFAVerifyMaxAttemptsPerWindow  = 10
	MFADisableMaxAttemptsPerWindow = 10
	MFALoginMaxAttemptsPerWindow   = 10
	MFAAttemptWindow               = time.Minute
)
