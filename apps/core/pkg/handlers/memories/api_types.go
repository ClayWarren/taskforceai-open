package memories

import "encoding/json"

// MemoryResponse represents a single memory item.
type MemoryResponse struct {
	ID        int32           `json:"id" doc:"Unique identifier for the memory"`
	Content   string          `json:"content" doc:"The actual memory content"`
	Type      string          `json:"type" doc:"Type of memory (e.g., 'fact', 'preference')"`
	Metadata  json.RawMessage `json:"metadata" doc:"Additional metadata as JSON"`
	CreatedAt string          `json:"created_at" doc:"Creation timestamp"`
	UpdatedAt string          `json:"updated_at" doc:"Last update timestamp"`
}

type UpdateMemoryRequest struct {
	Content string `json:"content" doc:"Updated memory content"`
	Type    string `json:"type" doc:"Updated memory type (fact, preference, or finance)"`
}

type CreateMemoryRequest struct {
	Content string `json:"content" doc:"Memory content"`
	Type    string `json:"type" doc:"Memory type (fact, preference, or finance)"`
}
