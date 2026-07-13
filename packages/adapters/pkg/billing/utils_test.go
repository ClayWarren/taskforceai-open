package billing

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestNormalizeSubscriptionSourceDelegatesToCorePolicy(t *testing.T) {
	source, valid := NormalizeSubscriptionSource(" stripe ")
	assert.True(t, valid)
	assert.Equal(t, NormalizedSourceStripe, source)

	source, valid = NormalizeSubscriptionSource("unknown")
	assert.False(t, valid)
	assert.Empty(t, source)
}
