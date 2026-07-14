package webhooks

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/workos/workos-go/v6/pkg/webhooks"
)

func TestWorkOSValidator_Smoke(t *testing.T) {
	v := &workOSValidator{client: webhooks.NewClient("secret")}
	// This will fail validation but exercises the code path
	_, _ = v.ValidatePayload("sig", "body")
}

func TestWorkOSHandler_Global_NoSecret(t *testing.T) {
	_ = os.Unsetenv("WORKOS_WEBHOOK_SECRET")
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	w := httptest.NewRecorder()
	WorkOSHandler(w, req)
	if w.Result().StatusCode != http.StatusInternalServerError {
		t.Errorf("Expected 500, got %d", w.Result().StatusCode)
	}
}

func TestHandleUserDeactivated_NilQueries(t *testing.T) {
	// Should not panic
	if err := handleUserDeactivated(context.Background(), nil, "test@e.com", "workos"); err == nil {
		t.Error("expected error for nil queries")
	}
}
