package daytonaadapter

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	coretools "github.com/TaskForceAI/core/pkg/tools"
	daytona "github.com/daytonaio/daytona/libs/sdk-go/pkg/daytona"
	doptions "github.com/daytonaio/daytona/libs/sdk-go/pkg/options"
	dtypes "github.com/daytonaio/daytona/libs/sdk-go/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeDaytonaClientRuntime struct {
	createErr     error
	closeErr      error
	createCalls   int
	createdParams any
	timeout       *time.Duration
}

func (f *fakeDaytonaClientRuntime) Create(_ context.Context, params any, opts ...func(*doptions.CreateSandbox)) (*daytona.Sandbox, error) {
	f.createCalls++
	f.createdParams = params
	applied := &doptions.CreateSandbox{}
	for _, opt := range opts {
		opt(applied)
	}
	f.timeout = applied.Timeout
	if f.createErr != nil {
		return nil, f.createErr
	}
	return &daytona.Sandbox{}, nil
}

func (f *fakeDaytonaClientRuntime) Close(context.Context) error {
	return f.closeErr
}

type fakeDaytonaSandboxRuntime struct {
	codeChannels *daytona.OutputChannels
	codeErr      error
	commandRes   *dtypes.ExecuteResponse
	commandErr   error
	startErr     error
	startCalls   int

	screenshotRes *dtypes.ScreenshotResponse
	screenshotErr error
	clickErr      error
	dragErr       error
	scrollSuccess bool
	scrollErr     error
	typeErr       error
	hotkeyErr     error
	pressErr      error
	position      map[string]any
	positionErr   error
	deleteErr     error

	downloadRes    []byte
	downloadErr    error
	uploadErr      error
	deleteFileErr  error
	moveFilesErr   error
	uploadedPath   string
	uploadedData   []byte
	deletedPath    string
	deletedRecurse bool
	moveSource     string
	moveDest       string

	clickButton *string
	clickDouble *bool
	typedText   string
	keyPressed  string
	hotkey      string
}

func (f *fakeDaytonaSandboxRuntime) RunCode(context.Context, string, ...func(*doptions.RunCode)) (*daytona.OutputChannels, error) {
	return f.codeChannels, f.codeErr
}

func (f *fakeDaytonaSandboxRuntime) ExecuteCommand(context.Context, string, ...func(*doptions.ExecuteCommand)) (*dtypes.ExecuteResponse, error) {
	return f.commandRes, f.commandErr
}

func (f *fakeDaytonaSandboxRuntime) StartComputerUse(context.Context) error {
	f.startCalls++
	return f.startErr
}

func (f *fakeDaytonaSandboxRuntime) TakeFullScreen(context.Context, *bool) (*dtypes.ScreenshotResponse, error) {
	return f.screenshotRes, f.screenshotErr
}

func (f *fakeDaytonaSandboxRuntime) Click(_ context.Context, _ int, _ int, button *string, double *bool) (map[string]any, error) {
	f.clickButton = button
	f.clickDouble = double
	return nil, f.clickErr
}

func (f *fakeDaytonaSandboxRuntime) Drag(context.Context, int, int, int, int, *string) (map[string]any, error) {
	return nil, f.dragErr
}

func (f *fakeDaytonaSandboxRuntime) Scroll(context.Context, int, int, string, *int) (bool, error) {
	return f.scrollSuccess, f.scrollErr
}

func (f *fakeDaytonaSandboxRuntime) Type(_ context.Context, text string, _ *int) error {
	f.typedText = text
	return f.typeErr
}

func (f *fakeDaytonaSandboxRuntime) Hotkey(_ context.Context, keys string) error {
	f.hotkey = keys
	return f.hotkeyErr
}

func (f *fakeDaytonaSandboxRuntime) Press(_ context.Context, key string, _ []string) error {
	f.keyPressed = key
	return f.pressErr
}

func (f *fakeDaytonaSandboxRuntime) GetPosition(context.Context) (map[string]any, error) {
	return f.position, f.positionErr
}

