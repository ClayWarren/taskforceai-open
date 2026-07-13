package identity

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestMFAAttemptPolicy(t *testing.T) {
	tests := []struct {
		name string
		got  int
		want int
	}{
		{name: "setup", got: MFASetupMaxAttemptsPerWindow, want: 5},
		{name: "verify", got: MFAVerifyMaxAttemptsPerWindow, want: 10},
		{name: "disable", got: MFADisableMaxAttemptsPerWindow, want: 10},
		{name: "login", got: MFALoginMaxAttemptsPerWindow, want: 10},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, tt.got)
		})
	}
	assert.Equal(t, time.Minute, MFAAttemptWindow)
}
