package pulsebridge

import (
	"context"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

type MockDB struct {
	mock.Mock
}

type resyncDB struct {
	mu      sync.Mutex
	calls   int
	callsCh chan int
}

func TestNewBridgeWithRedis_NilParentUsesBackground(t *testing.T) {
	require.NotPanics(t, func() {
		bridge := NewBridgeWithRedis(nil, nil, nil, "http://engine.example.com", "token") //nolint:staticcheck // Exercise the supported nil fallback.
		require.NotNil(t, bridge.ctx)
		bridge.Stop()
	})
}

func (m *MockDB) ListEnabledAgents(ctx context.Context) ([]AgentRecord, error) {
	args := m.Called(ctx)
	agents, ok := args.Get(0).([]AgentRecord)
	if !ok {
		return nil, fmt.Errorf("unexpected agents type: %T", args.Get(0))
	}
	return agents, args.Error(1)
}

func (m *MockDB) ListAgentsDueForPulse(ctx context.Context) ([]AgentRecord, error) {
	args := m.Called(ctx)
	agents, ok := args.Get(0).([]AgentRecord)
	if !ok {
		return nil, fmt.Errorf("unexpected agents type: %T", args.Get(0))
	}
	return agents, args.Error(1)
}

func (m *MockDB) ClaimAgentPulse(ctx context.Context, arg ClaimAgentPulseInput) (bool, error) {
	args := m.Called(ctx, arg)
	return args.Bool(0), args.Error(1)
}

func (m *MockDB) UpdateAgentPulseState(ctx context.Context, arg UpdateAgentPulseStateInput) error {
	args := m.Called(ctx, arg)
	return args.Error(0)
}

func (m *MockDB) UpdateAgentStatus(ctx context.Context, arg UpdateAgentStatusInput) error {
	args := m.Called(ctx, arg)
	return args.Error(0)
}

func (d *resyncDB) ListEnabledAgents(context.Context) ([]AgentRecord, error) {
	d.mu.Lock()
	d.calls++
	call := d.calls
	d.mu.Unlock()

	select {
	case d.callsCh <- call:
	default:
	}
	if call == 1 {
		return []AgentRecord{}, nil
	}
	return nil, fmt.Errorf("sync fail")
}

func (d *resyncDB) ListAgentsDueForPulse(context.Context) ([]AgentRecord, error) {
	return nil, nil
}

func (d *resyncDB) ClaimAgentPulse(context.Context, ClaimAgentPulseInput) (bool, error) {
	return true, nil
}

func (d *resyncDB) UpdateAgentPulseState(context.Context, UpdateAgentPulseStateInput) error {
	return nil
}

func (d *resyncDB) UpdateAgentStatus(context.Context, UpdateAgentStatusInput) error {
	return nil
}

func TestBridge_RegisterAgent(t *testing.T) {
	m := new(MockDB)
	b := NewBridgeWithRedis(context.Background(), m, nil, "http://localhost:8080", "token")
	now := time.Date(2026, 5, 21, 12, 0, 0, 0, time.UTC)

	agent := AgentRecord{
		ID:            "agent-1",
		Timezone:      "UTC",
		ActiveStart:   "09:00",
		ActiveEnd:     "17:00",
		ActiveDays:    []int32{1, 2, 3, 4, 5},
		CheckInterval: 60,
		LastRunAt:     pgtype.Timestamp{Time: now, Valid: true},
		NextRunAt:     pgtype.Timestamp{Time: now.Add(time.Hour), Valid: true},
	}

	b.RegisterAgent(agent)

	// Verify it was added to the runner
	// Note: We can't easily peek into b.runner's private state,
	// but we can check if it exists in the runner's internal map indirectly
	// if there was an accessor, but Bridge only exposes Runner().
	assert.NotNil(t, b.Runner())
}

func TestBridge_Start(t *testing.T) {
	t.Setenv("VERCEL", "") // Ensure VERCEL is not set

	m := new(MockDB)
	b := NewBridgeWithRedis(context.Background(), m, nil, "http://localhost:8080", "token")

	agents := []AgentRecord{
		{
			ID:            "agent-1",
			Timezone:      "UTC",
			ActiveStart:   "09:00",
			ActiveEnd:     "17:00",
			ActiveDays:    []int32{1, 2, 3, 4, 5},
			CheckInterval: 60,
		},
	}

	m.On("ListEnabledAgents", mock.Anything).Return(agents, nil)

	err := b.Start()
	require.NoError(t, err)
	defer b.Stop()

	m.AssertExpectations(t)
}

func TestBridge_StartBackgroundResyncLogsErrors(t *testing.T) {
	t.Setenv("VERCEL", "")
	oldInterval := resyncInterval
	resyncInterval = time.Millisecond
	t.Cleanup(func() { resyncInterval = oldInterval })

	db := &resyncDB{callsCh: make(chan int, 4)}
	b := NewBridgeWithRedis(context.Background(), db, nil, "http://localhost:8080", "token")
	require.NoError(t, b.Start())
	t.Cleanup(b.Stop)

	for {
		select {
		case call := <-db.callsCh:
			if call >= 2 {
				return
			}
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for background re-sync")
		}
	}
}

type MockRedis struct {
	mock.Mock
}

func (m *MockRedis) Get(ctx context.Context, key string) (string, error) {
	args := m.Called(ctx, key)
	return args.String(0), args.Error(1)
}

func TestBridge_UnregisterAgent(t *testing.T) {
	m := new(MockDB)
	b := NewBridgeWithRedis(context.Background(), m, nil, "http://localhost:8080", "token")
	b.UnregisterAgent("agent-1")
}

func TestBridge_StatusCheck(t *testing.T) {
	m := new(MockDB)
	r := new(MockRedis)
	b := NewBridgeWithRedis(context.Background(), m, r, "http://localhost:8080", "token")

	// Case 1: Redis returns BUSY
	r.On("Get", mock.Anything, "agent_status:agent-1").Return("BUSY", nil).Once()
	assert.True(t, b.statusCheck("agent-1"))

	// Case 2: Redis returns something else
	r.On("Get", mock.Anything, "agent_status:agent-1").Return("IDLE", nil).Once()
	assert.False(t, b.statusCheck("agent-1"))

	// Case 3: Redis error
	r.On("Get", mock.Anything, "agent_status:agent-1").Return("", fmt.Errorf("redis err")).Once()
	assert.False(t, b.statusCheck("agent-1"))

	// Case 4: No Redis
	b2 := NewBridgeWithRedis(context.Background(), m, nil, "u", "t")
	assert.False(t, b2.statusCheck("agent-1"))
}

func TestBridge_Sync_RemoveAgents(t *testing.T) {
	m := new(MockDB)
	b := NewBridgeWithRedis(context.Background(), m, nil, "http://localhost:8080", "token")

	// First register an agent
	agent1 := AgentRecord{ID: "agent-1", CheckInterval: 60}
	b.RegisterAgent(agent1)

	// Now sync with empty list, should remove agent-1
	m.On("ListEnabledAgents", mock.Anything).Return([]AgentRecord{}, nil)
	err := b.Sync()
	assert.NoError(t, err)

	// We can't easily check if it was removed without adding more exports to Runner,
	// but we covered the code path.
}

func TestBridge_Start_Vercel(t *testing.T) {
	t.Setenv("VERCEL", "1")
	m := new(MockDB)
	b := NewBridgeWithRedis(context.Background(), m, nil, "u", "t")
	err := b.Start()
	require.NoError(t, err)
	// Sync should not be called
	m.AssertNotCalled(t, "ListEnabledAgents", mock.Anything)
}

func TestBridge_Sync_Error(t *testing.T) {
	m := new(MockDB)
	b := NewBridgeWithRedis(context.Background(), m, nil, "u", "t")
	m.On("ListEnabledAgents", mock.Anything).Return(nil, fmt.Errorf("db fail"))
	err := b.Sync()
	assert.Error(t, err)
}

func TestBridge_CronTick_PersistsUsingBridgeContext(t *testing.T) {
	m := new(MockDB)
	b := NewBridgeWithRedis(context.Background(), m, nil, "http://localhost:8080", "token")
	b.trigger = func(_ string, _ string) error { return nil }

	agents := []AgentRecord{
		{
			ID:            "agent-1",
			Timezone:      "UTC",
			ActiveStart:   "00:00",
			ActiveEnd:     "23:59",
			ActiveDays:    []int32{0, 1, 2, 3, 4, 5, 6},
			CheckInterval: 300,
		},
	}

	m.On("ListAgentsDueForPulse", mock.Anything).Return(agents, nil).Once()
	m.On("ClaimAgentPulse", mock.Anything, mock.AnythingOfType("pulsebridge.ClaimAgentPulseInput")).Return(true, nil).Once()
	m.On(
		"UpdateAgentPulseState",
		mock.MatchedBy(func(ctx context.Context) bool { return ctx.Err() == nil }),
		mock.AnythingOfType("pulsebridge.UpdateAgentPulseStateInput"),
	).Return(nil).Once()

	reqCtx, cancel := context.WithCancel(context.Background())
	cancel()

	err := b.CronTick(reqCtx)
	require.NoError(t, err)
	m.AssertExpectations(t)
}

func TestBridge_CronTick_ReturnsErrorWhenHeartbeatFails(t *testing.T) {
	m := new(MockDB)
	b := NewBridgeWithRedis(context.Background(), m, nil, "http://localhost:8080", "token")
	b.trigger = func(_ string, _ string) error { return fmt.Errorf("engine unavailable") }

	agents := []AgentRecord{
		{
			ID:            "agent-1",
			Timezone:      "UTC",
			ActiveStart:   "00:00",
			ActiveEnd:     "23:59",
			ActiveDays:    []int32{0, 1, 2, 3, 4, 5, 6},
			CheckInterval: 300,
		},
	}

	m.On("ListAgentsDueForPulse", mock.Anything).Return(agents, nil).Once()
	m.On("ClaimAgentPulse", mock.Anything, mock.AnythingOfType("pulsebridge.ClaimAgentPulseInput")).Return(true, nil).Once()

	err := b.CronTick(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "heartbeat operations failed")
	m.AssertNotCalled(t, "UpdateAgentPulseState", mock.Anything, mock.Anything)
	m.AssertExpectations(t)
}

func TestBridge_CronTick_ReturnsListError(t *testing.T) {
	m := new(MockDB)
	b := NewBridgeWithRedis(context.Background(), m, nil, "http://localhost:8080", "token")
	m.On("ListAgentsDueForPulse", mock.Anything).Return(nil, fmt.Errorf("db fail")).Once()

	err := b.CronTick(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to list agents due")
}

func TestBridge_CronTick_SkipsInactiveAndBusyAgents(t *testing.T) {
	m := new(MockDB)
	r := new(MockRedis)
	b := NewBridgeWithRedis(context.Background(), m, r, "http://localhost:8080", "token")
	b.trigger = func(_ string, _ string) error {
		t.Fatal("trigger should not be called")
		return nil
	}

	agents := []AgentRecord{
		{
			ID:            "inactive-agent",
			Timezone:      "UTC",
			ActiveStart:   "",
			ActiveEnd:     "",
			ActiveDays:    []int32{},
			CheckInterval: 300,
		},
		{
			ID:            "busy-agent",
			Timezone:      "UTC",
			ActiveStart:   "00:00",
			ActiveEnd:     "23:59",
			ActiveDays:    []int32{0, 1, 2, 3, 4, 5, 6},
			CheckInterval: 300,
		},
	}

	m.On("ListAgentsDueForPulse", mock.Anything).Return(agents, nil).Once()
	r.On("Get", mock.Anything, "agent_status:busy-agent").Return("BUSY", nil).Once()

	err := b.CronTick(context.Background())
	require.NoError(t, err)
	m.AssertNotCalled(t, "UpdateAgentPulseState", mock.Anything, mock.Anything)
	m.AssertExpectations(t)
	r.AssertExpectations(t)
}

func TestBridge_CronTick_ReturnsPersistError(t *testing.T) {
	m := new(MockDB)
	b := NewBridgeWithRedis(context.Background(), m, nil, "http://localhost:8080", "token")
	b.trigger = func(_ string, _ string) error { return nil }

	agents := []AgentRecord{
		{
			ID:            "agent-1",
			Timezone:      "UTC",
			ActiveStart:   "00:00",
			ActiveEnd:     "23:59",
			ActiveDays:    []int32{0, 1, 2, 3, 4, 5, 6},
			CheckInterval: 300,
		},
	}

	m.On("ListAgentsDueForPulse", mock.Anything).Return(agents, nil).Once()
	m.On("ClaimAgentPulse", mock.Anything, mock.AnythingOfType("pulsebridge.ClaimAgentPulseInput")).Return(true, nil).Once()
	m.On("UpdateAgentPulseState", mock.Anything, mock.AnythingOfType("pulsebridge.UpdateAgentPulseStateInput")).Return(fmt.Errorf("persist fail")).Once()

	err := b.CronTick(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "heartbeat operations failed")
}

func TestBridge_CronTick_SkipsAgentClaimedByAnotherInvocation(t *testing.T) {
	m := new(MockDB)
	b := NewBridgeWithRedis(context.Background(), m, nil, "http://localhost:8080", "token")
	b.trigger = func(_ string, _ string) error {
		t.Fatal("trigger should not run when the due agent was already claimed")
		return nil
	}

	agents := []AgentRecord{{
		ID:            "agent-1",
		Timezone:      "UTC",
		ActiveStart:   "00:00",
		ActiveEnd:     "23:59",
		ActiveDays:    []int32{0, 1, 2, 3, 4, 5, 6},
		CheckInterval: 300,
	}}
	m.On("ListAgentsDueForPulse", mock.Anything).Return(agents, nil).Once()
	m.On("ClaimAgentPulse", mock.Anything, mock.AnythingOfType("pulsebridge.ClaimAgentPulseInput")).Return(false, nil).Once()

	require.NoError(t, b.CronTick(context.Background()))
	m.AssertNotCalled(t, "UpdateAgentPulseState", mock.Anything, mock.Anything)
	m.AssertExpectations(t)
}

func TestBridge_CronTick_ReturnsClaimErrorWithoutTriggering(t *testing.T) {
	m := new(MockDB)
	b := NewBridgeWithRedis(context.Background(), m, nil, "http://localhost:8080", "token")
	b.trigger = func(_ string, _ string) error {
		t.Fatal("trigger should not run when the claim fails")
		return nil
	}

	agents := []AgentRecord{{
		ID:            "agent-1",
		Timezone:      "UTC",
		ActiveStart:   "00:00",
		ActiveEnd:     "23:59",
		ActiveDays:    []int32{0, 1, 2, 3, 4, 5, 6},
		CheckInterval: 300,
	}}
	m.On("ListAgentsDueForPulse", mock.Anything).Return(agents, nil).Once()
	m.On("ClaimAgentPulse", mock.Anything, mock.AnythingOfType("pulsebridge.ClaimAgentPulseInput")).Return(false, fmt.Errorf("claim failed")).Once()

	err := b.CronTick(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "claim agent-1")
	m.AssertNotCalled(t, "UpdateAgentPulseState", mock.Anything, mock.Anything)
	m.AssertExpectations(t)
}

func TestBridge_Start_ReturnsSyncError(t *testing.T) {
	t.Setenv("VERCEL", "")
	m := new(MockDB)
	b := NewBridgeWithRedis(context.Background(), m, nil, "u", "t")
	m.On("ListEnabledAgents", mock.Anything).Return(nil, fmt.Errorf("db fail")).Once()

	err := b.Start()
	require.Error(t, err)
	m.AssertExpectations(t)
}

func TestBridge_StopWithoutRunnerWork(t *testing.T) {
	m := new(MockDB)
	b := NewBridgeWithRedis(context.Background(), m, nil, "u", "t")
	b.Stop()
}

func TestNewBridgeInitializesRunner(t *testing.T) {
	m := new(MockDB)
	b := NewBridgeWithRedis(context.Background(), m, nil, "http://engine", "token")

	assert.NotNil(t, b.Runner())
	assert.False(t, b.statusCheck("agent-1"))
}

func TestMain(m *testing.M) {
	os.Exit(m.Run())
}