func (f *fakeDaytonaSandboxRuntime) DownloadFile(context.Context, string) ([]byte, error) {
	return f.downloadRes, f.downloadErr
}

func (f *fakeDaytonaSandboxRuntime) UploadFile(_ context.Context, content []byte, path string) error {
	f.uploadedData = content
	f.uploadedPath = path
	return f.uploadErr
}

func (f *fakeDaytonaSandboxRuntime) DeleteFile(_ context.Context, path string, recursive bool) error {
	f.deletedPath = path
	f.deletedRecurse = recursive
	return f.deleteFileErr
}

func (f *fakeDaytonaSandboxRuntime) MoveFiles(_ context.Context, source, destination string) error {
	f.moveSource = source
	f.moveDest = destination
	return f.moveFilesErr
}

func (f *fakeDaytonaSandboxRuntime) Delete(context.Context) error {
	return f.deleteErr
}

func daytonaOutputChannels(result *dtypes.ExecutionResult) *daytona.OutputChannels {
	done := make(chan *dtypes.ExecutionResult, 1)
	done <- result
	return &daytona.OutputChannels{Done: done}
}

func TestDaytonaAuthConfiguredChecksSupportedCredentials(t *testing.T) {
	assert.False(t, daytonaSandboxConfig{}.authConfigured())
	assert.True(t, daytonaSandboxConfig{APIKey: "api-key"}.authConfigured())
	assert.True(t, daytonaSandboxConfig{JWTToken: "jwt-token"}.authConfigured())

	t.Setenv("DAYTONA_API_KEY", "")
	t.Setenv("DAYTONA_JWT_TOKEN", "")
	_, err := newDaytonaClientRuntime(&dtypes.DaytonaConfig{})
	require.Error(t, err)
}

func TestDaytonaCreateTimeoutUsesMillisecondsSecondsAndDefaults(t *testing.T) {
	t.Setenv("DAYTONA_CREATE_TIMEOUT_MS", "2500")
	t.Setenv("DAYTONA_CREATE_TIMEOUT", "1")
	assert.Equal(t, 2500*time.Millisecond, daytonaCreateTimeoutFromEnv())

	t.Setenv("DAYTONA_CREATE_TIMEOUT_MS", "")
	t.Setenv("DAYTONA_CREATE_TIMEOUT", "12")
	assert.Equal(t, 12*time.Second, daytonaCreateTimeoutFromEnv())

	t.Setenv("DAYTONA_CREATE_TIMEOUT", "invalid")
	assert.Equal(t, defaultDaytonaCreateTimeout, daytonaCreateTimeoutFromEnv())

	t.Setenv("DAYTONA_CREATE_TIMEOUT", "-1")
	assert.Equal(t, defaultDaytonaCreateTimeout, daytonaCreateTimeoutFromEnv())

	t.Setenv("DAYTONA_CREATE_TIMEOUT_MS", "-1")
	t.Setenv("DAYTONA_CREATE_TIMEOUT", "")
	assert.Equal(t, defaultDaytonaCreateTimeout, daytonaCreateTimeoutFromEnv())
}

func TestDaytonaPoolEnvOptions(t *testing.T) {
	t.Setenv("DAYTONA_API_KEY", "api-key")
	t.Setenv("DAYTONA_SANDBOX_POOL_SIZE", "0")
	t.Setenv("DAYTONA_SANDBOX_PROFILE_BUCKETS", "7")
	t.Setenv("DAYTONA_SANDBOX_POOL_TTL", "30s")

	pool := NewSandboxPoolFromEnv()

	assert.True(t, pool.IsAuthConfigured())
	assert.Equal(t, 0, pool.MaxPoolSize())
	assert.Equal(t, 7, pool.MaxProfileBuckets())
	assert.Equal(t, 30*time.Second, pool.PoolTTL())

	t.Setenv("DAYTONA_SANDBOX_POOL_TTL", "45")
	assert.Equal(t, 45*time.Second, readSandboxPoolTTLFromEnv())

	t.Setenv("DAYTONA_SANDBOX_POOL_TTL", "invalid")
	assert.Zero(t, readSandboxPoolTTLFromEnv())

	t.Setenv("DAYTONA_SANDBOX_POOL_SIZE", "-1")
	assert.Nil(t, readOptionalNonNegativeInt("DAYTONA_SANDBOX_POOL_SIZE"))

	t.Setenv("DAYTONA_SANDBOX_PROFILE_BUCKETS", "0")
	assert.Nil(t, readOptionalPositiveInt("DAYTONA_SANDBOX_PROFILE_BUCKETS"))
}

