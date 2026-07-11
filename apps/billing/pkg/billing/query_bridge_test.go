package billing

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestGetQueries_WithoutDatabaseContext(t *testing.T) {
	_, err := GetQueries(context.Background())
	assert.Error(t, err)
}
