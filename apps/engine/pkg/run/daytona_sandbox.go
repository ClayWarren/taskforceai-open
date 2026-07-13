package run

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	coretools "github.com/TaskForceAI/core/pkg/tools"
	daytona "github.com/daytonaio/daytona/libs/sdk-go/pkg/daytona"
	doptions "github.com/daytonaio/daytona/libs/sdk-go/pkg/options"
	dtypes "github.com/daytonaio/daytona/libs/sdk-go/pkg/types"
)

const defaultDaytonaCreateTimeout = 90 * time.Second

type daytonaSandboxConfig struct {
	APIKey         string
	JWTToken       string
	OrganizationID string
	APIURL         string
	Target         string
	CreateTimeout  time.Duration
	Snapshots      map[string]string
	Images         map[string]string
}

type daytonaSandboxFactory struct {
	config daytonaSandboxConfig
	mu     sync.Mutex
	client daytonaClientRuntime
}

type daytonaClientRuntime interface {
	Create(context.Context, any, ...func(*doptions.CreateSandbox)) (*daytona.Sandbox, error)
	Close(context.Context) error
}

var newDaytonaClientRuntime = func(config *dtypes.DaytonaConfig) (daytonaClientRuntime, error) {
	return daytona.NewClientWithConfig(config)
}

func newDaytonaSandboxPoolFromEnv() *coretools.SandboxPool {
	config := loadDaytonaSandboxConfigFromEnv()
	return coretools.NewSandboxPool(coretools.SandboxPoolOptions{
		AuthConfigured:    config.authConfigured(),
		MaxPoolSize:       readOptionalNonNegativeInt("DAYTONA_SANDBOX_POOL_SIZE", "SANDBOX_POOL_SIZE"),
		MaxProfileBuckets: readOptionalPositiveInt("DAYTONA_SANDBOX_PROFILE_BUCKETS", "SANDBOX_PROFILE_BUCKETS"),
		PoolTTL:           readSandboxPoolTTLFromEnv(),
		Factory:           newDaytonaSandboxFactory(config),
	})
}

func loadDaytonaSandboxConfigFromEnv() daytonaSandboxConfig {
	return daytonaSandboxConfig{
		APIKey:         os.Getenv("DAYTONA_API_KEY"),
		JWTToken:       os.Getenv("DAYTONA_JWT_TOKEN"),
		OrganizationID: os.Getenv("DAYTONA_ORGANIZATION_ID"),
		APIURL:         os.Getenv("DAYTONA_API_URL"),
		Target:         os.Getenv("DAYTONA_TARGET"),
		CreateTimeout:  daytonaCreateTimeoutFromEnv(),
		Snapshots: map[string]string{
			coretools.SandboxKindCode:    firstNonEmptyEnv("DAYTONA_CODE_SNAPSHOT", "DAYTONA_SANDBOX_SNAPSHOT"),
			coretools.SandboxKindDesktop: firstNonEmptyEnv("DAYTONA_DESKTOP_SNAPSHOT", "DAYTONA_SANDBOX_SNAPSHOT"),
		},
		Images: map[string]string{
			coretools.SandboxKindCode:    firstNonEmptyEnv("DAYTONA_CODE_IMAGE", "DAYTONA_SANDBOX_IMAGE"),
			coretools.SandboxKindDesktop: firstNonEmptyEnv("DAYTONA_DESKTOP_IMAGE", "DAYTONA_SANDBOX_IMAGE"),
		},
	}
}

func (c daytonaSandboxConfig) authConfigured() bool {
	return strings.TrimSpace(c.APIKey) != "" || strings.TrimSpace(c.JWTToken) != ""
}

func newDaytonaSandboxFactory(config daytonaSandboxConfig) *daytonaSandboxFactory {
	return &daytonaSandboxFactory{config: config}
}

func (f *daytonaSandboxFactory) getClient() (daytonaClientRuntime, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	if f.client != nil {
		return f.client, nil
	}

	client, err := newDaytonaClientRuntime(&dtypes.DaytonaConfig{
		APIKey:         f.config.APIKey,
		JWTToken:       f.config.JWTToken,
		OrganizationID: f.config.OrganizationID,
		APIUrl:         f.config.APIURL,
		Target:         f.config.Target,
	})
	if err != nil {
		return nil, err
	}

	f.client = client
	return client, nil
}