func TestDaytonaCreateParamsSelectsSnapshotImageAndDefault(t *testing.T) {
	factory := newDaytonaSandboxFactory(daytonaSandboxConfig{
		Snapshots: map[string]string{
			coretools.SandboxKindDesktop: "desktop-snapshot",
		},
		Images: map[string]string{
			coretools.SandboxKindDesktop: "desktop-image",
		},
	})

	snapshot, ok := factory.createParams(coretools.SandboxKindDesktop).(dtypes.SnapshotParams)
	require.True(t, ok)
	assert.Equal(t, "desktop-snapshot", snapshot.Snapshot)
	assert.True(t, snapshot.Ephemeral)
	assert.Equal(t, dtypes.CodeLanguagePython, snapshot.Language)
	assert.Equal(t, "desktop", snapshot.Labels["taskforceai_kind"])
	assert.Equal(t, "true", snapshot.Labels["taskforceai"])

	factory.config.Snapshots[coretools.SandboxKindDesktop] = ""
	imageParams, ok := factory.createParams(coretools.SandboxKindDesktop).(dtypes.ImageParams)
	require.True(t, ok)
	assert.Equal(t, "desktop-image", imageParams.Image)
	assert.Equal(t, "desktop", imageParams.Labels["taskforceai_kind"])

	factory.config.Images[coretools.SandboxKindDesktop] = ""
	defaultParams, ok := factory.createParams(coretools.SandboxKindDesktop).(dtypes.SnapshotParams)
	require.True(t, ok)
	assert.Empty(t, defaultParams.Snapshot)
	assert.True(t, defaultParams.Ephemeral)
}

func TestDaytonaFactoryCloseWithoutClientIsNoop(t *testing.T) {
	factory := newDaytonaSandboxFactory(daytonaSandboxConfig{})

	err := factory.Close(t.Context())

	require.NoError(t, err)
}

func TestDaytonaFactoryClientLifecycle(t *testing.T) {
	originalNewClient := newDaytonaClientRuntime
	t.Cleanup(func() { newDaytonaClientRuntime = originalNewClient })

	fakeClient := &fakeDaytonaClientRuntime{}
	newDaytonaClientRuntime = func(*dtypes.DaytonaConfig) (daytonaClientRuntime, error) {
		return fakeClient, nil
	}

	factory := newDaytonaSandboxFactory(daytonaSandboxConfig{
		APIKey:        "api-key",
		CreateTimeout: 5 * time.Second,
	})
	client, err := factory.getClient()
	require.NoError(t, err)
	assert.Same(t, fakeClient, client)

	cached, err := factory.getClient()
	require.NoError(t, err)
	assert.Same(t, client, cached)

	session, err := factory.Create(t.Context(), coretools.SandboxKindCode)
	require.NoError(t, err)
	require.NotNil(t, session)
	assert.Equal(t, 1, fakeClient.createCalls)
	require.NotNil(t, fakeClient.timeout)
	assert.Equal(t, 5*time.Second, *fakeClient.timeout)

	fakeClient.closeErr = errors.New("close failed")
	err = factory.Close(t.Context())
	require.ErrorContains(t, err, "close failed")
}

