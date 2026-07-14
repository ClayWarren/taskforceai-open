package team

import (
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestNextInboxMessageIDFallsBackWhenEntropyFails(t *testing.T) {
	original := readInboxMessageEntropy
	readInboxMessageEntropy = func([]byte) (int, error) { return 0, errors.New("random failed") }
	t.Cleanup(func() { readInboxMessageEntropy = original })

	assert.True(t, strings.HasPrefix(nextInboxMessageID(), "im_"))
}
