package utils

import (
	"fmt"

	"github.com/TaskForceAI/adapters/pkg/types"
)

func genID(prefix string) string {
	return fmt.Sprintf("%s-%s", prefix, SystemRNG.UUID())
}

// CreateConversationID generates a new branded ConversationID.
func CreateConversationID() types.ConversationID {
	return types.ConversationID(genID("conv"))
}

// CreateMessageID generates a new branded MessageID with an optional prefix.
func CreateMessageID(prefix string) types.MessageID {
	p := prefix
	if p == "" {
		p = "msg"
	}
	return types.MessageID(genID(p))
}

// CreateDeviceID generates a new branded DeviceID.
func CreateDeviceID() types.DeviceID {
	return types.DeviceID(genID("device"))
}

// CreateTaskID generates a new branded TaskID.
func CreateTaskID() types.TaskID {
	return types.TaskID(genID("task"))
}

// CreateSessionID generates a new branded SessionID.
func CreateSessionID() types.SessionID {
	return types.SessionID(genID("session"))
}