func TestDaytonaFactoryClientErrors(t *testing.T) {
	originalNewClient := newDaytonaClientRuntime
	t.Cleanup(func() { newDaytonaClientRuntime = originalNewClient })

	newDaytonaClientRuntime = func(*dtypes.DaytonaConfig) (daytonaClientRuntime, error) {
		return nil, errors.New("client failed")
	}
	factory := newDaytonaSandboxFactory(daytonaSandboxConfig{APIKey: "api-key"})
	_, err := factory.getClient()
	require.ErrorContains(t, err, "client failed")

	_, err = factory.Create(t.Context(), coretools.SandboxKindCode)
	require.ErrorContains(t, err, "client failed")

	fakeClient := &fakeDaytonaClientRuntime{createErr: errors.New("create failed")}
	newDaytonaClientRuntime = func(*dtypes.DaytonaConfig) (daytonaClientRuntime, error) {
		return fakeClient, nil
	}
	factory = newDaytonaSandboxFactory(daytonaSandboxConfig{APIKey: "api-key"})
	_, err = factory.Create(t.Context(), coretools.SandboxKindCode)
	require.ErrorContains(t, err, "create failed")
}

func TestDaytonaConfigCreateTimeoutDefault(t *testing.T) {
	assert.Equal(t, defaultDaytonaCreateTimeout, daytonaSandboxConfig{}.createTimeout())
	assert.Equal(t, 3*time.Second, daytonaSandboxConfig{CreateTimeout: 3 * time.Second}.createTimeout())
}

func TestDaytonaSandboxRunCode(t *testing.T) {
	t.Run("run error", func(t *testing.T) {
		sandbox := &daytonaSandbox{runtime: &fakeDaytonaSandboxRuntime{codeErr: errors.New("run failed")}}
		_, err := sandbox.RunCode(t.Context(), "print(1)", time.Second, nil)
		require.ErrorContains(t, err, "run failed")
	})

	t.Run("context canceled", func(t *testing.T) {
		done := make(chan *dtypes.ExecutionResult)
		sandbox := &daytonaSandbox{runtime: &fakeDaytonaSandboxRuntime{codeChannels: &daytona.OutputChannels{Done: done}}}
		ctx, cancel := context.WithCancel(t.Context())
		cancel()
		_, err := sandbox.RunCode(ctx, "print(1)", time.Second, nil)
		require.ErrorIs(t, err, context.Canceled)
	})

	t.Run("missing result", func(t *testing.T) {
		done := make(chan *dtypes.ExecutionResult)
		close(done)
		sandbox := &daytonaSandbox{runtime: &fakeDaytonaSandboxRuntime{codeChannels: &daytona.OutputChannels{Done: done}}}
		_, err := sandbox.RunCode(t.Context(), "print(1)", time.Second, nil)
		require.ErrorContains(t, err, "without a result")
	})

	t.Run("success", func(t *testing.T) {
		sandbox := &daytonaSandbox{runtime: &fakeDaytonaSandboxRuntime{
			codeChannels: daytonaOutputChannels(&dtypes.ExecutionResult{Stdout: "out", Stderr: "err"}),
		}}
		result, err := sandbox.RunCode(t.Context(), "print(1)", time.Second, map[string]string{"A": "B"})
		require.NoError(t, err)
		assert.Equal(t, "out", result.Stdout)
		assert.Equal(t, "err", result.Stderr)
	})

	t.Run("traceback error", func(t *testing.T) {
		traceback := "stack trace"
		sandbox := &daytonaSandbox{runtime: &fakeDaytonaSandboxRuntime{
			codeChannels: daytonaOutputChannels(&dtypes.ExecutionResult{
				Error: &dtypes.ExecutionError{Name: "ValueError", Value: "bad", Traceback: &traceback},
			}),
		}}
		result, err := sandbox.RunCode(t.Context(), "raise", time.Second, nil)
		require.NoError(t, err)
		assert.True(t, result.HasError)
		assert.Equal(t, "stack trace", result.Traceback)
	})

	t.Run("named error fallback", func(t *testing.T) {
		sandbox := &daytonaSandbox{runtime: &fakeDaytonaSandboxRuntime{
			codeChannels: daytonaOutputChannels(&dtypes.ExecutionResult{
				Error: &dtypes.ExecutionError{Name: "ValueError", Value: "bad"},
			}),
		}}
		result, err := sandbox.RunCode(t.Context(), "raise", time.Second, nil)
		require.NoError(t, err)
		assert.Equal(t, "ValueError: bad", result.Traceback)
	})
}

