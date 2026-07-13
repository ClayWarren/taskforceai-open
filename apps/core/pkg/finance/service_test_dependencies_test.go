package finance

import (
	"os"
	"strings"

	infracrypto "github.com/TaskForceAI/infrastructure/crypto/pkg"
)

func financeClientName() string {
	if value := strings.TrimSpace(os.Getenv("PLAID_CLIENT_NAME")); value != "" {
		return value
	}
	return "TaskForceAI"
}

type testTokenProtector struct{}

func (testTokenProtector) Encrypt(value *string) (*string, error) {
	return infracrypto.EncryptOAuthTokenField(value)
}

func (testTokenProtector) Decrypt(value *string) (*string, error) {
	return infracrypto.DecryptOAuthTokenField(value)
}

// NewService preserves the terse test setup while production construction is
// explicit about configuration and encryption dependencies.
func NewService(store Store, provider Provider) *Service {
	return NewServiceWithDependencies(store, provider, testTokenProtector{}, LinkConfig{
		ClientName:  os.Getenv("PLAID_CLIENT_NAME"),
		WebhookURL:  os.Getenv("PLAID_WEBHOOK_URL"),
		RedirectURI: os.Getenv("PLAID_REDIRECT_URI"),
	})
}
