package types

// Branded types for IDs to provide better type safety and documentation.
type ConversationID string
type ServerConversationID int
type MessageID string
type UserID string
type AgentID string
type DeviceID string
type TaskID string
type ApiKeyID string
type SessionID string

// ToConversationID converts a string to a ConversationID.
func ToConversationID(id string) ConversationID { return ConversationID(id) }

// ToServerConversationID converts an int to a ServerConversationID.
func ToServerConversationID(id int) ServerConversationID { return ServerConversationID(id) }

// ToMessageID converts a string to a MessageID.
func ToMessageID(id string) MessageID { return MessageID(id) }

// ToUserID converts a string to a UserID.
func ToUserID(id string) UserID { return UserID(id) }

// ToAgentID converts a string to an AgentID.
func ToAgentID(id string) AgentID { return AgentID(id) }

// ToDeviceID converts a string to a DeviceID.
func ToDeviceID(id string) DeviceID { return DeviceID(id) }

// ToTaskID converts a string to a TaskID.
func ToTaskID(id string) TaskID { return TaskID(id) }

// ToApiKeyID converts a string to an ApiKeyID.
func ToApiKeyID(id string) ApiKeyID { return ApiKeyID(id) }

// ToSessionID converts a string to a SessionID.
func ToSessionID(id string) SessionID { return SessionID(id) }

// IsValidIDString checks if a value is a non-empty string.
func IsValidIDString(v any) bool {
	s, ok := v.(string)
	return ok && len(s) > 0
}

// IsValidServerID checks if a value is a positive integer.
func IsValidServerID(v any) bool {
	n, ok := v.(int)
	return ok && n > 0
}

// UnwrapID converts a branded string ID back to a string.
func UnwrapID[T ~string](id T) string {
	return string(id)
}

// UnwrapServerID converts a branded int ID back to an int.
func UnwrapServerID[T ~int](id T) int {
	return int(id)
}
