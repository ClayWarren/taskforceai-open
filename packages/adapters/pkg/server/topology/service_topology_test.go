package topology

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetServiceDefinitions(t *testing.T) {
	tests := []struct {
		service       Service
		serviceName   string
		serviceURLVar string
		productionURL string
		localURL      string
		defaultPort   string
	}{
		{Auth, "Auth API", "AUTH_SERVICE_URL", "https://auth.taskforceai.chat", "http://localhost:3002", "3002"},
		{Billing, "Billing API", "BILLING_SERVICE_URL", "https://billing.taskforceai.chat", "http://localhost:3003", "3003"},
		{Core, "Core API", "CORE_SERVICE_URL", "https://core.taskforceai.chat", "http://localhost:3001", "3001"},
		{Developer, "Developer API", "DEVELOPER_SERVICE_URL", "https://developer.taskforceai.chat", "http://localhost:3004", "3004"},
		{Engine, "Engine API", "ENGINE_SERVICE_URL", "https://engine.taskforceai.chat", "http://localhost:3006", "3006"},
		{Sync, "Sync API", "SYNC_SERVICE_URL", "https://sync.taskforceai.chat", "http://localhost:3005", "3005"},
	}

	require.Len(t, definitions, len(tests))
	for _, tt := range tests {
		t.Run(string(tt.service), func(t *testing.T) {
			definition := Get(tt.service)
			assert.Equal(t, tt.service, definition.ID)
			assert.Equal(t, tt.serviceName, definition.ServiceName)
			assert.Equal(t, tt.serviceURLVar, definition.ServiceURLVar)
			assert.Equal(t, tt.productionURL, definition.ProductionURL)
			assert.Equal(t, tt.localURL, definition.LocalURL)
			assert.Equal(t, tt.defaultPort, definition.DefaultPort)
		})
	}
}

func TestGetUnknownServicePanics(t *testing.T) {
	assert.PanicsWithValue(t, `unknown service topology: "unknown"`, func() {
		Get(Service("unknown"))
	})
}
