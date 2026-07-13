package identity

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestDeviceLoginPolicyConstants(t *testing.T) {
	assert.Equal(t, 10*60, DeviceLoginExpirySeconds)
	assert.Equal(t, 5, DeviceLoginPollIntervalSeconds)
	assert.Equal(t, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", DeviceLoginUserCodeAlphabet)
	assert.Equal(t, 5, DeviceLoginCodeGenerationMaxAttempts)
}

func TestNormalizeDeviceLoginUserCode(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "lowercase compact", in: "abcd1234", want: "ABCD-1234"},
		{name: "already grouped", in: "ABCD-1234", want: "ABCD-1234"},
		{name: "spaces and punctuation", in: " abcd 12-34 ", want: "ABCD-1234"},
		{name: "short fallback", in: "abc", want: "ABC"},
		{name: "long fallback", in: "abcd12345", want: "ABCD12345"},
		{name: "non alphanumeric removed", in: "a!b@c#d$1%2^3&4", want: "ABCD-1234"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, NormalizeDeviceLoginUserCode(tt.in))
		})
	}
}
