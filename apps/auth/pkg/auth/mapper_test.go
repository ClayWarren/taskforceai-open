package auth_test

import (
	"testing"
	"time"

	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/stretchr/testify/assert"
)

func TestMapUserToResponse(t *testing.T) {
	now := time.Date(2026, time.July, 11, 12, 34, 56, 0, time.UTC)
	timestamp := "2026-07-11T12:34:56Z"
	plan := "pro"
	theme := "light"
	count := 5
	subscriptionSource := "stripe"
	impersonatorID := "admin-123"

	tests := []struct {
		name string
		user *auth.AuthUser
		want auth.AuthenticatedUserResponse
	}{
		{
			name: "defaults",
			user: &auth.AuthUser{Email: "defaults@example.com"},
			want: auth.AuthenticatedUserResponse{
				Email: "defaults@example.com", Plan: "free", ThemePreference: "dark", Disabled: "false",
			},
		},
		{
			name: "populated fields",
			user: &auth.AuthUser{
				ID: 1, Email: "user@example.com", Plan: &plan, MessageCount: &count,
				ThemePreference: &theme, Disabled: true, IsAdmin: true,
				SubscriptionSource: &subscriptionSource, LastMessageTimestamp: &now,
				CurrentPeriodStart: &now, CurrentPeriodEnd: &now,
			},
			want: auth.AuthenticatedUserResponse{
				ID: 1, Email: "user@example.com", Plan: "pro", MessageCount: 5,
				ThemePreference: "light", Disabled: "true", IsAdmin: true,
				SubscriptionSource: &subscriptionSource, LastMessageTimestamp: &timestamp,
				CurrentPeriodStart: &timestamp, CurrentPeriodEnd: &timestamp,
			},
		},
		{
			name: "impersonation",
			user: &auth.AuthUser{ID: 1, Email: "user@example.com", ImpersonatorID: &impersonatorID},
			want: auth.AuthenticatedUserResponse{
				ID: 1, Email: "user@example.com", Plan: "free", ThemePreference: "dark",
				Disabled: "false", ImpersonatorID: &impersonatorID,
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assert.Equal(t, test.want, auth.MapUserToResponse(test.user))
		})
	}
}
