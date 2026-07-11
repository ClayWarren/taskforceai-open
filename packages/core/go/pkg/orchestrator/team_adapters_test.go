package orchestrator

import (
	"context"
	"testing"

	"github.com/TaskForceAI/core/pkg/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInMemBus(t *testing.T) {
	bus := NewInMemBus()
	ctx := context.Background()

	// Publish with no handlers
	err := bus.Publish(ctx, "evt1", map[string]any{"key": "val"})
	require.NoError(t, err)

	// Subscribe
	called := false
	err = bus.Subscribe(ctx, "evt1", func(ctx context.Context, properties map[string]any) error {
		called = true
		assert.Equal(t, "val", properties["key"])
		return nil
	})
	require.NoError(t, err)

	// Publish with handler
	err = bus.Publish(ctx, "evt1", map[string]any{"key": "val"})
	require.NoError(t, err)
	assert.True(t, called)

	// Publish with non-map properties should no-op and not call handlers
	called = false
	err = bus.Publish(ctx, "evt1", "not-a-map")
	require.NoError(t, err)
	assert.False(t, called)

	// Handler errors are swallowed by in-memory bus publish loop
	err = bus.Subscribe(ctx, "evt-error", func(ctx context.Context, properties map[string]any) error {
		return assert.AnError
	})
	require.NoError(t, err)
	err = bus.Publish(ctx, "evt-error", map[string]any{"x": 1})
	require.NoError(t, err)

	// Max handlers
	for i := 1; i < MaxHandlersPerEvent; i++ {
		_ = bus.Subscribe(ctx, "evt1", func(ctx context.Context, properties map[string]any) error { return nil })
	}
	err = bus.Subscribe(ctx, "evt1", func(ctx context.Context, properties map[string]any) error { return nil })
	assert.ErrorContains(t, err, "maximum number of handlers")
}

func TestTeamModelProvider(t *testing.T) {
	ctx := context.Background()

	// With nil orch
	provider := &TeamModelProvider{}
	info, err := provider.ParseModel("some/model")
	require.NoError(t, err)
	assert.Equal(t, "default", info.ProviderID)
	assert.Equal(t, "some/model", info.ModelID)

	val, err := provider.GetModel(ctx, "default", "model")
	require.NoError(t, err)
	assert.Nil(t, val)

	defInfo, err := provider.DefaultModel(ctx)
	require.NoError(t, err)
	assert.Equal(t, "openai/gpt-5.6-sol", defInfo.ModelID)

	// With orch
	pch := &TaskOrchestrator{config: config.Config{Gateway: config.GatewayConfig{Model: "my/model"}}}
	providerWithOrch := &TeamModelProvider{orch: pch}
	defInfoWithOrch, err := providerWithOrch.DefaultModel(ctx)
	require.NoError(t, err)
	assert.Equal(t, "my/model", defInfoWithOrch.ModelID)
}

func TestTeamSessionManager(t *testing.T) {
	ctx := context.Background()

	// With nil orch
	mgr := &TeamSessionManager{}
	err := mgr.InjectMessage(ctx, "s1", "user", "text", "msg1")
	require.NoError(t, err)

	err = mgr.AutoWake(ctx, "s1")
	require.NoError(t, err)

	_, _, model, err := mgr.GetSessionInfo(ctx, "s1")
	require.NoError(t, err)
	assert.Equal(t, "openai/gpt-5.6-sol", model)

	err = mgr.UpdatePermissions(ctx, "s1", "pat")
	require.NoError(t, err)

	err = mgr.RestoreLeadPermissions(ctx, "s1", nil)
	require.NoError(t, err)

	err = mgr.CancelPrompt(ctx, "s1")
	require.ErrorContains(t, err, "orchestrator not configured")

	err = mgr.RemoveSession(ctx, "s1")
	require.NoError(t, err)

	sessID, err := mgr.CreateSession(ctx, "parent", "agent", "title", nil)
	require.NoError(t, err)
	assert.Contains(t, sessID, "ses_agent_")

	err = mgr.StartPromptLoop(ctx, "s1")
	require.NoError(t, err)

	modelInfo, err := mgr.GetLastUserMessageModel(ctx, "s1")
	require.NoError(t, err)
	assert.Equal(t, "openai/gpt-5.6-sol", modelInfo.ModelID)

	// With orch
	pch := &TaskOrchestrator{config: config.Config{Gateway: config.GatewayConfig{Model: "my/model"}}}
	mgrWithOrch := &TeamSessionManager{orch: pch}

	_, _, modelWithOrch, err := mgrWithOrch.GetSessionInfo(ctx, "s1")
	require.NoError(t, err)
	assert.Equal(t, "my/model", modelWithOrch)

	modelInfoWithOrch, err := mgrWithOrch.GetLastUserMessageModel(ctx, "s1")
	require.NoError(t, err)
	assert.Equal(t, "my/model", modelInfoWithOrch.ModelID)

	err = mgrWithOrch.CancelPrompt(ctx, "s1")
	require.NoError(t, err)

	// Trigger actual registered cancellation path
	cancelled := false
	pch.sessionCancels = map[string]context.CancelFunc{
		"s-cancel": func() {
			cancelled = true
		},
	}
	err = mgrWithOrch.CancelPrompt(ctx, "s-cancel")
	require.NoError(t, err)
	assert.True(t, cancelled)
}
