package platform

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestErrors(t *testing.T) {
	cause := errors.New("root cause")

	t.Run("AgentError", func(t *testing.T) {
		e := &AgentError{Message: "msg", Cause: cause}
		assert.Equal(t, "AgentError: msg: root cause", e.Error())
		assert.Equal(t, cause, e.Unwrap())

		e2 := &AgentError{Message: "msg"}
		assert.Equal(t, "AgentError: msg", e2.Error())
	})

	t.Run("ToolError", func(t *testing.T) {
		e := &ToolError{Message: "msg", ToolName: "tool1", Cause: cause}
		assert.Equal(t, "ToolError[tool1]: msg: root cause", e.Error())
		assert.Equal(t, cause, e.Unwrap())

		e2 := &ToolError{Message: "msg", ToolName: "tool1"}
		assert.Equal(t, "ToolError[tool1]: msg", e2.Error())
	})

	t.Run("ConfigurationError", func(t *testing.T) {
		e := &ConfigurationError{Message: "msg", ConfigKey: "key1", Cause: cause}
		assert.Equal(t, "ConfigurationError[key1]: msg: root cause", e.Error())
		assert.Equal(t, cause, e.Unwrap())

		e2 := &ConfigurationError{Message: "msg", ConfigKey: "key1"}
		assert.Equal(t, "ConfigurationError[key1]: msg", e2.Error())
	})

	t.Run("OrchestrationError", func(t *testing.T) {
		e := &OrchestrationError{Message: "msg", Stage: "stage1", Cause: cause}
		assert.Equal(t, "OrchestrationError[stage1]: msg: root cause", e.Error())
		assert.Equal(t, cause, e.Unwrap())

		e2 := &OrchestrationError{Message: "msg", Stage: "stage1"}
		assert.Equal(t, "OrchestrationError[stage1]: msg", e2.Error())
	})
}
