package tools

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeSandbox struct {
	id string

	codeResult sandboxCodeResult
	codeErr    error
	codeCalls  []string

	commandResult   sandboxCommandResult
	commandErr      error
	commandCalls    []string
	commandEnvs     []map[string]string
	commandTimeouts []time.Duration

	startErr      error
	startCount    int32
	screenshot    string
	screenshotErr error

	actionErr      error
	actions        []string
	cursorX        int
	cursorY        int
	cursorErr      error
	closeCount     *int32
	closeCountSelf int32
	closeErr       error

	mu sync.Mutex
}

func (f *fakeSandbox) RunCode(
	ctx context.Context,
	code string,
	_ time.Duration,
	_ map[string]string,
) (sandboxCodeResult, error) {
	if err := ctx.Err(); err != nil {
		return sandboxCodeResult{}, err
	}
	f.mu.Lock()
	f.codeCalls = append(f.codeCalls, code)
	f.mu.Unlock()
	return f.codeResult, f.codeErr
}

func (f *fakeSandbox) RunCommand(
	ctx context.Context,
	cmd string,
	timeout time.Duration,
	env map[string]string,
) (sandboxCommandResult, error) {
	if err := ctx.Err(); err != nil {
		return sandboxCommandResult{}, err
	}
	f.mu.Lock()
	f.commandCalls = append(f.commandCalls, cmd)
	f.commandEnvs = append(f.commandEnvs, env)
	f.commandTimeouts = append(f.commandTimeouts, timeout)
	f.mu.Unlock()
	return f.commandResult, f.commandErr
}

func (f *fakeSandbox) StartComputerUse(context.Context) error {
	atomic.AddInt32(&f.startCount, 1)
	return f.startErr
}

func (f *fakeSandbox) Screenshot(context.Context) (string, error) {
	if f.screenshotErr != nil {
		return "", f.screenshotErr
	}
	return f.screenshot, nil
}

func (f *fakeSandbox) Click(_ context.Context, x, y int, button string, double bool) error {
	f.recordAction(fmt.Sprintf("click:%d:%d:%s:%t", x, y, button, double))
	return f.actionErr
}

func (f *fakeSandbox) Drag(_ context.Context, startX, startY, endX, endY int) error {
	f.recordAction(fmt.Sprintf("drag:%d:%d:%d:%d", startX, startY, endX, endY))
	return f.actionErr
}

func (f *fakeSandbox) Scroll(_ context.Context, x, y int, direction string, amount int) error {
	f.recordAction(fmt.Sprintf("scroll:%d:%d:%s:%d", x, y, direction, amount))
	return f.actionErr
}

func (f *fakeSandbox) Type(_ context.Context, text string, delayMS int) error {
	f.recordAction(fmt.Sprintf("type:%s:%d", text, delayMS))
	return f.actionErr
}

func (f *fakeSandbox) Key(_ context.Context, key string) error {
	f.recordAction("key:" + key)
	return f.actionErr
}

func (f *fakeSandbox) CursorPosition(context.Context) (int, int, error) {
	if f.cursorErr != nil {
		return 0, 0, f.cursorErr
	}
	return f.cursorX, f.cursorY, nil
}

func (f *fakeSandbox) Close(context.Context) error {
	if f.closeCount != nil {
		atomic.AddInt32(f.closeCount, 1)
	}
	atomic.AddInt32(&f.closeCountSelf, 1)
	return f.closeErr
}

func (f *fakeSandbox) recordAction(action string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.actions = append(f.actions, action)
}

type fakeFactory struct {
	createErr  error
	createErrs []error
	closeCount int32
	next       []*fakeSandbox
	created    []string
	mu         sync.Mutex
}

func (f *fakeFactory) Create(_ context.Context, kind string) (sandboxSession, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.createErrs) > 0 {
		err := f.createErrs[0]
		f.createErrs = f.createErrs[1:]
		if err != nil {
			return nil, err
		}
	}
	if f.createErr != nil {
		return nil, f.createErr
	}
	f.created = append(f.created, kind)
	if len(f.next) == 0 {
		return &fakeSandbox{id: kind + "-new"}, nil
	}
	sbx := f.next[0]
	f.next = f.next[1:]
	return sbx, nil
}

