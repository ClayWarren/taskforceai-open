package testutils

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/TaskForceAI/auth-service/pkg/auth"
)

func TestMockDeviceService(t *testing.T) {
	payload := &auth.DeviceLoginStartPayload{
		DeviceCode: "dev",
		UserCode:   "user",
		ExpiresIn:  int(time.Minute.Seconds()),
	}
	outcome := &auth.DeviceLoginTokenOutcome{AccessToken: "token"}
	svc := &MockDeviceService{
		StartPayload: payload,
		TokenOutcome: outcome,
	}

	got, err := svc.StartDeviceLogin(context.Background(), "http://base")
	require.NoError(t, err)
	assert.Equal(t, payload, got)

	require.NoError(t, svc.AuthorizeDeviceLogin(context.Background(), 1, "code"))

	token, err := svc.ExchangeDeviceToken(context.Background(), "dev", "secret")
	require.NoError(t, err)
	assert.Equal(t, outcome, token)
}
