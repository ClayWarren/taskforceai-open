package billing

import (
	"testing"

	"github.com/stretchr/testify/assert"

	adapterbilling "github.com/TaskForceAI/adapters/pkg/billing"
)

func TestNormalizeSubscriptionSource_Stripe(t *testing.T) {
	result, ok := adapterbilling.NormalizeSubscriptionSource("stripe")
	assert.True(t, ok)
	assert.Equal(t, adapterbilling.NormalizedSourceStripe, result)

	result, ok = adapterbilling.NormalizeSubscriptionSource("STRIPE")
	assert.True(t, ok)
	assert.Equal(t, adapterbilling.NormalizedSourceStripe, result)

	result, ok = adapterbilling.NormalizeSubscriptionSource("Stripe")
	assert.True(t, ok)
	assert.Equal(t, adapterbilling.NormalizedSourceStripe, result)
}

func TestNormalizeSubscriptionSource_AppStore(t *testing.T) {
	result, ok := adapterbilling.NormalizeSubscriptionSource("app_store")
	assert.True(t, ok)
	assert.Equal(t, adapterbilling.NormalizedSourceAppStore, result)

	result, ok = adapterbilling.NormalizeSubscriptionSource("APP_STORE")
	assert.True(t, ok)
	assert.Equal(t, adapterbilling.NormalizedSourceAppStore, result)
}

func TestNormalizeSubscriptionSource_PlayStore(t *testing.T) {
	result, ok := adapterbilling.NormalizeSubscriptionSource("play_store")
	assert.True(t, ok)
	assert.Equal(t, adapterbilling.NormalizedSourcePlayStore, result)

	result, ok = adapterbilling.NormalizeSubscriptionSource("PLAY_STORE")
	assert.True(t, ok)
	assert.Equal(t, adapterbilling.NormalizedSourcePlayStore, result)
}

func TestNormalizeSubscriptionSource_Empty(t *testing.T) {
	result, ok := adapterbilling.NormalizeSubscriptionSource("")
	assert.False(t, ok)
	assert.Equal(t, adapterbilling.NormalizedSubscriptionSource(""), result)
}

func TestNormalizeSubscriptionSource_Invalid(t *testing.T) {
	result, ok := adapterbilling.NormalizeSubscriptionSource("unknown")
	assert.False(t, ok)
	assert.Equal(t, adapterbilling.NormalizedSubscriptionSource(""), result)

	result, ok = adapterbilling.NormalizeSubscriptionSource("paypal")
	assert.False(t, ok)
	assert.Equal(t, adapterbilling.NormalizedSubscriptionSource(""), result)
}

func TestNormalizedSubscriptionSource_Constants(t *testing.T) {
	assert.Equal(t, adapterbilling.NormalizedSourceStripe, adapterbilling.NormalizedSubscriptionSource("stripe"))
	assert.Equal(t, adapterbilling.NormalizedSourceAppStore, adapterbilling.NormalizedSubscriptionSource("app_store"))
	assert.Equal(t, adapterbilling.NormalizedSourcePlayStore, adapterbilling.NormalizedSubscriptionSource("play_store"))
}
