package auth_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/mock"

	auth "github.com/TaskForceAI/auth-service/mocks/pkg/auth"
	authpkg "github.com/TaskForceAI/auth-service/pkg/auth"
)

func TestAuditService_LogEvent_NoRepo(t *testing.T) {
	svc := authpkg.NewAuditService(nil)
	svc.LogEvent(context.Background(), authpkg.AuditLogWrite{Action: "LOGIN"})
}

func TestAuditService_LogEvent_DetachesCanceledContext(t *testing.T) {
	repo := new(auth.AuditLogRepository)
	svc := authpkg.NewAuditService(repo)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	repo.On("CreateAuditLog", mock.Anything, mock.Anything).
		Run(func(args mock.Arguments) {
			receivedCtx, ok := args.Get(0).(context.Context)
			if !ok {
				t.Fatalf("expected context.Context, got %T", args.Get(0))
			}
			if receivedCtx.Err() != nil {
				t.Fatalf("expected non-canceled context, got err=%v", receivedCtx.Err())
			}
		}).
		Return(nil).
		Once()

	svc.LogEvent(ctx, authpkg.AuditLogWrite{Action: "LOGIN"})

	repo.AssertExpectations(t)
}

func TestAuditService_LogLogin(t *testing.T) {
	repo := new(auth.AuditLogRepository)
	svc := authpkg.NewAuditService(repo)
	user := &authpkg.AuthUser{ID: 7, Email: "user@example.com"}
	ip := "1.2.3.4"
	ua := "agent"
	errMsg := "oops"

	repo.On("CreateAuditLog", mock.Anything, mock.MatchedBy(func(data authpkg.AuditLogWrite) bool {
		return data.Action == "LOGIN" && data.Resource == "user" && *data.Email == "user@example.com"
	})).Return(nil)

	svc.LogLogin(context.Background(), user, true, &ip, &ua, &errMsg)

	repo.AssertExpectations(t)
}
