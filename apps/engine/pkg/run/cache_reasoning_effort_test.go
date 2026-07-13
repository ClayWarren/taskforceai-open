package run

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestCacheModelVariantIncludesReasoningEffort(t *testing.T) {
	t.Parallel()

	assert.Equal(t, "openai/gpt-5.6-sol", cacheModelVariant("openai/gpt-5.6-sol", ""))
	assert.Equal(
		t,
		"openai/gpt-5.6-sol#reasoning=max",
		cacheModelVariant("openai/gpt-5.6-sol", " MAX "),
	)
	assert.NotEqual(
		t,
		cacheModelVariant("openai/gpt-5.6-sol", "low"),
		cacheModelVariant("openai/gpt-5.6-sol", "high"),
	)
}
