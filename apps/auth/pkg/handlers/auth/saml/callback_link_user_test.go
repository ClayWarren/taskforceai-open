package saml

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/workos/workos-go/v6/pkg/sso"
)

func TestLinkOrCreateSAMLUser_CreatesUser(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	workosID := "org_new_saml"
	expectSAMLDomainOrgRow(mock, "example.com", workosID, 12)
	mock.ExpectQuery("SELECT (.+) FROM users WHERE email =").
		WithArgs("new-saml@example.com").
		WillReturnError(pgx.ErrNoRows)
	mock.ExpectQuery("INSERT INTO users").
		WithArgs("new-saml@example.com", pgxmock.AnyArg(), "free").
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: 12, Email: "new-saml@example.com", APITier: db.DeveloperApiTier("free"),
		}))

	user, err := linkOrCreateSAMLUser(context.Background(), db.New(mock), sso.Profile{
		Email:          "new-saml@example.com",
		FirstName:      "New",
		LastName:       "SAML",
		OrganizationID: workosID,
	})
	require.NoError(t, err)
	require.NotNil(t, user)
	assert.Equal(t, 12, user.ID)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestCallbackHandler_GlobalWrapperMissingCode(t *testing.T) {
	t.Setenv("WORKOS_API_KEY", "test")
	t.Setenv("WORKOS_CLIENT_ID", "test")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/saml/callback", nil)
	rr := httptest.NewRecorder()
	CallbackHandler(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
}
