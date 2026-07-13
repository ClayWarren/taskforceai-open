package handler

import (
	"math/big"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
)

func TestNumericToFloat64(t *testing.T) {
	assert.Equal(t, 0.0, numericToFloat64(pgtype.Numeric{}))

	valid := pgtype.Numeric{Int: big.NewInt(1250), Exp: -2, Valid: true}
	assert.InDelta(t, 12.50, numericToFloat64(valid), 0.001)
}

func TestNumericToFloat64Ptr(t *testing.T) {
	assert.Nil(t, numericToFloat64Ptr(pgtype.Numeric{}))

	valid := pgtype.Numeric{Int: big.NewInt(500), Exp: -2, Valid: true}
	ptr := numericToFloat64Ptr(valid)
	assert.NotNil(t, ptr)
	assert.InDelta(t, 5.0, *ptr, 0.001)
}

func TestNumericToFloat64_OutOfRange(t *testing.T) {
	overflow := pgtype.Numeric{Int: big.NewInt(1), Exp: 400, Valid: true}
	assert.Equal(t, 0.0, numericToFloat64(overflow))
	assert.Nil(t, numericToFloat64Ptr(overflow))
}

func TestBillingPortalReturnURL(t *testing.T) {
	tests := []struct {
		name     string
		siteURL  string
		expected string
	}{
		{
			name:     "default",
			expected: "https://console.taskforceai.chat/billing",
		},
		{
			name:     "origin appends billing path",
			siteURL:  "https://console.example.com",
			expected: "https://console.example.com/billing",
		},
		{
			name:     "root path appends billing path",
			siteURL:  "https://console.example.com/",
			expected: "https://console.example.com/billing",
		},
		{
			name:     "path is preserved and unsafe URL parts are stripped",
			siteURL:  "https://console.example.com/account/billing?session=leak#section",
			expected: "https://console.example.com/account/billing",
		},
		{
			name:     "invalid url falls back to console billing",
			siteURL:  "javascript:alert(1)",
			expected: "https://console.taskforceai.chat/billing",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("SITE_URL", tt.siteURL)

			assert.Equal(t, tt.expected, billingPortalReturnURL())
		})
	}
}
