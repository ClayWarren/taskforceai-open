package authtelemetry

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestAdapterOperationsAndMetrics(t *testing.T) {
	once = sync.Once{}
	instance = nil
	t.Cleanup(func() {
		once = sync.Once{}
		instance = nil
	})

	adapter := New()
	require.NotNil(t, adapter)
	require.Same(t, adapter, New())

	ctx, finish := adapter.StartOperation(context.Background(), "login", map[string]string{"provider": "github"})
	finish(nil)
	_, finish = adapter.StartOperation(ctx, "login-failure", nil)
	finish(errors.New("login failed"))
	adapter.RecordLogin(ctx, "github", true)
	adapter.RecordLogin(ctx, "password", false)
	adapter.RecordRegistration(ctx, true)
	adapter.RecordRegistration(ctx, false)
}
