package common

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestOperationFactories(t *testing.T) {
	operation := Operation("tasks", "submit-task", http.MethodPost, "/tasks", "Submit a task")
	assert.Equal(t, "submit-task", operation.OperationID)
	assert.Equal(t, http.MethodPost, operation.Method)
	assert.Equal(t, "/tasks", operation.Path)
	assert.Equal(t, "Submit a task", operation.Summary)
	assert.Equal(t, []string{"tasks"}, operation.Tags)

	secured := APIKeyOperation("tasks", "get-task", http.MethodGet, "/tasks/{id}", "Get a task")
	assert.Equal(t, []map[string][]string{{"api_key": {}}}, secured.Security)
}
