package pkg

//

type Theme string

const (
	ThemeDark   Theme = "dark"
	ThemeLight  Theme = "light"
	ThemeSystem Theme = "system"
)

type Plan string

const (
	PlanFree  Plan = "free"
	PlanPro   Plan = "pro"
	PlanSuper Plan = "super"
)

type SubscriptionSource string

const (
	SourceStripe    SubscriptionSource = "stripe"
	SourceAppStore  SubscriptionSource = "app_store"
	SourcePlayStore SubscriptionSource = "play_store"
)

type Disabled string

const (
	DisabledTrue  Disabled = "true"
	DisabledFalse Disabled = "false"
)

type AuthenticatedUser struct {
	ID                   int                 `json:"id"`
	Email                string              `json:"email"`
	FullName             *string             `json:"full_name"`
	Plan                 Plan                `json:"plan"`
	MessageCount         int                 `json:"message_count"`
	LastMessageTimestamp *string             `json:"last_message_timestamp"`
	SubscriptionID       *string             `json:"subscription_id"`
	SubscriptionStatus   *string             `json:"subscription_status"`
	SubscriptionSource   *SubscriptionSource `json:"subscription_source"`
	CurrentPeriodStart   *string             `json:"current_period_start"`
	CurrentPeriodEnd     *string             `json:"current_period_end"`
	CancelAtPeriodEnd    bool                `json:"cancel_at_period_end"`
	ThemePreference      Theme               `json:"theme_preference"`
	MemoryEnabled        bool                `json:"memory_enabled"`
	WebSearchEnabled     bool                `json:"web_search_enabled"`
	CodeExecutionEnabled bool                `json:"code_execution_enabled"`
	NotificationsEnabled bool                `json:"notifications_enabled"`
	QuickModeEnabled     bool                `json:"quick_mode_enabled"`
	TrustLayerEnabled    bool                `json:"trust_layer_enabled"`
	MFAEnabled           bool                `json:"mfa_enabled"`
	CustomerID           *string             `json:"customer_id"`
	Disabled             Disabled            `json:"disabled"`
	IsAdmin              bool                `json:"is_admin"`
	ImpersonatorID       *string             `json:"impersonator_id,omitempty"`
}

type RunRequest struct {
	Prompt string `json:"prompt"`
	// Deprecated: demo is ignored by the current /api/v1/run handler.
	Demo bool `json:"demo,omitempty"`
	// Deprecated: conversation_id is ignored by the current /api/v1/run handler.
	ConversationID  string            `json:"conversation_id,omitempty"`
	ProjectID       int               `json:"projectId,omitempty"`
	ModelID         string            `json:"modelId,omitempty"`
	ReasoningEffort string            `json:"reasoningEffort,omitempty"`
	AttachmentIDs   []string          `json:"attachment_ids,omitempty"`
	Budget          *float64          `json:"budget,omitempty"`
	RoleModels      map[string]string `json:"role_models,omitempty"`
	Options         map[string]any    `json:"options,omitempty"`
	PrivateChat     bool              `json:"private_chat,omitempty"`
}

type RunResponse struct {
	TaskID         string  `json:"task_id"`
	Status         string  `json:"status"`
	Result         *string `json:"result,omitempty"`
	ConversationID *int32  `json:"conversation_id,omitempty"`
	TraceID        string  `json:"trace_id,omitempty"`
}

type SourceReference struct {
	Title   string  `json:"title"`
	URL     string  `json:"url"`
	Snippet *string `json:"snippet,omitempty"`
}

type AgentStatus struct {
	Status   string   `json:"status"`
	AgentID  *int     `json:"agent_id,omitempty"`
	Progress *float64 `json:"progress,omitempty"`
	Result   *string  `json:"result,omitempty"`
}

type ConversationSummary struct {
	ID            int               `json:"id"`
	Timestamp     string            `json:"timestamp"`
	UserInput     string            `json:"user_input"`
	Result        string            `json:"result"`
	ExecutionTime *float64          `json:"execution_time,omitempty"`
	Model         *string           `json:"model,omitempty"`
	AgentCount    *int              `json:"agent_count,omitempty"`
	ProjectID     *int              `json:"projectId,omitempty"`
	IsPublic      *bool             `json:"isPublic,omitempty"`
	ShareID       *string           `json:"shareId,omitempty"`
	Sources       []SourceReference `json:"sources,omitempty"`
	AgentStatuses []AgentStatus     `json:"agentStatuses,omitempty"`
}

type SubscriptionSummary struct {
	SubscriptionID     string `json:"subscription_id"`
	Status             string `json:"status"`
	CurrentPeriodStart *int64 `json:"current_period_start"`
	CurrentPeriodEnd   *int64 `json:"current_period_end"`
	CancelAtPeriodEnd  bool   `json:"cancel_at_period_end"`
}

type SubscriptionResponse struct {
	Subscription *SubscriptionSummary `json:"subscription"`
}

type CreateSubscriptionResponse struct {
	CheckoutURL    string  `json:"checkout_url"`
	SubscriptionID *string `json:"subscription_id,omitempty"`
	Status         *string `json:"status,omitempty"`
}

type ProductSummary struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Description   *string  `json:"description"`
	Plan          Plan     `json:"plan"`
	PriceID       *string  `json:"price_id"`
	PriceAmount   *float64 `json:"price_amount"`
	PriceCurrency *string  `json:"price_currency"`
}

type ProductsResponse struct {
	Products []ProductSummary `json:"products"`
}

type MessageResponse struct {
	Message string `json:"message"`
}

type ModelOptionSummary struct {
	ID                     string   `json:"id"`
	Label                  string   `json:"label"`
	Badge                  string   `json:"badge"`
	Description            *string  `json:"description,omitempty"`
	UsageMultiple          *float64 `json:"usageMultiple,omitempty"`
	ReasoningEffortLevels  []string `json:"reasoningEffortLevels,omitempty"`
	DefaultReasoningEffort *string  `json:"defaultReasoningEffort,omitempty"`
}

type ModelSelectorResponse struct {
	Enabled        bool                 `json:"enabled"`
	Options        []ModelOptionSummary `json:"options"`
	DefaultModelID string               `json:"defaultModelId"`
}

type CreateSubscriptionRequest struct {
	PriceID string `json:"price_id"`
}