func TestDaytonaSandboxRunCommand(t *testing.T) {
	sandbox := &daytonaSandbox{runtime: &fakeDaytonaSandboxRuntime{commandErr: errors.New("command failed")}}
	_, err := sandbox.RunCommand(t.Context(), "ls", time.Second, nil)
	require.ErrorContains(t, err, "command failed")

	sandbox = &daytonaSandbox{runtime: &fakeDaytonaSandboxRuntime{commandRes: &dtypes.ExecuteResponse{Result: "ok", ExitCode: 7}}}
	result, err := sandbox.RunCommand(t.Context(), "ls", time.Second, map[string]string{"A": "B"})
	require.NoError(t, err)
	assert.Equal(t, "ok", result.Stdout)
	assert.Equal(t, 7, result.ExitCode)
}

func TestDaytonaSandboxComputerUse(t *testing.T) {
	runtime := &fakeDaytonaSandboxRuntime{scrollSuccess: true, position: map[string]any{"x": float64(12), "y": int32(34)}}
	sandbox := &daytonaSandbox{runtime: runtime}

	require.NoError(t, sandbox.StartComputerUse(t.Context()))
	require.NoError(t, sandbox.StartComputerUse(t.Context()))
	assert.Equal(t, 1, runtime.startCalls)

	require.NoError(t, sandbox.Click(t.Context(), 1, 2, "left", true))
	require.NotNil(t, runtime.clickButton)
	assert.Equal(t, "left", *runtime.clickButton)
	require.NotNil(t, runtime.clickDouble)
	assert.True(t, *runtime.clickDouble)

	require.NoError(t, sandbox.Drag(t.Context(), 1, 2, 3, 4))
	require.NoError(t, sandbox.Scroll(t.Context(), 1, 2, "down", 5))
	require.NoError(t, sandbox.Type(t.Context(), "hello", 10))
	assert.Equal(t, "hello", runtime.typedText)
	require.NoError(t, sandbox.Key(t.Context(), "ctrl+p"))
	assert.Equal(t, "ctrl+p", runtime.hotkey)
	require.NoError(t, sandbox.Key(t.Context(), "enter"))
	assert.Equal(t, "enter", runtime.keyPressed)

	x, y, err := sandbox.CursorPosition(t.Context())
	require.NoError(t, err)
	assert.Equal(t, 12, x)
	assert.Equal(t, 34, y)
	require.NoError(t, sandbox.Close(t.Context()))
}