func (f *daytonaSandboxFactory) Create(ctx context.Context, kind string) (coretools.SandboxSession, error) {
	client, err := f.getClient()
	if err != nil {
		return nil, err
	}

	sbx, err := client.Create(ctx, f.createParams(kind), doptions.WithTimeout(f.config.createTimeout()))
	if err != nil {
		return nil, err
	}

	return &daytonaSandbox{runtime: daytonaSDKSandboxRuntime{sandbox: sbx}}, nil
}

func (f *daytonaSandboxFactory) Close(ctx context.Context) error {
	f.mu.Lock()
	client := f.client
	f.client = nil
	f.mu.Unlock()

	if client == nil {
		return nil
	}
	return client.Close(ctx)
}

func (f *daytonaSandboxFactory) createParams(kind string) any {
	base := dtypes.SandboxBaseParams{
		Language: dtypes.CodeLanguagePython,
		Labels: map[string]string{
			"taskforceai":      "true",
			"taskforceai_kind": kind,
		},
		Ephemeral: true,
	}

	if snapshot := strings.TrimSpace(f.config.Snapshots[kind]); snapshot != "" {
		return dtypes.SnapshotParams{
			SandboxBaseParams: base,
			Snapshot:          snapshot,
		}
	}
	if image := strings.TrimSpace(f.config.Images[kind]); image != "" {
		return dtypes.ImageParams{
			SandboxBaseParams: base,
			Image:             image,
		}
	}
	return dtypes.SnapshotParams{SandboxBaseParams: base}
}

func (c daytonaSandboxConfig) createTimeout() time.Duration {
	if c.CreateTimeout > 0 {
		return c.CreateTimeout
	}
	return defaultDaytonaCreateTimeout
}

func daytonaCreateTimeoutFromEnv() time.Duration {
	if value := strings.TrimSpace(os.Getenv("DAYTONA_CREATE_TIMEOUT_MS")); value != "" {
		timeout, err := strconv.Atoi(value)
		if err == nil && timeout > 0 {
			return time.Duration(timeout) * time.Millisecond
		}
	}
	value := strings.TrimSpace(os.Getenv("DAYTONA_CREATE_TIMEOUT"))
	if value == "" {
		return defaultDaytonaCreateTimeout
	}
	timeout, err := strconv.Atoi(value)
	if err != nil || timeout <= 0 {
		return defaultDaytonaCreateTimeout
	}
	return time.Duration(timeout) * time.Second
}

func readSandboxPoolTTLFromEnv() time.Duration {
	value := firstNonEmptyEnv("DAYTONA_SANDBOX_POOL_TTL", "SANDBOX_POOL_TTL")
	if value == "" {
		return 0
	}
	if duration, err := time.ParseDuration(value); err == nil && duration > 0 {
		return duration
	}
	if seconds, err := strconv.Atoi(value); err == nil && seconds > 0 {
		return time.Duration(seconds) * time.Second
	}
	return 0
}

