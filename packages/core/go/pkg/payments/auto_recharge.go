package payments

import (
	"errors"
	"math"
)

// MaxAutoRechargeAmount caps a single auto-recharge purchase, in USD.
const MaxAutoRechargeAmount = 10000.0

var (
	ErrAutoRechargeSettingsRequired = errors.New("payments: auto-recharge amount and threshold are required when enabled")
	ErrAutoRechargeAmountInvalid    = errors.New("payments: auto-recharge amount must be greater than zero")
	ErrAutoRechargeAmountTooLarge   = errors.New("payments: auto-recharge amount exceeds the maximum allowed amount")
	ErrAutoRechargeThresholdInvalid = errors.New("payments: auto-recharge threshold must be zero or greater")
	ErrAutoRechargeThresholdTooHigh = errors.New("payments: auto-recharge threshold must be less than amount")
)

// AutoRechargeSettings is a requested auto-recharge configuration. Amount and
// Threshold are pointers because they are optional while auto-recharge is
// disabled.
type AutoRechargeSettings struct {
	Enabled   bool
	Amount    *float64
	Threshold *float64
}

// ValidateAutoRecharge enforces the auto-recharge business rules: when
// enabled, the recharge amount must be a positive finite value no greater
// than MaxAutoRechargeAmount, and the trigger threshold must be a finite
// value in [0, amount).
func ValidateAutoRecharge(settings AutoRechargeSettings) error {
	if !settings.Enabled {
		return nil
	}
	if settings.Amount == nil || settings.Threshold == nil {
		return ErrAutoRechargeSettingsRequired
	}
	amount := *settings.Amount
	threshold := *settings.Threshold
	if math.IsNaN(amount) || math.IsInf(amount, 0) || amount <= 0 {
		return ErrAutoRechargeAmountInvalid
	}
	if amount > MaxAutoRechargeAmount {
		return ErrAutoRechargeAmountTooLarge
	}
	if math.IsNaN(threshold) || math.IsInf(threshold, 0) || threshold < 0 {
		return ErrAutoRechargeThresholdInvalid
	}
	if threshold >= amount {
		return ErrAutoRechargeThresholdTooHigh
	}
	return nil
}
