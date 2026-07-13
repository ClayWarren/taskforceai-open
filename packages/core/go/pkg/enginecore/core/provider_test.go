package core

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestQualifiedModelID(t *testing.T) {
	assert.Equal(t, "p/m", QualifiedModelID("p", "m"))
	assert.Equal(t, "already/qualified", QualifiedModelID("p", "already/qualified"))
	assert.Equal(t, "m", QualifiedModelID("", "m"))
	assert.Empty(t, QualifiedModelID("p", ""))
}