func TestDaytonaSandboxComputerUseErrors(t *testing.T) {
	sandbox := &daytonaSandbox{runtime: &fakeDaytonaSandboxRuntime{startErr: errors.New("start failed")}}
	require.ErrorContains(t, sandbox.StartComputerUse(t.Context()), "start failed")

	sandbox = &daytonaSandbox{runtime: &fakeDaytonaSandboxRuntime{screenshotErr: errors.New("screenshot failed")}}
	_, err := sandbox.Screenshot(t.Context())
	require.ErrorContains(t, err, "screenshot failed")

	sandbox = &daytonaSandbox{runtime: &fakeDaytonaSandboxRuntime{screenshotRes: &dtypes.ScreenshotResponse{Image: "short"}}}
	_, err = sandbox.Screenshot(t.Context())
	require.ErrorContains(t, err, "too short")

	sandbox = &daytonaSandbox{runtime: &fakeDaytonaSandboxRuntime{screenshotRes: &dtypes.ScreenshotResponse{Image: strings.Repeat("a", 101)}}}
	image, err := sandbox.Screenshot(t.Context())
	require.NoError(t, err)
	assert.Len(t, image, 101)

	sandbox = &daytonaSandbox{runtime: &fakeDaytonaSandboxRuntime{scrollErr: errors.New("scroll failed")}}
	require.ErrorContains(t, sandbox.Scroll(t.Context(), 1, 2, "down", 5), "scroll failed")

	sandbox = &daytonaSandbox{runtime: &fakeDaytonaSandboxRuntime{}}
	require.ErrorContains(t, sandbox.Scroll(t.Context(), 1, 2, "down", 5), "scroll failed")

	sandbox = &daytonaSandbox{runtime: &fakeDaytonaSandboxRuntime{positionErr: errors.New("position failed")}}
	_, _, err = sandbox.CursorPosition(t.Context())
	require.ErrorContains(t, err, "position failed")

	sandbox = &daytonaSandbox{runtime: &fakeDaytonaSandboxRuntime{position: map[string]any{"y": 1}}}
	_, _, err = sandbox.CursorPosition(t.Context())
	require.ErrorContains(t, err, "cursor x")

	sandbox = &daytonaSandbox{runtime: &fakeDaytonaSandboxRuntime{position: map[string]any{"x": 1}}}
	_, _, err = sandbox.CursorPosition(t.Context())
	require.ErrorContains(t, err, "cursor y")

	sandbox = &daytonaSandbox{runtime: &fakeDaytonaSandboxRuntime{deleteErr: errors.New("delete failed")}}
	require.ErrorContains(t, sandbox.Close(t.Context()), "delete failed")
}

func TestDaytonaSandboxFileOperations(t *testing.T) {
	runtime := &fakeDaytonaSandboxRuntime{downloadRes: []byte("file contents")}
	sandbox := &daytonaSandbox{runtime: runtime}

	data, err := sandbox.ReadFile(t.Context(), "/home/user/a.txt")
	require.NoError(t, err)
	assert.Equal(t, "file contents", string(data))

	require.NoError(t, sandbox.WriteFile(t.Context(), "/home/user/b.txt", []byte("new content")))
	assert.Equal(t, "/home/user/b.txt", runtime.uploadedPath)
	assert.Equal(t, "new content", string(runtime.uploadedData))

	require.NoError(t, sandbox.DeleteFile(t.Context(), "/home/user/c.txt"))
	assert.Equal(t, "/home/user/c.txt", runtime.deletedPath)
	assert.False(t, runtime.deletedRecurse)

	require.NoError(t, sandbox.MoveFile(t.Context(), "/home/user/old.txt", "/home/user/new.txt"))
	assert.Equal(t, "/home/user/old.txt", runtime.moveSource)
	assert.Equal(t, "/home/user/new.txt", runtime.moveDest)
}

func TestDaytonaSandboxFileOperationErrors(t *testing.T) {
	sandbox := &daytonaSandbox{runtime: &fakeDaytonaSandboxRuntime{downloadErr: errors.New("download failed")}}
	_, err := sandbox.ReadFile(t.Context(), "/a.txt")
	require.ErrorContains(t, err, "download failed")

	sandbox = &daytonaSandbox{runtime: &fakeDaytonaSandboxRuntime{uploadErr: errors.New("upload failed")}}
	require.ErrorContains(t, sandbox.WriteFile(t.Context(), "/a.txt", nil), "upload failed")

	sandbox = &daytonaSandbox{runtime: &fakeDaytonaSandboxRuntime{deleteFileErr: errors.New("delete failed")}}
	require.ErrorContains(t, sandbox.DeleteFile(t.Context(), "/a.txt"), "delete failed")

	sandbox = &daytonaSandbox{runtime: &fakeDaytonaSandboxRuntime{moveFilesErr: errors.New("move failed")}}
	require.ErrorContains(t, sandbox.MoveFile(t.Context(), "/a.txt", "/b.txt"), "move failed")
}

