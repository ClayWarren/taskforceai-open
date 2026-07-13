package auth_test

import (
	"context"
	"testing"

	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/testutils"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type coverageTelemetry struct{}

func (coverageTelemetry) StartOperation(ctx context.Context, _ string, _ map[string]string) (context.Context, func(error)) {
	return ctx, func(error) {}
}
func (coverageTelemetry) RecordLogin(context.Context, string, bool) {}
func (coverageTelemetry) RecordRegistration(context.Context, bool)  {}

func TestLinkerServiceValidatesEmptyIdentityFieldsWithCustomTelemetry(t *testing.T) {
	repo := &testutils.MockRepository{}
	service := auth.NewLinkerService(repo, repo, repo, coverageTelemetry{})

	user, err := service.LinkOrCreateExternalUser(context.Background(), auth.ExternalIdentity{
		Provider:   "github",
		ProviderID: "provider-id",
	})
	require.ErrorContains(t, err, "invalid email")
	assert.Nil(t, user)

	user, err = service.LinkOrCreateExternalUser(context.Background(), auth.ExternalIdentity{
		Email: "user@example.com",
	})
	require.ErrorContains(t, err, "provider and provider id are required")
	assert.Nil(t, user)
}
