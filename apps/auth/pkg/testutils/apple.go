package testutils

import "github.com/TaskForceAI/auth-service/pkg/providers"

// MockAppleClient is a test double for the Apple authentication client
type MockAppleClient struct {
	ValidationResponse *providers.AppleClaims
	ValidationErr      error
}

// VerifyIdentityToken returns the configured mock response
func (m *MockAppleClient) VerifyIdentityToken(token string) (*providers.AppleClaims, error) {
	if m.ValidationErr != nil {
		return nil, m.ValidationErr
	}
	return m.ValidationResponse, nil
}
