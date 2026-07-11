package types

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestBrandedTypes(t *testing.T) {
	t.Run("Conversions", func(t *testing.T) {
		assert.Equal(t, "c1", string(ToConversationID("c1")))
		assert.Equal(t, 123, int(ToServerConversationID(123)))
		assert.Equal(t, "m1", string(ToMessageID("m1")))
		assert.Equal(t, "u1", string(ToUserID("u1")))
		assert.Equal(t, "a1", string(ToAgentID("a1")))
		assert.Equal(t, "d1", string(ToDeviceID("d1")))
		assert.Equal(t, "t1", string(ToTaskID("t1")))
		assert.Equal(t, "k1", string(ToApiKeyID("k1")))
		assert.Equal(t, "s1", string(ToSessionID("s1")))
	})

	t.Run("Validation", func(t *testing.T) {
		assert.True(t, IsValidIDString("id"))
		assert.False(t, IsValidIDString(""))
		assert.False(t, IsValidIDString(123))

		assert.True(t, IsValidServerID(1))
		assert.False(t, IsValidServerID(0))
		assert.False(t, IsValidServerID("1"))
	})

	t.Run("Unwrap", func(t *testing.T) {
		assert.Equal(t, "c1", UnwrapID(ConversationID("c1")))
		assert.Equal(t, 123, UnwrapServerID(ServerConversationID(123)))
	})
}
