package publicshare

type PublicMessage struct {
	MessageID     string `json:"messageId"`
	Role          string `json:"role"`
	Content       string `json:"content"`
	IsAgentStatus bool   `json:"isAgentStatus"`
	CreatedAt     string `json:"createdAt"`
}

type PublicConversationResponse struct {
	Title     string          `json:"title"`
	Messages  []PublicMessage `json:"messages"`
	Truncated bool            `json:"truncated,omitempty"`
}
