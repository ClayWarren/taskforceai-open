package auth_test

import (
	"testing"
	"time"

	"github.com/TaskForceAI/auth-service/pkg/auth"
)

func TestMapper_MapUserToResponse(t *testing.T) {
	now := time.Now()
	plan := "pro"
	theme := "light"
	count := 10

	u := &auth.AuthUser{
		ID:                   1,
		Email:                "test@example.com",
		Plan:                 &plan,
		MessageCount:         &count,
		ThemePreference:      &theme,
		LastMessageTimestamp: &now,
		IsAdmin:              true,
		Disabled:             false,
	}

	resp := auth.MapUserToResponse(u)

	if resp.ID != 1 {
		t.Errorf("Expected ID 1, got %d", resp.ID)
	}
	if resp.Plan != "pro" {
		t.Errorf("Expected pro, got %s", resp.Plan)
	}
	if !resp.IsAdmin {
		t.Error("Expected IsAdmin true")
	}
	if resp.Email != "test@example.com" {
		t.Error("Email mismatch")
	}
}

func TestMapper_MapUserToResponse_Impersonation(t *testing.T) {
	impersonatorID := "admin-123"
	u := &auth.AuthUser{
		ID:             1,
		Email:          "test@example.com",
		ImpersonatorID: &impersonatorID,
	}

	resp := auth.MapUserToResponse(u)

	if resp.ID != 1 {
		t.Errorf("Expected ID 1, got %d", resp.ID)
	}
	if resp.ImpersonatorID == nil || *resp.ImpersonatorID != "admin-123" {
		t.Errorf("Expected ImpersonatorID admin-123, got %v (Hardening TF-0210)", resp.ImpersonatorID)
	}
}
