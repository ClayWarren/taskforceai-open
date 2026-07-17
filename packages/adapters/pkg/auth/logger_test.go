package auth

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestGetAuthLogger(t *testing.T) {
	logger1 := GetAuthLogger()
	assert.NotNil(t, logger1)

	logger2 := GetAuthLogger()
	assert.Equal(t, logger1, logger2, "Should return the same singleton instance")
}
