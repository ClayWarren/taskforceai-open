package handler

import (
	"os"

	corefinance "github.com/TaskForceAI/go-core/pkg/finance"
	infracrypto "github.com/TaskForceAI/infrastructure/crypto/pkg"
)

type financeTokenProtector struct{}

func (financeTokenProtector) Encrypt(value *string) (*string, error) {
	return infracrypto.EncryptOAuthTokenField(value)
}

func (financeTokenProtector) Decrypt(value *string) (*string, error) {
	return infracrypto.DecryptOAuthTokenField(value)
}

func financeLinkConfigFromEnv() corefinance.LinkConfig {
	return corefinance.LinkConfig{
		ClientName:  os.Getenv("PLAID_CLIENT_NAME"),
		WebhookURL:  os.Getenv("PLAID_WEBHOOK_URL"),
		RedirectURI: os.Getenv("PLAID_REDIRECT_URI"),
	}
}