func (f *fakeFactory) Close(context.Context) error {
	atomic.AddInt32(&f.closeCount, 1)
	return nil
}

func TestMakeSandboxPoolBucket(t *testing.T) {
	assert.Equal(t, "code", makeSandboxPoolBucket("code", ""))
	assert.Equal(t, "desktop", makeSandboxPoolBucket("desktop", "   "))
	assert.Equal(t, "desktop:session-1", makeSandboxPoolBucket("desktop", " session-1 "))
}

func TestCodeExecutionSandboxProfileScopesByRunProfile(t *testing.T) {
	ctx := WithComputerUseExecutionContext(context.Background(), ComputerUseExecutionContext{
		ProfileKey: " user:1 ",
		SessionID:  " session-1 ",
	})

	profile, reusable := codeExecutionSandboxProfile(ctx)

	assert.Equal(t, "profile:user:1:session:session-1", profile)
	assert.True(t, reusable)
}

func TestCodeExecutionSandboxProfileWithoutRunContextIsEphemeral(t *testing.T) {
	profile, reusable := codeExecutionSandboxProfile(context.Background())

	assert.Contains(t, profile, "ephemeral:")
	assert.False(t, reusable)
}

func TestCodeExecutionSandboxProfileUsesSessionOnlyContext(t *testing.T) {
	ctx := WithComputerUseExecutionContext(context.Background(), ComputerUseExecutionContext{SessionID: "run-1"})

	profile, reusable := codeExecutionSandboxProfile(ctx)

	assert.Equal(t, "session:run-1", profile)
	assert.True(t, reusable)
}

func TestDecodeCodeExecutionArgsMarshalError(t *testing.T) {
	previousMarshal := marshalCodeExecutionArgs
	t.Cleanup(func() { marshalCodeExecutionArgs = previousMarshal })
	marshalCodeExecutionArgs = func(any) ([]byte, error) {
		return nil, fmt.Errorf("marshal failed")
	}

	_, err := decodeCodeExecutionArgs(`{"code":"print(1)"}`)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "marshal failed")
}

func TestNewSandboxPoolUsesOptions(t *testing.T) {
	maxPoolSize := 0
	maxBuckets := 7

	pool := NewSandboxPool(SandboxPoolOptions{
		AuthConfigured:    true,
		MaxPoolSize:       &maxPoolSize,
		MaxProfileBuckets: &maxBuckets,
		PoolTTL:           30 * time.Second,
		Factory:           &fakeFactory{},
	})

	assert.True(t, pool.IsAuthConfigured())
	assert.Equal(t, 0, pool.MaxPoolSize())
	assert.Equal(t, 7, pool.MaxProfileBuckets())
	assert.Equal(t, 30*time.Second, pool.PoolTTL())
	assert.NotNil(t, pool.factory)
}

func TestNewSandboxPoolUsesDefaults(t *testing.T) {
	pool := NewSandboxPool()

	assert.False(t, pool.IsAuthConfigured())
	assert.Equal(t, defaultMaxPoolSize, pool.MaxPoolSize())
	assert.Equal(t, defaultMaxProfileBuckets, pool.MaxProfileBuckets())
	assert.Equal(t, defaultSandboxPoolTTL, pool.PoolTTL())
	assert.Nil(t, pool.factory)
}

func TestSandboxPoolConstructorAndNilReceiverEdges(t *testing.T) {
	negativeMaxPoolSize := -1
	zeroBuckets := 0
	pool := NewSandboxPool(SandboxPoolOptions{
		MaxPoolSize:       &negativeMaxPoolSize,
		MaxProfileBuckets: &zeroBuckets,
		PoolTTL:           -time.Second,
	})

	assert.Equal(t, defaultMaxPoolSize, pool.MaxPoolSize())
	assert.Equal(t, defaultMaxProfileBuckets, pool.MaxProfileBuckets())
	assert.Equal(t, defaultSandboxPoolTTL, pool.PoolTTL())

	var nilPool *SandboxPool
	assert.Equal(t, 0, nilPool.MaxPoolSize())
	assert.Equal(t, 0, nilPool.MaxProfileBuckets())
	assert.Equal(t, time.Duration(0), nilPool.PoolTTL())
}

