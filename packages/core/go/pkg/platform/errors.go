package platform

import (
	"fmt"
)

type AgentError struct {
	Message string
	Cause   error
}

func (e *AgentError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("AgentError: %s: %v", e.Message, e.Cause)
	}
	return fmt.Sprintf("AgentError: %s", e.Message)
}

func (e *AgentError) Unwrap() error {
	return e.Cause
}

type ToolError struct {
	Message  string
	ToolName string
	Cause    error
}

func (e *ToolError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("ToolError[%s]: %s: %v", e.ToolName, e.Message, e.Cause)
	}
	return fmt.Sprintf("ToolError[%s]: %s", e.ToolName, e.Message)
}

func (e *ToolError) Unwrap() error {
	return e.Cause
}

type ConfigurationError struct {
	Message   string
	ConfigKey string
	Cause     error
}

func (e *ConfigurationError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("ConfigurationError[%s]: %s: %v", e.ConfigKey, e.Message, e.Cause)
	}
	return fmt.Sprintf("ConfigurationError[%s]: %s", e.ConfigKey, e.Message)
}

func (e *ConfigurationError) Unwrap() error {
	return e.Cause
}

type OrchestrationError struct {
	Message string
	Stage   string
	Cause   error
}

func (e *OrchestrationError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("OrchestrationError[%s]: %s: %v", e.Stage, e.Message, e.Cause)
	}
	return fmt.Sprintf("OrchestrationError[%s]: %s", e.Stage, e.Message)
}

func (e *OrchestrationError) Unwrap() error {
	return e.Cause
}
