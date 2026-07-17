package payments

import (
	"math"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestValidateAutoRecharge(t *testing.T) {
	amount := func(v float64) *float64 { return &v }

	tests := []struct {
		name     string
		settings AutoRechargeSettings
		wantErr  error
	}{
		{name: "disabled ignores values", settings: AutoRechargeSettings{}, wantErr: nil},
		{name: "enabled requires amount", settings: AutoRechargeSettings{Enabled: true, Threshold: amount(5)}, wantErr: ErrAutoRechargeSettingsRequired},
		{name: "enabled requires threshold", settings: AutoRechargeSettings{Enabled: true, Amount: amount(50)}, wantErr: ErrAutoRechargeSettingsRequired},
		{name: "amount NaN", settings: AutoRechargeSettings{Enabled: true, Amount: amount(math.NaN()), Threshold: amount(5)}, wantErr: ErrAutoRechargeAmountInvalid},
		{name: "amount infinite", settings: AutoRechargeSettings{Enabled: true, Amount: amount(math.Inf(1)), Threshold: amount(5)}, wantErr: ErrAutoRechargeAmountInvalid},
		{name: "amount zero", settings: AutoRechargeSettings{Enabled: true, Amount: amount(0), Threshold: amount(0)}, wantErr: ErrAutoRechargeAmountInvalid},
		{name: "amount negative", settings: AutoRechargeSettings{Enabled: true, Amount: amount(-10), Threshold: amount(0)}, wantErr: ErrAutoRechargeAmountInvalid},
		{name: "amount above maximum", settings: AutoRechargeSettings{Enabled: true, Amount: amount(MaxAutoRechargeAmount + 1), Threshold: amount(5)}, wantErr: ErrAutoRechargeAmountTooLarge},
		{name: "amount exactly maximum", settings: AutoRechargeSettings{Enabled: true, Amount: amount(MaxAutoRechargeAmount), Threshold: amount(5)}, wantErr: nil},
		{name: "threshold NaN", settings: AutoRechargeSettings{Enabled: true, Amount: amount(50), Threshold: amount(math.NaN())}, wantErr: ErrAutoRechargeThresholdInvalid},
		{name: "threshold infinite", settings: AutoRechargeSettings{Enabled: true, Amount: amount(50), Threshold: amount(math.Inf(1))}, wantErr: ErrAutoRechargeThresholdInvalid},
		{name: "threshold negative", settings: AutoRechargeSettings{Enabled: true, Amount: amount(50), Threshold: amount(-1)}, wantErr: ErrAutoRechargeThresholdInvalid},
		{name: "threshold equals amount", settings: AutoRechargeSettings{Enabled: true, Amount: amount(50), Threshold: amount(50)}, wantErr: ErrAutoRechargeThresholdTooHigh},
		{name: "threshold above amount", settings: AutoRechargeSettings{Enabled: true, Amount: amount(50), Threshold: amount(60)}, wantErr: ErrAutoRechargeThresholdTooHigh},
		{name: "valid settings", settings: AutoRechargeSettings{Enabled: true, Amount: amount(50), Threshold: amount(10)}, wantErr: nil},
		{name: "zero threshold is valid", settings: AutoRechargeSettings{Enabled: true, Amount: amount(50), Threshold: amount(0)}, wantErr: nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateAutoRecharge(tt.settings)
			if tt.wantErr == nil {
				require.NoError(t, err)
				return
			}
			require.ErrorIs(t, err, tt.wantErr)
		})
	}
}