func TestCodeExecutionToolDisabledWithoutCredentials(t *testing.T) {
	tool := CreateCodeExecutionTool(&SandboxPool{})

	result, err := tool.Execute(context.Background(), `{"code":"print(1)"}`)
	require.NoError(t, err)
	assert.Equal(t, false, result["success"])
	assert.Contains(t, result["errors"], "Sandbox provider credentials")
}

func TestCodeExecutionToolInvalidJSON(t *testing.T) {
	tool := CreateCodeExecutionTool(&SandboxPool{authConfigured: true})

	result, err := tool.Execute(context.Background(), "not-json")
	require.Error(t, err)
	assert.Nil(t, result)
}

func TestCodeExecutionToolInvalidArguments(t *testing.T) {
	tool := CreateCodeExecutionTool(&SandboxPool{authConfigured: true})

	result, err := tool.Execute(context.Background(), `{"language":"python"}`)
	require.NoError(t, err)
	assert.Equal(t, false, result["success"])
	assert.Contains(t, result["errors"], "Code is required")
}

func TestCodeExecutionToolRejectsUnsupportedLanguage(t *testing.T) {
	tool := CreateCodeExecutionTool(&SandboxPool{authConfigured: true})

	result, err := tool.Execute(context.Background(), `{"code":"console.log(1)","language":"javascript"}`)
	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "invalid arguments")
}

func TestCodeExecutionSandboxPoolAcquireReleaseBuckets(t *testing.T) {
	pool := &SandboxPool{
		maxPoolSize: 2,
		factory:     &fakeFactory{},
		pools:       make(map[string][]sandboxSession),
	}

	defaultSandbox := &fakeSandbox{id: "default"}
	profileSandbox := &fakeSandbox{id: "profile"}

	pool.Release(context.Background(), defaultSandbox, "code", true)
	pool.ReleaseWithProfile(context.Background(), profileSandbox, "code", " session-1 ", true)
	require.Len(t, pool.pools["code"], 1)
	require.Len(t, pool.pools["code:session-1"], 1)

	acquiredProfile, reusable, err := pool.AcquireWithProfile(context.Background(), "code", "session-1")
	require.NoError(t, err)
	assert.True(t, reusable)
	assert.Same(t, profileSandbox, acquiredProfile)

	acquiredDefault, reusable, err := pool.Acquire(context.Background(), "code")
	require.NoError(t, err)
	assert.True(t, reusable)
	assert.Same(t, defaultSandbox, acquiredDefault)
	assert.Empty(t, pool.pools["code"])
	assert.Empty(t, pool.pools["code:session-1"])
}

func TestCodeExecutionSandboxPoolReleaseClosesWhenNotReusableOrPoolFull(t *testing.T) {
	var closeCount int32
	pool := &SandboxPool{
		maxPoolSize: 1,
		pools:       make(map[string][]sandboxSession),
	}

	keep := &fakeSandbox{id: "keep", closeCount: &closeCount}
	overflow := &fakeSandbox{id: "overflow", closeCount: &closeCount}
	notReusable := &fakeSandbox{id: "not-reusable", closeCount: &closeCount}

	pool.Release(context.Background(), keep, "code", true)
	pool.Release(context.Background(), overflow, "code", true)
	pool.Release(context.Background(), notReusable, "code", false)

	require.Len(t, pool.pools["code"], 1)
	assert.Same(t, keep, pool.pools["code"][0])
	assert.Equal(t, int32(2), atomic.LoadInt32(&closeCount))
}

func TestSandboxPoolReleaseClosesWhenProfileBucketLimitReached(t *testing.T) {
	var closeCount int32
	pool := &SandboxPool{
		maxPoolSize: 2,
		maxBuckets:  1,
		pools:       make(map[string][]sandboxSession),
	}

	first := &fakeSandbox{id: "first", closeCount: &closeCount}
	second := &fakeSandbox{id: "second", closeCount: &closeCount}

	pool.ReleaseWithProfile(context.Background(), first, "desktop", "profile-1", true)
	pool.ReleaseWithProfile(context.Background(), second, "desktop", "profile-2", true)

	require.Len(t, pool.pools["desktop:profile-1"], 1)
	assert.Empty(t, pool.pools["desktop:profile-2"])
	assert.Equal(t, int32(1), atomic.LoadInt32(&closeCount))
}

