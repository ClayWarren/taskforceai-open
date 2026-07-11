//go:build !production

package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	authpkg "github.com/TaskForceAI/auth-service/pkg/auth"
	authhandler "github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTestLoginHandler_EncodeTokenFailure(t *testing.T) {
	t.Setenv("GO_ENV", "test")
	t.Setenv("ENABLE_TEST_LOGIN", "true")
	t.Setenv("AUTH_SECRET", "test_secret_must_be_long_enough_32_chars")
	t.Setenv("AUTH_PRIVATE_KEY", "not-valid-pem")
	t.Setenv("AUTH_PUBLIC_KEY", "")
	authpkg.ResetJWTKeysForTest()
	initErr := authpkg.InitKeys()
	require.Error(t, initErr)
	t.Cleanup(func() {
		authpkg.ResetJWTKeysForTest()
		_ = os.Unsetenv("AUTH_PRIVATE_KEY")
		_ = os.Unsetenv("AUTH_PUBLIC_KEY")
	})

	mock := dbtest.NewMockPoolRegexp(t)

	authhandler.SetQueriesOverride(func(ctx context.Context) (*db.Queries, error) {
		return db.New(mock), nil
	})
	t.Cleanup(func() { authhandler.SetQueriesOverride(nil) })

	mock.ExpectQuery("(?s).*FROM users WHERE email").
		WithArgs("encode@example.com").
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: 1, Email: "encode@example.com", Theme: "system", APITier: db.DeveloperApiTier("free"),
		}))

	body, _ := json.Marshal(TestLoginRequest{Email: "encode@example.com"})
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBuffer(body))
	rr := httptest.NewRecorder()
	TestLoginHandler(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}
