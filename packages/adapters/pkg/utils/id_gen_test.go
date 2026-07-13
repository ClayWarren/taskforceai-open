package utils

import (
	"strings"
	"testing"
)

func TestIDGeneration(t *testing.T) {
	t.Run("CreateConversationID", func(t *testing.T) {
		id := CreateConversationID()
		if !strings.HasPrefix(string(id), "conv-") {
			t.Errorf("expected prefix conv-, got %s", id)
		}
	})

	t.Run("CreateMessageID", func(t *testing.T) {
		id1 := CreateMessageID("")
		if !strings.HasPrefix(string(id1), "msg-") {
			t.Errorf("expected default prefix msg-, got %s", id1)
		}

		id2 := CreateMessageID("user")
		if !strings.HasPrefix(string(id2), "user-") {
			t.Errorf("expected prefix user-, got %s", id2)
		}
	})

	t.Run("CreateDeviceID", func(t *testing.T) {
		id := CreateDeviceID()
		if !strings.HasPrefix(string(id), "device-") {
			t.Errorf("expected prefix device-, got %s", id)
		}
	})

	t.Run("CreateTaskID", func(t *testing.T) {
		id := CreateTaskID()
		if !strings.HasPrefix(string(id), "task-") {
			t.Errorf("expected prefix task-, got %s", id)
		}
	})

	t.Run("CreateSessionID", func(t *testing.T) {
		id := CreateSessionID()
		if !strings.HasPrefix(string(id), "session-") {
			t.Errorf("expected prefix session-, got %s", id)
		}
	})
}
