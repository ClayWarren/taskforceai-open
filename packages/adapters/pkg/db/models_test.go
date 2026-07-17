package db

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDeveloperApiTier_Scan(t *testing.T) {
	var e DeveloperApiTier
	require.NoError(t, e.Scan("PRO"))
	assert.Equal(t, DeveloperApiTierPRO, e)
	require.NoError(t, e.Scan([]byte("STARTER")))
	assert.Equal(t, DeveloperApiTierSTARTER, e)
	assert.Error(t, e.Scan(123))
}

func TestNullDeveloperApiTier(t *testing.T) {
	var ns NullDeveloperApiTier
	require.NoError(t, ns.Scan("PRO"))
	assert.True(t, ns.Valid)
	assert.Equal(t, DeveloperApiTierPRO, ns.DeveloperApiTier)

	val, err := ns.Value()
	require.NoError(t, err)
	assert.Equal(t, "PRO", val)

	require.NoError(t, ns.Scan(nil))
	assert.False(t, ns.Valid)
	val, err = ns.Value()
	require.NoError(t, err)
	assert.Nil(t, val)
}

func TestDeviceLoginsStatus_Scan(t *testing.T) {
	var e DeviceLoginsStatus
	require.NoError(t, e.Scan("PENDING"))
	assert.Equal(t, DeviceLoginsStatusPENDING, e)
	assert.Error(t, e.Scan(123))
}

func TestNullDeviceLoginsStatus(t *testing.T) {
	var ns NullDeviceLoginsStatus
	require.NoError(t, ns.Scan("AUTHORIZED"))
	assert.True(t, ns.Valid)
	val, _ := ns.Value()
	assert.Equal(t, "AUTHORIZED", val)

	require.NoError(t, ns.Scan(nil))
	assert.False(t, ns.Valid)
}

func TestOrganizationRole_Scan(t *testing.T) {
	var e OrganizationRole
	require.NoError(t, e.Scan("OWNER"))
	assert.Equal(t, OrganizationRoleOWNER, e)
	assert.Error(t, e.Scan(123))
}

func TestNullOrganizationRole(t *testing.T) {
	var ns NullOrganizationRole
	require.NoError(t, ns.Scan("ADMIN"))
	assert.True(t, ns.Valid)
	val, _ := ns.Value()
	assert.Equal(t, "ADMIN", val)

	require.NoError(t, ns.Scan(nil))
	assert.False(t, ns.Valid)
}

func TestSubscriptionSource_Scan(t *testing.T) {
	var e SubscriptionSource
	require.NoError(t, e.Scan("STRIPE"))
	assert.Equal(t, SubscriptionSourceSTRIPE, e)
	assert.Error(t, e.Scan(123))
}

func TestNullSubscriptionSource(t *testing.T) {
	var ns NullSubscriptionSource
	require.NoError(t, ns.Scan("APP_STORE"))
	assert.True(t, ns.Valid)
	val, _ := ns.Value()
	assert.Equal(t, "APP_STORE", val)

	require.NoError(t, ns.Scan(nil))
	assert.False(t, ns.Valid)
}
