package saml

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/TaskForceAI/auth-service/pkg/testutils"
)

func TestSigninHandler_ErrorsExtra(t *testing.T) {
	tests := []struct {
		name       string
		apiKey     string
		clientID   string
		email      string
		getOrgErr  error
		mockOrg    *db.Organization
		ssourlErr  error
		wantStatus int
	}{
		{"NoConfig", "", "", "test@e.com", nil, nil, nil, http.StatusInternalServerError},
		{"NoEmail", "k", "c", "", nil, nil, nil, http.StatusBadRequest},
		{"BadEmail", "k", "c", "invalid", nil, nil, nil, http.StatusBadRequest},
		{"NoOrg", "k", "c", "t@e.com", nil, nil, nil, http.StatusBadRequest},
		{"GetOrgError", "k", "c", "t@e.com", errors.New("no"), nil, nil, http.StatusInternalServerError},
		{"SSOFail", "k", "c", "t@e.com", nil, &db.Organization{WorkosOrganizationID: new("org_1")}, errors.New("fail"), http.StatusInternalServerError},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_ = os.Setenv("WORKOS_API_KEY", tt.apiKey)
			_ = os.Setenv("WORKOS_CLIENT_ID", tt.clientID)
			defer func() { _ = os.Unsetenv("WORKOS_API_KEY") }()
			defer func() { _ = os.Unsetenv("WORKOS_CLIENT_ID") }()

			mockPool := dbtest.NewMockPool(t)
			mockWorkOS := &testutils.MockWorkOSClient{SSOURLErr: tt.ssourlErr}
			h := &SigninHandlerStruct{
				WorkOS: mockWorkOS,
				GetOrg: func(ctx context.Context, q *db.Queries, d string) (*db.Organization, error) {
					return tt.mockOrg, tt.getOrgErr
				},
				GetQueries: func(ctx context.Context) (*db.Queries, error) {
					return db.New(mockPool), nil
				},
			}

			req := httptest.NewRequest(http.MethodGet, "/?email="+tt.email, nil)
			w := serve(h, req)

			if w.Result().StatusCode != tt.wantStatus {
				t.Errorf("%s: Expected %d, got %d", tt.name, tt.wantStatus, w.Result().StatusCode)
			}
		})
	}
}
