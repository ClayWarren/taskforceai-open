package authorize

import (
	"context"
	"testing"

	auth_mocks "github.com/TaskForceAI/auth-service/mocks/pkg/auth"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

type tenantAwareTestService struct{ *auth_mocks.DeviceService }

func (*tenantAwareTestService) AuthorizeDeviceLoginForOrganization(context.Context, int, *int, string) error {
	return nil
}

func TestClientIPFromRequestInfo(t *testing.T) {
	for _, tc := range []struct {
		name         string
		forwardedFor string
		remoteAddr   string
		want         *string
	}{
		{
			name:         "rightmost untrusted forwarded for wins outside production",
			forwardedFor: " 1.2.3.4, 5.6.7.8 ",
			remoteAddr:   "9.9.9.9:1234",
			want:         new("5.6.7.8"),
		},
		{
			name:       "remote host port",
			remoteAddr: "9.9.9.9:1234",
			want:       new("9.9.9.9"),
		},
		{
			name:       "raw remote fallback",
			remoteAddr: "not-a-host-port",
			want:       new("not-a-host-port"),
		},
		{
			name: "empty",
			want: nil,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := clientIPFromRequestInfo(tc.forwardedFor, tc.remoteAddr)
			if tc.want == nil {
				assert.Nil(t, got)
				return
			}
			assert.NotNil(t, got)
			assert.Equal(t, *tc.want, *got)
		})
	}
}

func TestAuthorizeDeviceLoginUsesLegacyServiceWithoutOrganization(t *testing.T) {
	service := new(auth_mocks.DeviceService)
	service.On("AuthorizeDeviceLogin", mock.Anything, 1, "ABCD-1234").Return(nil).Once()
	result, err := authorizeDeviceLogin(context.Background(), 1, requestInfo{}, AuthorizeRequest{UserCode: "ABCD-1234"}, Deps{Service: service})
	require.NoError(t, err)
	assert.NotNil(t, result)
	service.AssertExpectations(t)
}

func TestAuthorizeDeviceLoginForOrganizationRejectsLegacyService(t *testing.T) {
	service := new(auth_mocks.DeviceService)
	orgID := 7
	result, err := authorizeDeviceLoginForOrganization(
		context.Background(),
		1,
		&orgID,
		requestInfo{},
		AuthorizeRequest{UserCode: "ABCD-1234"},
		Deps{Service: service},
	)
	assert.Nil(t, result)
	assert.Error(t, err)
}

func TestAuthorizeDeviceLoginForOrganizationUsesTenantService(t *testing.T) {
	service := &tenantAwareTestService{DeviceService: new(auth_mocks.DeviceService)}
	orgID := 7
	result, err := authorizeDeviceLoginForOrganization(context.Background(), 1, &orgID, requestInfo{}, AuthorizeRequest{UserCode: "ABCD-1234"}, Deps{Service: service})
	require.NoError(t, err)
	assert.NotNil(t, result)
}

func TestClientIPFromRequestInfoProductionTrustsOnlyProxyForwardedFor(t *testing.T) {
	t.Setenv("NODE_ENV", "production")

	got := clientIPFromRequestInfo("1.2.3.4", "9.9.9.9:1234")
	assert.NotNil(t, got)
	assert.Equal(t, "9.9.9.9", *got)

	got = clientIPFromRequestInfo("1.2.3.4, 5.6.7.8", "76.76.21.10:1234")
	assert.NotNil(t, got)
	assert.Equal(t, "5.6.7.8", *got)
}

//go:fix inline
