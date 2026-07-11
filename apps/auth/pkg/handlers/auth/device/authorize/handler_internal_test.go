package authorize

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestClientIPFromRequestInfo(t *testing.T) {
	for _, tc := range []struct {
		name         string
		forwardedFor string
		remoteAddr   string
		want         *string
	}{
		{
			name:         "rightmost untrusted forwarded for wins outside production",
			forwardedFor: " 1.2.3.4, 5.6.7.8 ",
			remoteAddr:   "9.9.9.9:1234",
			want:         new("5.6.7.8"),
		},
		{
			name:       "remote host port",
			remoteAddr: "9.9.9.9:1234",
			want:       new("9.9.9.9"),
		},
		{
			name:       "raw remote fallback",
			remoteAddr: "not-a-host-port",
			want:       new("not-a-host-port"),
		},
		{
			name: "empty",
			want: nil,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := clientIPFromRequestInfo(tc.forwardedFor, tc.remoteAddr)
			if tc.want == nil {
				assert.Nil(t, got)
				return
			}
			assert.NotNil(t, got)
			assert.Equal(t, *tc.want, *got)
		})
	}
}

func TestClientIPFromRequestInfoProductionTrustsOnlyProxyForwardedFor(t *testing.T) {
	t.Setenv("NODE_ENV", "production")

	got := clientIPFromRequestInfo("1.2.3.4", "9.9.9.9:1234")
	assert.NotNil(t, got)
	assert.Equal(t, "9.9.9.9", *got)

	got = clientIPFromRequestInfo("1.2.3.4, 5.6.7.8", "76.76.21.10:1234")
	assert.NotNil(t, got)
	assert.Equal(t, "5.6.7.8", *got)
}

//go:fix inline
