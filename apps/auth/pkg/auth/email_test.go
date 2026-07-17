package auth

import (
	"context"
	"testing"
)

type emailCaptureRepository struct {
	foundEmail string
}

func (r *emailCaptureRepository) FindByEmail(_ context.Context, email string) (*AuthUser, error) {
	r.foundEmail = email
	return &AuthUser{ID: 1, Email: email}, nil
}
func (*emailCaptureRepository) FindByID(context.Context, int) (*AuthUser, error) {
	return nil, ErrUserNotFound
}
func (*emailCaptureRepository) FindExistingUser(context.Context, string) (*ExistingUserRecord, error) {
	return nil, nil
}
func (*emailCaptureRepository) CreateUser(context.Context, RegisterUserInput) (*RegisterUserRecord, error) {
	return nil, nil
}
func (*emailCaptureRepository) GetAccountByProvider(context.Context, string, string) (*AccountRecord, error) {
	return nil, nil
}
func (*emailCaptureRepository) CreateAccount(_ context.Context, input CreateAccountInput) (*AccountRecord, error) {
	return &AccountRecord{UserID: input.UserID, Provider: input.Provider, ProviderAccountID: input.ProviderAccountID}, nil
}
func (*emailCaptureRepository) GetUserByAccount(context.Context, string, string) (*AuthUser, error) {
	return nil, nil
}

func TestIsValidEmail_AllowsApostropheInLocalPart(t *testing.T) {
	if !isValidEmail("o'connor@example.com") {
		t.Fatal("expected a valid apostrophe-containing email address")
	}
}

func TestLinkOrCreateExternalUser_NormalizesEmailCase(t *testing.T) {
	repo := &emailCaptureRepository{}
	service := NewLinkerService(repo, repo, repo)

	user, err := service.LinkOrCreateExternalUser(context.Background(), ExternalIdentity{
		Provider: "workos", ProviderID: "user_1", Email: " User@Example.COM ",
	})
	if err != nil {
		t.Fatalf("link external user: %v", err)
	}
	if user == nil || repo.foundEmail != "user@example.com" {
		t.Fatalf("expected normalized lookup email, got user=%v lookup=%q", user, repo.foundEmail)
	}
}
