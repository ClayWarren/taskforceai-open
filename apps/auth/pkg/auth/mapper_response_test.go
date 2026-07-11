package auth_test

import (
	"testing"
	"time"

	"github.com/TaskForceAI/auth-service/pkg/auth"
)

func TestMapUserToResponse_Extra(t *testing.T) {
	// 1. All fields nil/default
	user := &auth.AuthUser{
		Email: "test@e.com",
	}
	res := auth.MapUserToResponse(user)
	if res.Plan != "free" {
		t.Error("Expected free plan")
	}
	if res.MessageCount != 0 {
		t.Error("Expected 0 msg count")
	}
	if res.ThemePreference != "dark" {
		t.Error("Expected dark theme")
	}
	if res.Disabled != "false" {
		t.Error("Expected disabled=false")
	}

	// 2. All fields set
	plan := "pro"
	count := 5
	theme := "light"
	now := time.Now()
	subSource := "stripe"
	user = &auth.AuthUser{
		Email:                "test@e.com",
		Plan:                 &plan,
		MessageCount:         &count,
		ThemePreference:      &theme,
		Disabled:             true,
		IsAdmin:              true,
		SubscriptionSource:   &subSource,
		LastMessageTimestamp: &now,
		CurrentPeriodStart:   &now,
		CurrentPeriodEnd:     &now,
	}
	res = auth.MapUserToResponse(user)
	if res.Plan != "pro" {
		t.Error("Expected pro plan")
	}
	if res.MessageCount != 5 {
		t.Error("Expected 5 msg count")
	}
	if res.ThemePreference != "light" {
		t.Error("Expected light theme")
	}
	if res.Disabled != "true" {
		t.Error("Expected disabled=true")
	}
	if !res.IsAdmin {
		t.Error("Expected is_admin=true")
	}
	if res.SubscriptionSource == nil || *res.SubscriptionSource != "stripe" {
		val := "nil"
		if res.SubscriptionSource != nil {
			val = *res.SubscriptionSource
		}
		t.Errorf("Expected stripe sub source, got %s", val)
	}
	if res.LastMessageTimestamp == nil {
		t.Error("Expected last msg timestamp")
	}
}
