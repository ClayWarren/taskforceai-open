// Package auth provides authentication services.
package auth

import (
	payments "github.com/TaskForceAI/adapters/pkg/billing"
)

type AuthenticatedUserResponse struct {
	ID                   int     `json:"id"`
	Email                string  `json:"email"`
	FullName             *string `json:"full_name"`
	Plan                 string  `json:"plan"`
	MessageCount         int     `json:"message_count"`
	LastMessageTimestamp *string `json:"last_message_timestamp"`
	SubscriptionID       *string `json:"subscription_id"`
	SubscriptionStatus   *string `json:"subscription_status"`
	SubscriptionSource   *string `json:"subscription_source"`
	CurrentPeriodStart   *string `json:"current_period_start"`
	CurrentPeriodEnd     *string `json:"current_period_end"`
	CancelAtPeriodEnd    bool    `json:"cancel_at_period_end"`
	ThemePreference      string  `json:"theme_preference"`
	MemoryEnabled        bool    `json:"memory_enabled"`
	WebSearchEnabled     bool    `json:"web_search_enabled"`
	CodeExecutionEnabled bool    `json:"code_execution_enabled"`
	NotificationsEnabled bool    `json:"notifications_enabled"`
	QuickModeEnabled     bool    `json:"quick_mode_enabled"`
	TrustLayerEnabled    bool    `json:"trust_layer_enabled"`
	MFAEnabled           bool    `json:"mfa_enabled"`
	CustomerID           *string `json:"customer_id"`
	Disabled             string  `json:"disabled"`
	IsAdmin              bool    `json:"is_admin"`
	ImpersonatorID       *string `json:"impersonator_id,omitempty"`
}

func MapUserToResponse(user *AuthUser) AuthenticatedUserResponse {
	// Plan default 'free'
	plan := "free"
	if user.Plan != nil {
		plan = *user.Plan
	}

	// Message count default 0
	msgCount := 0
	if user.MessageCount != nil {
		msgCount = *user.MessageCount
	}

	// Theme default 'dark'
	theme := "dark"
	if user.ThemePreference != nil {
		theme = *user.ThemePreference
	}

	// Normalize subscription source
	var subSource *string
	if user.SubscriptionSource != nil {
		if s, ok := payments.NormalizeSubscriptionSource(*user.SubscriptionSource); ok {
			str := string(s)
			subSource = &str
		}
	}

	// Dates to ISO string
	var lastMsg, currentStart, currentEnd *string
	if user.LastMessageTimestamp != nil {
		s := user.LastMessageTimestamp.Format("2006-01-02T15:04:05.999Z")
		lastMsg = &s
	}
	if user.CurrentPeriodStart != nil {
		s := user.CurrentPeriodStart.Format("2006-01-02T15:04:05.999Z")
		currentStart = &s
	}
	if user.CurrentPeriodEnd != nil {
		s := user.CurrentPeriodEnd.Format("2006-01-02T15:04:05.999Z")
		currentEnd = &s
	}

	return AuthenticatedUserResponse{
		ID:                   user.ID,
		Email:                user.Email,
		FullName:             user.FullName,
		Plan:                 plan,
		MessageCount:         msgCount,
		LastMessageTimestamp: lastMsg,
		SubscriptionID:       user.SubscriptionID,
		SubscriptionStatus:   user.SubscriptionStatus,
		SubscriptionSource:   subSource,
		CurrentPeriodStart:   currentStart,
		CurrentPeriodEnd:     currentEnd,
		CancelAtPeriodEnd:    user.CancelAtPeriodEnd,
		ThemePreference:      theme,
		MemoryEnabled:        user.MemoryEnabled,
		WebSearchEnabled:     user.WebSearchEnabled,
		CodeExecutionEnabled: user.CodeExecutionEnabled,
		NotificationsEnabled: user.NotificationsEnabled,
		QuickModeEnabled:     user.QuickModeEnabled,
		TrustLayerEnabled:    user.TrustLayerEnabled,
		MFAEnabled:           user.MFAEnabled,
		CustomerID:           user.CustomerID,
		Disabled:             BoolToString(user.Disabled),
		IsAdmin:              user.IsAdmin,
		ImpersonatorID:       user.ImpersonatorID,
	}
}

func BoolToString(b bool) string {
	if b {
		return "true"
	}
	return "false"
}
