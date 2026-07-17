package saml

import (
	"context"
	"errors"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/workos/workos-go/v6/pkg/sso"
)

func TestLinkOrCreateSAMLUser(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)

	workosID := "org_example"
	profile := sso.Profile{
		Email:          "test@example.com",
		FirstName:      "Test",
		LastName:       "User",
		OrganizationID: workosID,
	}

	// 1. Success - Existing User
	expectSAMLDomainOrgRow(mock, "example.com", workosID, 1)
	mock.ExpectQuery("SELECT (.+) FROM users WHERE email =").
		WithArgs(profile.Email).
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: 1, Email: profile.Email, APITier: "STARTER", APIRequestsLimit: 100,
		}))

	user, err := linkOrCreateSAMLUser(context.Background(), queries, profile)
	if err != nil || user.ID != 1 {
		t.Errorf("Expected user ID 1, got %v, err: %v", user, err)
	}

	// 2. Success - New User
	expectSAMLDomainOrgRow(mock, "example.com", workosID, 1)
	mock.ExpectQuery("SELECT (.+) FROM users WHERE email =").
		WithArgs("new@example.com").
		WillReturnError(pgx.ErrNoRows)

	mock.ExpectQuery("INSERT INTO users").
		WithArgs("new@example.com", pgxmock.AnyArg(), "free").
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: 2, Email: "new@example.com", APITier: "STARTER", APIRequestsLimit: 100,
		}))

	profile.Email = "new@example.com"
	user, err = linkOrCreateSAMLUser(context.Background(), queries, profile)
	if err != nil || user.ID != 2 {
		t.Errorf("Expected user ID 2, got %v, err: %v", user, err)
	}

	// 3. Error Case - DB Error
	expectSAMLDomainOrgRow(mock, "example.com", workosID, 1)
	mock.ExpectQuery("SELECT (.+) FROM users WHERE email =").
		WithArgs("new@example.com").
		WillReturnError(errors.New("db fail"))

	_, err = linkOrCreateSAMLUser(context.Background(), queries, profile)
	if err == nil {
		t.Error("Expected error, got nil")
	}

	// 4. Error Case - Nil Queries
	_, err = linkOrCreateSAMLUser(context.Background(), nil, profile)
	if err == nil {
		t.Error("Expected error for nil queries")
	}
}

func TestLinkOrCreateSAMLUser_DisabledExistingUser(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	workosID := "org_disabled"
	profile := sso.Profile{Email: "disabled@example.com", OrganizationID: workosID}

	expectSAMLDomainOrgRow(mock, "example.com", workosID, 3)
	mock.ExpectQuery("SELECT (.+) FROM users WHERE email =").
		WithArgs(profile.Email).
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: 3, Email: profile.Email, Disabled: true, APITier: "STARTER", APIRequestsLimit: 100,
		}))

	user, err := linkOrCreateSAMLUser(context.Background(), queries, profile)
	if !errors.Is(err, auth.ErrUserDisabled) {
		t.Fatalf("expected ErrUserDisabled, got user=%v err=%v", user, err)
	}
	if user != nil {
		t.Fatalf("expected nil user for disabled account, got %v", user)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestLinkOrCreateSAMLUser_RejectsMismatchedEmailDomainOrg(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)

	expectSAMLDomainOrgRow(mock, "othertenant.com", "org_victim", 4)

	user, err := linkOrCreateSAMLUser(context.Background(), queries, sso.Profile{
		Email:          "victim@othertenant.com",
		OrganizationID: "org_attacker",
	})

	if !errors.Is(err, errSAMLEmailOrgMismatch) {
		t.Fatalf("expected errSAMLEmailOrgMismatch, got user=%v err=%v", user, err)
	}
	if user != nil {
		t.Fatalf("expected no user, got %#v", user)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestLinkOrCreateSAMLUser_RejectsInvalidEmail(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)

	user, err := linkOrCreateSAMLUser(context.Background(), queries, sso.Profile{
		Email:          "not-an-email",
		OrganizationID: "org_1",
	})

	if !errors.Is(err, errSAMLEmailOrgMismatch) {
		t.Fatalf("expected errSAMLEmailOrgMismatch, got user=%v err=%v", user, err)
	}
	if user != nil {
		t.Fatalf("expected no user, got %#v", user)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}
