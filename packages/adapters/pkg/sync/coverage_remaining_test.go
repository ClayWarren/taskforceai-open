package sync

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestNormalizeConversationStorageIDPreservesScopedAndEmptyIDs(t *testing.T) {
	assert.Empty(t, normalizeConversationStorageID("  "))
	assert.Equal(t, "remote-7", normalizeConversationStorageID(" remote-7 "))
	assert.Equal(t, "local-7", normalizeConversationStorageID(" local-7 "))
}
