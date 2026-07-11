package auth_test

import (
	"context"
	"testing"

	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/testutils"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/workos/workos-go/v6/pkg/usermanagement"
)

type auditLinkerRepo struct {
	testutils.MockRepository
	auditCalled bool
}

func (r *auditLinkerRepo) CreateAuditLog(context.Context, auth.AuditLogWrite) error {
	r.auditCalled = true
	return nil
}

func TestLinkerService_LogUserCreated_AuditSuccess(t *testing.T) {
	name := "Audit User"
	repo := &auditLinkerRepo{
		MockRepository: testutils.MockRepository{
			GetAccountRecord: nil,
			FindByEmailUser:  nil,
			CreateUserRecord: &auth.RegisterUserRecord{
				ID:       21,
				Email:    "audit-ok@example.com",
				FullName: &name,
			},
			CreateAccountRecord: &auth.AccountRecord{ID: "acc_21"},
		},
	}
	service := auth.NewLinkerService(repo, repo, repo)

	user, err := service.LinkOrCreateWorkOSUser(context.Background(), usermanagement.User{
		ID:    "workos_21",
		Email: "audit-ok@example.com",
	})
	require.NoError(t, err)
	assert.Equal(t, 21, user.ID)
	assert.True(t, repo.auditCalled)
}
