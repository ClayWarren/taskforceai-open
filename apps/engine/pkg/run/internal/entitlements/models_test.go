package entitlements

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidateModels(t *testing.T) {
	require.NoError(t, ValidateModels("pro", "openai/gpt-5.6-sol", map[string]string{"reviewer": "openai/gpt-5.6-sol"}))

	err := ValidateModels("free", "  openai/gpt-5.6-sol  ", nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), `model "openai/gpt-5.6-sol"`)

	err = ValidateModels("free", "openai/gpt-5-mini", map[string]string{"reviewer": "  openai/gpt-5.6-sol  "})
	require.Error(t, err)
	assert.Contains(t, err.Error(), `for role "reviewer"`)
}