func readOptionalNonNegativeInt(keys ...string) *int {
	value := firstNonEmptyEnv(keys...)
	if value == "" {
		return nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 0 {
		return nil
	}
	return &parsed
}

func readOptionalPositiveInt(keys ...string) *int {
	value := firstNonEmptyEnv(keys...)
	if value == "" {
		return nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return nil
	}
	return &parsed
}

func firstNonEmptyEnv(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}

type daytonaSandbox struct {
	runtime         daytonaSandboxRuntime
	computerStarted bool
	mu              sync.Mutex
}

type daytonaSandboxRuntime interface {
	RunCode(context.Context, string, ...func(*doptions.RunCode)) (*daytona.OutputChannels, error)
	ExecuteCommand(context.Context, string, ...func(*doptions.ExecuteCommand)) (*dtypes.ExecuteResponse, error)
	StartComputerUse(context.Context) error
	TakeFullScreen(context.Context, *bool) (*dtypes.ScreenshotResponse, error)
	Click(context.Context, int, int, *string, *bool) (map[string]any, error)
	Drag(context.Context, int, int, int, int, *string) (map[string]any, error)
	Scroll(context.Context, int, int, string, *int) (bool, error)
	Type(context.Context, string, *int) error
	Hotkey(context.Context, string) error
	Press(context.Context, string, []string) error
	GetPosition(context.Context) (map[string]any, error)
	Delete(context.Context) error
}

type daytonaSDKSandboxRuntime struct {
	sandbox *daytona.Sandbox
}

func (r daytonaSDKSandboxRuntime) RunCode(ctx context.Context, code string, opts ...func(*doptions.RunCode)) (*daytona.OutputChannels, error) {
	return r.sandbox.CodeInterpreter.RunCode(ctx, code, opts...)
}

func (r daytonaSDKSandboxRuntime) ExecuteCommand(ctx context.Context, cmd string, opts ...func(*doptions.ExecuteCommand)) (*dtypes.ExecuteResponse, error) {
	return r.sandbox.Process.ExecuteCommand(ctx, cmd, opts...)
}

func (r daytonaSDKSandboxRuntime) StartComputerUse(ctx context.Context) error {
	return r.sandbox.ComputerUse.Start(ctx)
}

func (r daytonaSDKSandboxRuntime) TakeFullScreen(ctx context.Context, showCursor *bool) (*dtypes.ScreenshotResponse, error) {
	return r.sandbox.ComputerUse.Screenshot().TakeFullScreen(ctx, showCursor)
}

func (r daytonaSDKSandboxRuntime) Click(ctx context.Context, x, y int, button *string, double *bool) (map[string]any, error) {
	return r.sandbox.ComputerUse.Mouse().Click(ctx, x, y, button, double)
}

func (r daytonaSDKSandboxRuntime) Drag(ctx context.Context, startX, startY, endX, endY int, button *string) (map[string]any, error) {
	return r.sandbox.ComputerUse.Mouse().Drag(ctx, startX, startY, endX, endY, button)
}

func (r daytonaSDKSandboxRuntime) Scroll(ctx context.Context, x, y int, direction string, amount *int) (bool, error) {
	return r.sandbox.ComputerUse.Mouse().Scroll(ctx, x, y, direction, amount)
}

func (r daytonaSDKSandboxRuntime) Type(ctx context.Context, text string, delay *int) error {
	return r.sandbox.ComputerUse.Keyboard().Type(ctx, text, delay)
}

func (r daytonaSDKSandboxRuntime) Hotkey(ctx context.Context, keys string) error {
	return r.sandbox.ComputerUse.Keyboard().Hotkey(ctx, keys)
}

func (r daytonaSDKSandboxRuntime) Press(ctx context.Context, key string, modifiers []string) error {
	return r.sandbox.ComputerUse.Keyboard().Press(ctx, key, modifiers)
}

func (r daytonaSDKSandboxRuntime) GetPosition(ctx context.Context) (map[string]any, error) {
	return r.sandbox.ComputerUse.Mouse().GetPosition(ctx)
}

func (r daytonaSDKSandboxRuntime) Delete(ctx context.Context) error {
	return r.sandbox.Delete(ctx)
}

func (s *daytonaSandbox) RunCode(
	ctx context.Context,
	code string,
	timeout time.Duration,
	env map[string]string,
) (coretools.SandboxCodeResult, error) {
	channels, err := s.runtime.RunCode(
		ctx,
		code,
		doptions.WithEnv(env),
		doptions.WithInterpreterTimeout(timeout),
	)
	if err != nil {
		return coretools.SandboxCodeResult{}, err
	}

	select {
	case <-ctx.Done():
		return coretools.SandboxCodeResult{}, ctx.Err()
	case result, ok := <-channels.Done:
		if !ok || result == nil {
			return coretools.SandboxCodeResult{}, fmt.Errorf("code execution ended without a result")
		}
		output := coretools.SandboxCodeResult{
			Stdout: result.Stdout,
			Stderr: result.Stderr,
		}
		if result.Error != nil {
			output.HasError = true
			output.Traceback = result.Error.Value
			if result.Error.Traceback != nil && *result.Error.Traceback != "" {
				output.Traceback = *result.Error.Traceback
			} else if result.Error.Name != "" {
				output.Traceback = strings.TrimSpace(result.Error.Name + ": " + result.Error.Value)
			}
		}
		return output, nil
	}
}

func (s *daytonaSandbox) RunCommand(
	ctx context.Context,
	cmd string,
	timeout time.Duration,
	env map[string]string,
) (coretools.SandboxCommandResult, error) {
	res, err := s.runtime.ExecuteCommand(
		ctx,
		cmd,
		doptions.WithExecuteTimeout(timeout),
		doptions.WithCommandEnv(env),
	)
	if err != nil {
		return coretools.SandboxCommandResult{}, err
	}
	return coretools.SandboxCommandResult{
		Stdout:   res.Result,
		ExitCode: res.ExitCode,
	}, nil
}

func (s *daytonaSandbox) StartComputerUse(ctx context.Context) error {
	s.mu.Lock()
	if s.computerStarted {
		s.mu.Unlock()
		return nil
	}
	s.mu.Unlock()

	if err := s.runtime.StartComputerUse(ctx); err != nil {
		return err
	}

	s.mu.Lock()
	s.computerStarted = true
	s.mu.Unlock()
	return nil
}

func (s *daytonaSandbox) Screenshot(ctx context.Context) (string, error) {
	showCursor := true
	res, err := s.runtime.TakeFullScreen(ctx, &showCursor)
	if err != nil {
		return "", err
	}
	image := strings.TrimSpace(res.Image)
	if len(image) < 100 {
		return "", fmt.Errorf("screenshot output too short, likely failed")
	}
	return image, nil
}

func (s *daytonaSandbox) Click(ctx context.Context, x, y int, button string, double bool) error {
	var buttonPtr *string
	if button != "" {
		buttonPtr = &button
	}
	var doublePtr *bool
	if double {
		doublePtr = &double
	}
	_, err := s.runtime.Click(ctx, x, y, buttonPtr, doublePtr)
	return err
}

func (s *daytonaSandbox) Drag(ctx context.Context, startX, startY, endX, endY int) error {
	_, err := s.runtime.Drag(ctx, startX, startY, endX, endY, nil)
	return err
}

func (s *daytonaSandbox) Scroll(ctx context.Context, x, y int, direction string, amount int) error {
	success, err := s.runtime.Scroll(ctx, x, y, direction, &amount)
	if err != nil {
		return err
	}
	if !success {
		return fmt.Errorf("scroll failed")
	}
	return nil
}

func (s *daytonaSandbox) Type(ctx context.Context, text string, delayMS int) error {
	return s.runtime.Type(ctx, text, &delayMS)
}

func (s *daytonaSandbox) Key(ctx context.Context, key string) error {
	normalized := normalizeDaytonaKey(key)
	if strings.Contains(normalized, "+") {
		return s.runtime.Hotkey(ctx, normalized)
	}
	return s.runtime.Press(ctx, normalized, nil)
}

func (s *daytonaSandbox) CursorPosition(ctx context.Context) (int, int, error) {
	pos, err := s.runtime.GetPosition(ctx)
	if err != nil {
		return 0, 0, err
	}
	x, ok := intFromAny(pos["x"])
	if !ok {
		return 0, 0, fmt.Errorf("cursor x coordinate missing from Daytona response")
	}
	y, ok := intFromAny(pos["y"])
	if !ok {
		return 0, 0, fmt.Errorf("cursor y coordinate missing from Daytona response")
	}
	return x, y, nil
}

func (s *daytonaSandbox) Close(ctx context.Context) error {
	return s.runtime.Delete(ctx)
}

func normalizeDaytonaKey(key string) string {
	parts := strings.Split(strings.TrimSpace(key), "+")
	for i, part := range parts {
		switch strings.ToLower(strings.TrimSpace(part)) {
		case "control", "ctrl":
			parts[i] = "ctrl"
		case "command", "cmd", "meta", "win":
			parts[i] = "cmd"
		case "option", "alt":
			parts[i] = "alt"
		case "return", "enter":
			parts[i] = "enter"
		case "escape", "esc":
			parts[i] = "escape"
		default:
			parts[i] = strings.ToLower(strings.TrimSpace(part))
		}
	}
	return strings.Join(parts, "+")
}

func intFromAny(value any) (int, bool) {
	switch typed := value.(type) {
	case int:
		return typed, true
	case int32:
		return int(typed), true
	case int64:
		return int(typed), true
	case float32:
		return int(typed), true
	case float64:
		return int(typed), true
	default:
		return 0, false
	}
}
