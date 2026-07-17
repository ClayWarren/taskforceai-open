package sync

import (
	"math"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestClampFloat64ToInt32(t *testing.T) {
	tests := []struct {
		name     string
		input    float64
		fallback int32
		expected int32
	}{
		{"Normal", 10.5, 0, 10},
		{"Negative", -5.2, 0, -5},
		{"NaN", math.NaN(), 100, 100},
		{"Inf+", math.Inf(1), 7, 7},
		{"Inf-", math.Inf(-1), 7, 7},
		{"Overflow", 3e10, 0, 2147483647},
		{"Underflow", -3e10, 0, -2147483648},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, clampFloat64ToInt32(tt.input, tt.fallback))
		})
	}
}

func TestNormalizeOrganizationID(t *testing.T) {
	ptr := func(f float64) *float64 { return &f }

	tests := []struct {
		name      string
		input     *float64
		expected  *int32
		expectErr bool
	}{
		{"Nil", nil, nil, false},
		{"Valid", ptr(123), func() *int32 { v := int32(123); return &v }(), false},
		{"NaN", ptr(math.NaN()), nil, true},
		{"Inf", ptr(math.Inf(1)), nil, true},
		{"Fractional", ptr(123.45), nil, true},
		{"Overflow", ptr(3e10), nil, true},
		{"Underflow", ptr(-3e10), nil, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res, err := normalizeOrganizationID(tt.input)
			if tt.expectErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
				if tt.expected == nil {
					assert.Nil(t, res)
				} else {
					assert.NotNil(t, res)
					assert.Equal(t, *tt.expected, *res)
				}
			}
		})
	}
}
