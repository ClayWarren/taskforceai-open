package util

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidateStruct(t *testing.T) {
	type s struct {
		F string `validate:"required"`
	}
	require.Error(t, ValidateStruct(&s{}))
	assert.NoError(t, ValidateStruct(&s{F: "ok"}))
}