func TestDaytonaSDKRuntimeForwardsToSandbox(t *testing.T) {
	runtime := daytonaSDKSandboxRuntime{}
	require.Panics(t, func() { _, _ = runtime.RunCode(t.Context(), "print(1)") })
	require.Panics(t, func() { _, _ = runtime.ExecuteCommand(t.Context(), "ls") })
	require.Panics(t, func() { _ = runtime.StartComputerUse(t.Context()) })
	require.Panics(t, func() { _, _ = runtime.TakeFullScreen(t.Context(), nil) })
	require.Panics(t, func() { _, _ = runtime.Click(t.Context(), 1, 2, nil, nil) })
	require.Panics(t, func() { _, _ = runtime.Drag(t.Context(), 1, 2, 3, 4, nil) })
	require.Panics(t, func() { _, _ = runtime.Scroll(t.Context(), 1, 2, "down", nil) })
	require.Panics(t, func() { _ = runtime.Type(t.Context(), "hello", nil) })
	require.Panics(t, func() { _ = runtime.Hotkey(t.Context(), "ctrl+p") })
	require.Panics(t, func() { _ = runtime.Press(t.Context(), "enter", nil) })
	require.Panics(t, func() { _, _ = runtime.GetPosition(t.Context()) })
	require.Panics(t, func() { _ = runtime.Delete(t.Context()) })
	require.Panics(t, func() { _, _ = runtime.DownloadFile(t.Context(), "/a.txt") })
	require.Panics(t, func() { _ = runtime.UploadFile(t.Context(), nil, "/a.txt") })
	require.Panics(t, func() { _ = runtime.DeleteFile(t.Context(), "/a.txt", false) })
	require.Panics(t, func() { _ = runtime.MoveFiles(t.Context(), "/a.txt", "/b.txt") })
}

func TestNormalizeDaytonaKey(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{input: " Control + Shift + P ", expected: "ctrl+shift+p"},
		{input: "cmd+return", expected: "cmd+enter"},
		{input: "Meta+Esc", expected: "cmd+escape"},
		{input: "Win+Option+Delete", expected: "cmd+alt+delete"},
		{input: "Alt+a", expected: "alt+a"},
	}

	for _, tc := range tests {
		assert.Equal(t, tc.expected, normalizeDaytonaKey(tc.input))
	}
}

func TestIntFromAnyAcceptsNumericCoordinateTypes(t *testing.T) {
	tests := []struct {
		name  string
		value any
		want  int
		ok    bool
	}{
		{name: "int", value: int(12), want: 12, ok: true},
		{name: "int32", value: int32(13), want: 13, ok: true},
		{name: "int64", value: int64(14), want: 14, ok: true},
		{name: "float32", value: float32(15.8), want: 15, ok: true},
		{name: "float64", value: float64(16.9), want: 16, ok: true},
		{name: "string", value: "17", ok: false},
		{name: "nil", value: nil, ok: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := intFromAny(tt.value)
			assert.Equal(t, tt.ok, ok)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestDaytonaOptionalEnvironmentValuesCanBeUnset(t *testing.T) {
	t.Setenv("DAYTONA_SANDBOX_POOL_TTL", "")
	t.Setenv("SANDBOX_POOL_TTL", "")
	t.Setenv("DAYTONA_SANDBOX_POOL_SIZE", "")
	t.Setenv("SANDBOX_POOL_SIZE", "")
	t.Setenv("DAYTONA_SANDBOX_PROFILE_BUCKETS", "")
	t.Setenv("SANDBOX_PROFILE_BUCKETS", "")

	assert.Zero(t, readSandboxPoolTTLFromEnv())
	assert.Nil(t, readOptionalNonNegativeInt("DAYTONA_SANDBOX_POOL_SIZE", "SANDBOX_POOL_SIZE"))
	assert.Nil(t, readOptionalPositiveInt("DAYTONA_SANDBOX_PROFILE_BUCKETS", "SANDBOX_PROFILE_BUCKETS"))
}