func TestSandboxPoolPrunesExpiredReusableSandboxes(t *testing.T) {
	var closeCount int32
	now := time.Unix(100, 0)
	pool := &SandboxPool{
		maxPoolSize: 2,
		poolTTL:     time.Second,
		pools:       make(map[string][]sandboxSession),
		releasedAt:  make(map[string][]time.Time),
		now: func() time.Time {
			return now
		},
	}
	expired := &fakeSandbox{id: "expired", closeCount: &closeCount}
	fresh := &fakeSandbox{id: "fresh", closeCount: &closeCount}

	pool.ReleaseWithProfile(context.Background(), expired, "code", "session-1", true)
	now = now.Add(2 * time.Second)
	pool.ReleaseWithProfile(context.Background(), fresh, "code", "session-1", true)

	assert.Equal(t, int32(1), atomic.LoadInt32(&closeCount))
	require.Len(t, pool.pools["code:session-1"], 1)
	assert.Same(t, fresh, pool.pools["code:session-1"][0])
}

func TestSandboxPoolPruneAndStateEdges(t *testing.T) {
	now := time.Unix(100, 0)
	pool := &SandboxPool{
		poolTTL: time.Second,
		pools: map[string][]sandboxSession{
			"code": {&fakeSandbox{closeErr: fmt.Errorf("close failed")}},
		},
		releasedAt: map[string][]time.Time{
			"code": {now.Add(-2 * time.Second)},
		},
	}

	pool.pruneExpiredLocked(context.Background(), now)
	assert.Empty(t, pool.pools["code"])

	emptyStatePool := &SandboxPool{}
	emptyStatePool.ensurePoolStateLocked()
	assert.NotNil(t, emptyStatePool.pools)
	assert.NotNil(t, emptyStatePool.releasedAt)
}

func TestCodeExecutionSandboxPoolCloseTerminatesAllBuckets(t *testing.T) {
	var closeCount int32
	factory := &fakeFactory{}
	pool := &SandboxPool{
		maxPoolSize: 2,
		factory:     factory,
		pools: map[string][]sandboxSession{
			"code": {
				&fakeSandbox{id: "code-1", closeCount: &closeCount},
				&fakeSandbox{id: "code-2", closeCount: &closeCount},
			},
			"desktop:session-1": {
				&fakeSandbox{id: "desktop-1", closeCount: &closeCount},
			},
		},
	}

	pool.Close(context.Background())

	assert.Equal(t, int32(3), atomic.LoadInt32(&closeCount))
	assert.Equal(t, int32(1), atomic.LoadInt32(&factory.closeCount))
	assert.Empty(t, pool.pools)
}

func TestCodeExecutionSandboxPoolAcquireCreatesWhenBucketEmpty(t *testing.T) {
	factory := &fakeFactory{next: []*fakeSandbox{{id: "created"}}}
	pool := &SandboxPool{
		maxPoolSize: 1,
		factory:     factory,
		pools:       make(map[string][]sandboxSession),
	}

	sbx, reusable, err := pool.Acquire(context.Background(), "code")
	require.NoError(t, err)
	assert.True(t, reusable)
	assert.Equal(t, "created", sbx.(*fakeSandbox).id)
	assert.Equal(t, []string{"code"}, factory.created)
}

func TestCodeExecutionSandboxPoolAcquireEdges(t *testing.T) {
	nilFactoryPool := &SandboxPool{pools: map[string][]sandboxSession{}}
	_, _, err := nilFactoryPool.Acquire(context.Background(), "code")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "sandbox factory is not configured")

	nonRetryPool := &SandboxPool{
		factory: &fakeFactory{createErr: fmt.Errorf("quota exceeded")},
		pools:   map[string][]sandboxSession{},
	}
	_, _, err = nonRetryPool.AcquireWithProfile(context.Background(), "code", "profile:1")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "quota exceeded")

	retryFactory := &fakeFactory{
		createErrs: []error{fmt.Errorf("handshake timeout"), nil},
		next:       []*fakeSandbox{{id: "retry-success"}},
	}
	retryPool := &SandboxPool{
		factory: retryFactory,
		pools:   map[string][]sandboxSession{},
	}
	sbx, reusable, err := retryPool.Acquire(context.Background(), "code")
	require.NoError(t, err)
	assert.True(t, reusable)
	assert.Equal(t, "retry-success", sbx.(*fakeSandbox).id)
}

