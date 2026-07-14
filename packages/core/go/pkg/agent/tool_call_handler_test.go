package agent

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/stretchr/testify/assert"
)

func TestTruncateStringForPreviewPreservesUTF8(t *testing.T) {
	value := strings.Repeat("a", 499) + "🙂" + "tail"
	truncated := truncateStringForPreview(value)

	assert.True(t, utf8.ValidString(truncated))
	assert.True(t, strings.HasSuffix(truncated, "..."))
	assert.NotContains(t, truncated, "tail")
}
