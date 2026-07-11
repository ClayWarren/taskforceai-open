package mobile

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestVerifyAppleIdentityToken_FallbackAudienceLoop(t *testing.T) {
	t.Setenv("APPLE_CLIENT_ID", "com.taskforceai.mobile")
	h := &AppleHandlerStruct{}

	_, err := h.verifyAppleIdentityToken("not.a.jwt", []string{"com.taskforceai.mobile"})
	assert.Error(t, err)
}

func TestVerifyAppleIdentityToken_EmptyAudiencesUsesResolved(t *testing.T) {
	t.Setenv("APPLE_CLIENT_ID", "com.taskforceai.mobile")
	h := &AppleHandlerStruct{}

	_, err := h.verifyAppleIdentityToken("not.a.jwt", nil)
	assert.Error(t, err)
}