func TestSandboxPoolReleaseAndRetainEdges(t *testing.T) {
	pool := &SandboxPool{maxPoolSize: 1, pools: map[string][]sandboxSession{}}
	pool.Release(context.Background(), nil, "code", true)
	assert.Empty(t, pool.pools)

	pool.Release(context.Background(), &fakeSandbox{closeErr: fmt.Errorf("close failed")}, "code", false)
	assert.Empty(t, pool.pools["code"])

	assert.True(t, pool.canRetainBucketLocked("code", []sandboxSession{&fakeSandbox{}}))
	defaultBucketLimitPool := &SandboxPool{
		pools: map[string][]sandboxSession{
			"existing": {&fakeSandbox{}},
		},
	}
	assert.True(t, defaultBucketLimitPool.canRetainBucketLocked("new", nil))
}

func TestCodeExecutionSandboxPoolAcquireRetryHonorsContextCancellation(t *testing.T) {
	factory := &fakeFactory{createErr: fmt.Errorf("handshake timeout")}
	pool := &SandboxPool{
		factory: factory,
		pools:   make(map[string][]sandboxSession),
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	start := time.Now()
	_, _, err := pool.Acquire(ctx, "code")

	require.ErrorIs(t, err, context.Canceled)
	assert.Less(t, time.Since(start), 100*time.Millisecond)
}

func TestCodeExecutionToolDefaultLanguageAndTimeoutClampOnExecutionFailure(t *testing.T) {
	tests := []struct {
		name string
		args string
	}{
		{name: "defaults timeout when missing or zero", args: `{"code":"print(1)","timeout":0}`},
		{name: "clamps small timeout", args: `{"input":"print(1)","timeout":1}`},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var closeCount int32
			sbx := &fakeSandbox{
				id:         "exec-" + strings.ReplaceAll(tc.name, " ", "-"),
				codeErr:    context.Canceled,
				closeCount: &closeCount,
			}
			ctx := WithComputerUseExecutionContext(context.Background(), ComputerUseExecutionContext{
				ProfileKey: "user:1",
			})
			pool := &SandboxPool{
				authConfigured: true,
				maxPoolSize:    1,
				pools:          map[string][]sandboxSession{"code:profile:user:1": {sbx}},
			}
			tool := CreateCodeExecutionTool(pool)

			result, err := tool.Execute(ctx, tc.args)
			require.NoError(t, err)
			assert.Equal(t, false, result["success"])
			assert.Equal(t, "python", result["language"])
			assert.Contains(t, result["errors"], context.Canceled.Error())
			assert.Equal(t, int32(1), atomic.LoadInt32(&closeCount))
			assert.Empty(t, pool.pools["code:profile:user:1"])
		})
	}
}

func TestCodeExecutionToolAcquireFailureAndInterpreterErrorResult(t *testing.T) {
	pool := &SandboxPool{
		authConfigured: true,
		factory:        &fakeFactory{createErr: fmt.Errorf("quota exceeded")},
		pools:          map[string][]sandboxSession{},
	}
	tool := CreateCodeExecutionTool(pool)

	result, err := tool.Execute(context.Background(), `{"code":"print(1)"}`)
	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "failed to acquire sandbox: quota exceeded")

	var closeCount int32
	sbx := &fakeSandbox{
		codeResult: sandboxCodeResult{
			Stdout:    "before error\n",
			Traceback: "Traceback details",
			HasError:  true,
		},
		closeCount: &closeCount,
	}
	ctx := WithComputerUseExecutionContext(context.Background(), ComputerUseExecutionContext{ProfileKey: "user:1"})
	pool = &SandboxPool{
		authConfigured: true,
		maxPoolSize:    1,
		pools:          map[string][]sandboxSession{"code:profile:user:1": {sbx}},
	}
	tool = CreateCodeExecutionTool(pool)

	result, err = tool.Execute(ctx, `{"code":"raise Exception('boom')","timeout":30000}`)
	require.NoError(t, err)
	assert.Equal(t, false, result["success"])
	assert.Equal(t, "python", result["language"])
	assert.Equal(t, "Traceback details", result["errors"])
	assert.Equal(t, int32(1), atomic.LoadInt32(&closeCount))
	assert.Empty(t, pool.pools["code:profile:user:1"])
}

