package devicetoken

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestClientIPFromRequestInfo(t *testing.T) {
	for _, tc := range []struct {
		name string
		info requestInfo
		want *string
	}{
		{
			name: "rightmost untrusted forwarded for wins outside production",
			info: requestInfo{ForwardedFor: " 1.2.3.4, 5.6.7.8 ", RemoteAddr: "9.9.9.9"},
			want: new("5.6.7.8"),
		},
		{
			name: "remote fallback",
			info: requestInfo{RemoteAddr: "9.9.9.9"},
			want: new("9.9.9.9"),
		},
		{
			name: "empty",
			info: requestInfo{},
			want: nil,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := clientIPFromRequestInfo(tc.info)
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

	got := clientIPFromRequestInfo(requestInfo{ForwardedFor: "1.2.3.4", RemoteAddr: "9.9.9.9:1234"})
	assert.NotNil(t, got)
	assert.Equal(t, "9.9.9.9", *got)

	got = clientIPFromRequestInfo(requestInfo{ForwardedFor: "1.2.3.4, 5.6.7.8", RemoteAddr: "76.76.21.10:1234"})
	assert.NotNil(t, got)
	assert.Equal(t, "5.6.7.8", *got)
}

//go:fix inline
