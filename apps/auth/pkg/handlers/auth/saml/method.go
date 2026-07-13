package saml

import (
	"net/http"

	"github.com/TaskForceAI/auth-service/pkg/handler"
)

type LoginMethodRequest struct {
	Email string `json:"email" validate:"required,email"`
}

type LoginMethodResponse struct {
	Method string `json:"method"` // "PASSWORD", "OAUTH", "SAML"
}

type MethodHandlerStruct struct{}

func (h *MethodHandlerStruct) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if handler.HandleCORS(w, r) {
		return
	}

	if r.Method != http.MethodPost {
		handler.JSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var req LoginMethodRequest
	if err := handler.ReadJSON(w, r, &req); err != nil {
		handler.JSONError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if err := handler.ValidateStruct(&req); err != nil {
		handler.JSONError(w, http.StatusBadRequest, handler.FormatValidationErrors(err))
		return
	}
	// AUTH-VULN-03: Always return a generic method to avoid disclosing org SSO configuration.
	handler.JSON(w, http.StatusOK, LoginMethodResponse{
		Method: "OAUTH",
	})
}

func MethodHandler(w http.ResponseWriter, r *http.Request) {
	h := &MethodHandlerStruct{}
	h.ServeHTTP(w, r)
}