func TestCodeExecutionToolReturnsOutputAndReusesSandbox(t *testing.T) {
	sbx := &fakeSandbox{
		id:         "success",
		codeResult: sandboxCodeResult{Stdout: "ok\n"},
	}
	ctx := WithComputerUseExecutionContext(context.Background(), ComputerUseExecutionContext{
		ProfileKey: "user:1",
	})
	pool := &SandboxPool{
		authConfigured: true,
		maxPoolSize:    1,
		pools:          map[string][]sandboxSession{"code:profile:user:1": {sbx}},
	}
	tool := CreateCodeExecutionTool(pool)

	result, err := tool.Execute(ctx, `{"script":"print('ok')"}`)
	require.NoError(t, err)
	assert.Equal(t, true, result["success"])
	assert.Equal(t, "ok\n", result["output"])
	assert.Equal(t, []string{"print('ok')"}, sbx.codeCalls)
	require.Len(t, pool.pools["code:profile:user:1"], 1)
	assert.Same(t, sbx, pool.pools["code:profile:user:1"][0])
}

func TestCodeExecutionToolStderrWithoutInterpreterErrorStillSucceeds(t *testing.T) {
	sbx := &fakeSandbox{
		id:         "warning",
		codeResult: sandboxCodeResult{Stdout: "ok\n", Stderr: "warning: noisy dependency\n"},
	}
	ctx := WithComputerUseExecutionContext(context.Background(), ComputerUseExecutionContext{
		ProfileKey: "user:1",
	})
	pool := &SandboxPool{
		authConfigured: true,
		maxPoolSize:    1,
		pools:          map[string][]sandboxSession{"code:profile:user:1": {sbx}},
	}
	tool := CreateCodeExecutionTool(pool)

	result, err := tool.Execute(ctx, `{"code":"print('ok')"}`)
	require.NoError(t, err)
	assert.Equal(t, true, result["success"])
	assert.Equal(t, "warning: noisy dependency\n", result["errors"])
	require.Len(t, pool.pools["code:profile:user:1"], 1)
	assert.Same(t, sbx, pool.pools["code:profile:user:1"][0])
}

func TestCodeExecutionToolGitHubSetupFailureDisablesReuse(t *testing.T) {
	var closeCount int32
	sbx := &fakeSandbox{
		id: "gh-setup",
		commandResult: sandboxCommandResult{
			Stderr:   "install failed",
			ExitCode: 1,
		},
		closeCount: &closeCount,
	}
	ctx := WithComputerUseExecutionContext(context.Background(), ComputerUseExecutionContext{
		ProfileKey: "user:1",
	})
	pool := &SandboxPool{
		authConfigured: true,
		maxPoolSize:    1,
		pools:          map[string][]sandboxSession{"code:profile:user:1": {sbx}},
	}
	tool := CreateCodeExecutionTool(pool, "ghp_token")

	result, err := tool.Execute(ctx, `{"code":"print(1)"}`)
	require.NoError(t, err)
	assert.Equal(t, false, result["success"])
	assert.Contains(t, result["errors"], "failed to set up GitHub environment")
	require.Len(t, sbx.commandCalls, 1)
	assert.Contains(t, sbx.commandCalls[0], "2>&1")
	assert.Equal(t, githubSetupTimeout, sbx.commandTimeouts[0])
	assert.Equal(t, "ghp_token", sbx.commandEnvs[0]["GITHUB_TOKEN"])
	_, hasLanguage := result["language"]
	assert.False(t, hasLanguage)
	assert.Equal(t, int32(1), atomic.LoadInt32(&closeCount))
	assert.Empty(t, pool.pools["code:profile:user:1"])
}
