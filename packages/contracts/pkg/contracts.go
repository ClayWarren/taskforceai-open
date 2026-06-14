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

type AuthToken struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
}

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
	ConversationID string            `json:"conversation_id,omitempty"`
	ProjectID      int               `json:"projectId,omitempty"`
	ModelID        string            `json:"modelId,omitempty"`
	AttachmentIDs  []string          `json:"attachment_ids,omitempty"`
	Budget         *float64          `json:"budget,omitempty"`
	RoleModels     map[string]string `json:"role_models,omitempty"`
	Options        map[string]any    `json:"options,omitempty"`
}

type RunResponse struct {
	TaskID         string  `json:"task_id"`
	Status         *string `json:"status,omitempty"`
	Cached         *bool   `json:"cached,omitempty"`
	Result         *string `json:"result,omitempty"`
	ConversationID *string `json:"conversation_id,omitempty"`
	Model          *string `json:"model,omitempty"`
	AgentCount     *int    `json:"agent_count,omitempty"`
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

type ConversationList struct {
	Conversations []ConversationSummary `json:"conversations"`
	Total         int                   `json:"total"`
	Limit         int                   `json:"limit"`
	Offset        int                   `json:"offset"`
	HasMore       bool                  `json:"has_more"`
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
	ID            string   `json:"id"`
	Label         string   `json:"label"`
	Badge         string   `json:"badge"`
	Description   *string  `json:"description,omitempty"`
	UsageMultiple *float64 `json:"usageMultiple,omitempty"`
}

type ModelSelectorResponse struct {
	Enabled        bool                 `json:"enabled"`
	Options        []ModelOptionSummary `json:"options"`
	DefaultModelID string               `json:"defaultModelId"`
}

type MobileSubscriptionSyncResponse struct {
	Plan               Plan                `json:"plan"`
	SubscriptionStatus *string             `json:"subscription_status"`
	SubscriptionSource *SubscriptionSource `json:"subscription_source"`
	CurrentPeriodEnd   *string             `json:"current_period_end"`
}

type CreateSubscriptionRequest struct {
	PriceID string `json:"price_id"`
}

type PushPlatform string

const (
	PlatformIOS     PushPlatform = "ios"
	PlatformAndroid PushPlatform = "android"
	PlatformWeb     PushPlatform = "web"
)

type PushTokenRegistration struct {
	Token      string       `json:"token"`
	Platform   PushPlatform `json:"platform"`
	DeviceID   *string      `json:"deviceId,omitempty"`
	AppVersion *string      `json:"appVersion,omitempty"`
}

type PushTokenDeleteRequest struct {
	Token string `json:"token"`
}
