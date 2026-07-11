package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/TaskForceAI/core/pkg/enginecore/util"
	"github.com/TaskForceAI/core/pkg/platform"
)

const (
	defaultMaxPoolSize       = 3
	defaultMaxProfileBuckets = 32
	defaultSandboxPoolTTL    = 15 * time.Minute
	githubSetupTimeout       = 2 * time.Minute

	SandboxKindCode    = "code"
	SandboxKindDesktop = "desktop"
)

var marshalCodeExecutionArgs = json.Marshal

// CodeExecutionArgs holds the arguments for code execution.
type CodeExecutionArgs struct {
	Code     string `json:"code" validate:"required"`
	Language string `json:"language" validate:"omitempty,oneof=python"`
	Timeout  int    `json:"timeout" validate:"omitempty,min=0,max=30000"`
}

type SandboxCodeResult struct {
	Stdout    string
	Stderr    string
	Traceback string
	HasError  bool
}

type SandboxCommandResult struct {
	Stdout   string
	Stderr   string
	ExitCode int
}

type SandboxSession interface {
	RunCode(ctx context.Context, code string, timeout time.Duration, env map[string]string) (SandboxCodeResult, error)
	RunCommand(ctx context.Context, cmd string, timeout time.Duration, env map[string]string) (SandboxCommandResult, error)
	StartComputerUse(ctx context.Context) error
	Screenshot(ctx context.Context) (string, error)
	Click(ctx context.Context, x, y int, button string, double bool) error
	Drag(ctx context.Context, startX, startY, endX, endY int) error
	Scroll(ctx context.Context, x, y int, direction string, amount int) error
	Type(ctx context.Context, text string, delayMS int) error
	Key(ctx context.Context, key string) error
	CursorPosition(ctx context.Context) (int, int, error)
	Close(ctx context.Context) error
}

type SandboxFactory interface {
	Create(ctx context.Context, kind string) (SandboxSession, error)
	Close(ctx context.Context) error
}

type sandboxCodeResult = SandboxCodeResult
type sandboxCommandResult = SandboxCommandResult
type sandboxSession = SandboxSession

func decodeCodeExecutionArgs(args string) (CodeExecutionArgs, error) {
	var raw map[string]any
	if err := json.Unmarshal([]byte(args), &raw); err != nil {
		return CodeExecutionArgs{}, err
	}

	normalizeStringAlias(raw, "code", "input", "script", "source", "command", "python")

	normalized, err := marshalCodeExecutionArgs(raw)
	if err != nil {
		return CodeExecutionArgs{}, err
	}

	var input CodeExecutionArgs
	if err := json.Unmarshal(normalized, &input); err != nil {
		return CodeExecutionArgs{}, err
	}
	return input, nil
}

func normalizeStringAlias(raw map[string]any, canonical string, aliases ...string) {
	if value, ok := raw[canonical]; ok {
		if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
			return
		}
	}

	for _, alias := range aliases {
		value, ok := raw[alias]
		if !ok {
			continue
		}
		text, ok := value.(string)
		if !ok || strings.TrimSpace(text) == "" {
			continue
		}
		raw[canonical] = text
		return
	}
}

// SandboxPoolOptions controls sandbox pool policy while keeping provider
// construction outside core.
type SandboxPoolOptions struct {
	AuthConfigured    bool
	MaxPoolSize       *int
	MaxProfileBuckets *int
	PoolTTL           time.Duration
	Factory           SandboxFactory
}

// SandboxPool manages reusable sandboxes by type.
type SandboxPool struct {
	authConfigured bool
	maxPoolSize    int
	maxBuckets     int
	poolTTL        time.Duration
	factory        SandboxFactory
	// map of bucket key -> stack of sandboxes
	pools      map[string][]SandboxSession
	releasedAt map[string][]time.Time
	now        func() time.Time
	mu         sync.Mutex
}

// NewSandboxPool creates a new sandbox pool manager.
func NewSandboxPool(options ...SandboxPoolOptions) *SandboxPool {
	cfg := SandboxPoolOptions{
		PoolTTL: defaultSandboxPoolTTL,
	}
	if len(options) > 0 {
		cfg = options[0]
	}
	maxPoolSize := defaultMaxPoolSize
	if cfg.MaxPoolSize != nil {
		maxPoolSize = *cfg.MaxPoolSize
	}
	if maxPoolSize < 0 {
		maxPoolSize = defaultMaxPoolSize
	}
	maxBuckets := defaultMaxProfileBuckets
	if cfg.MaxProfileBuckets != nil {
		maxBuckets = *cfg.MaxProfileBuckets
	}
	if maxBuckets <= 0 {
		maxBuckets = defaultMaxProfileBuckets
	}
	poolTTL := cfg.PoolTTL
	if poolTTL <= 0 {
		poolTTL = defaultSandboxPoolTTL
	}

	return &SandboxPool{
		authConfigured: cfg.AuthConfigured,
		maxPoolSize:    maxPoolSize,
		maxBuckets:     maxBuckets,
		poolTTL:        poolTTL,
		factory:        cfg.Factory,
		pools:          make(map[string][]SandboxSession),
		releasedAt:     make(map[string][]time.Time),
	}
}

func (p *SandboxPool) IsAuthConfigured() bool {
	return p != nil && p.authConfigured
}

func (p *SandboxPool) MaxPoolSize() int {
	if p == nil {
		return 0
	}
	return p.maxPoolSize
}

func (p *SandboxPool) MaxProfileBuckets() int {
	if p == nil {
		return 0
	}
	return p.maxBuckets
}

func (p *SandboxPool) PoolTTL() time.Duration {
	if p == nil {
		return 0
	}
	return p.poolTTL
}

// Acquire gets a sandbox of the specified kind ("code" or "desktop").
func makeSandboxPoolBucket(kind, profile string) string {
	cleanProfile := strings.TrimSpace(profile)
	if cleanProfile == "" {
		return kind
	}
	return kind + ":" + cleanProfile
}

func sandboxProfileClass(profile string) string {
	cleanProfile := strings.TrimSpace(profile)
	if cleanProfile == "" {
		return "default"
	}
	if prefix, _, ok := strings.Cut(cleanProfile, ":"); ok && prefix != "" {
		return prefix
	}
	return cleanProfile
}

// Acquire gets a sandbox of the specified kind ("code" or "desktop").
func (p *SandboxPool) Acquire(ctx context.Context, kind string) (sandboxSession, bool, error) {
	return p.AcquireWithProfile(ctx, kind, "")
}

// AcquireWithProfile gets a sandbox scoped to a profile bucket.
func (p *SandboxPool) AcquireWithProfile(ctx context.Context, kind string, profile string) (sandboxSession, bool, error) {
	start := time.Now()
	profileClass := sandboxProfileClass(profile)
	bucket := makeSandboxPoolBucket(kind, profile)
	p.mu.Lock()
	p.pruneExpiredLocked(ctx, p.currentTime())
	if pool, ok := p.pools[bucket]; ok && len(pool) > 0 {
		sbx := pool[len(pool)-1]
		p.pools[bucket] = pool[:len(pool)-1]
		if times := p.releasedAt[bucket]; len(times) > 0 {
			p.releasedAt[bucket] = times[:len(times)-1]
		}
		remaining := len(p.pools[bucket])
		p.mu.Unlock()
		platform.GetLogger().Info("Sandbox pool acquired reusable sandbox",
			"kind", kind,
			"profileClass", profileClass,
			"durationMs", time.Since(start).Milliseconds(),
			"remaining", remaining,
		)
		return sbx, true, nil
	}
	p.mu.Unlock()

	if p.factory == nil {
		return nil, false, fmt.Errorf("sandbox factory is not configured")
	}

	var sbx SandboxSession
	var err error
	maxRetries := 3

	for i := range maxRetries {
		sbx, err = p.factory.Create(ctx, kind)
		if err == nil {
			platform.GetLogger().Info("Sandbox pool created sandbox",
				"kind", kind,
				"profileClass", profileClass,
				"durationMs", time.Since(start).Milliseconds(),
				"attempt", i+1,
			)
			return sbx, true, nil
		}

		errStr := err.Error()
		if strings.Contains(errStr, "handshake") || strings.Contains(errStr, "timeout") || strings.Contains(errStr, "connection") {
			platform.GetLogger().Warn("Sandbox creation failed, retrying",
				"kind", kind,
				"attempt", i+1,
				"error", errStr,
			)
			select {
			case <-ctx.Done():
				return nil, false, ctx.Err()
			case <-time.After(time.Duration(i+1) * 500 * time.Millisecond):
			}
			continue
		}
		platform.GetLogger().Error("Sandbox creation failed",
			"kind", kind,
			"profileClass", profileClass,
			"error", errStr,
			"errorType", fmt.Sprintf("%T", err),
		)
		break
	}

	platform.GetLogger().Error("Sandbox pool acquire failed",
		"kind", kind,
		"profileClass", profileClass,
		"durationMs", time.Since(start).Milliseconds(),
		"error", err,
	)
	return nil, false, err
}

func (p *SandboxPool) Release(ctx context.Context, sbx sandboxSession, kind string, shouldReuse bool) {
	p.ReleaseWithProfile(ctx, sbx, kind, "", shouldReuse)
}

// ReleaseWithProfile returns a sandbox to a profile-specific pool bucket.
func (p *SandboxPool) ReleaseWithProfile(
	ctx context.Context,
	sbx sandboxSession,
	kind string,
	profile string,
	shouldReuse bool,
) {
	if sbx == nil {
		return
	}

	bucket := makeSandboxPoolBucket(kind, profile)
	p.mu.Lock()
	defer p.mu.Unlock()
	now := p.currentTime()
	p.pruneExpiredLocked(ctx, now)

	pool := p.pools[bucket]
	if !shouldReuse || len(pool) >= p.maxPoolSize || !p.canRetainBucketLocked(bucket, pool) {
		if closeErr := sbx.Close(ctx); closeErr != nil {
			platform.GetLogger().Warn("Failed to close sandbox", "kind", kind, "error", closeErr)
		}
		platform.GetLogger().Info("Sandbox pool closed sandbox",
			"kind", kind,
			"profileClass", sandboxProfileClass(profile),
			"shouldReuse", shouldReuse,
			"poolSize", len(pool),
			"maxPoolSize", p.maxPoolSize,
			"maxBuckets", p.maxBuckets,
		)
		return
	}
	p.pools[bucket] = append(pool, sbx)
	p.releasedAt[bucket] = append(p.releasedAt[bucket], now)
	platform.GetLogger().Info("Sandbox pool released reusable sandbox",
		"kind", kind,
		"profileClass", sandboxProfileClass(profile),
		"poolSize", len(p.pools[bucket]),
		"maxPoolSize", p.maxPoolSize,
	)
}

func (p *SandboxPool) canRetainBucketLocked(_ string, pool []sandboxSession) bool {
	if len(pool) > 0 {
		return true
	}
	maxBuckets := p.maxBuckets
	if maxBuckets <= 0 {
		maxBuckets = defaultMaxProfileBuckets
	}
	nonEmptyBuckets := 0
	for _, existing := range p.pools {
		if len(existing) > 0 {
			nonEmptyBuckets++
		}
	}
	return nonEmptyBuckets < maxBuckets
}

func (p *SandboxPool) pruneExpiredLocked(ctx context.Context, now time.Time) {
	p.ensurePoolStateLocked()
	ttl := p.poolTTL
	if ttl <= 0 {
		ttl = defaultSandboxPoolTTL
	}
	for bucket, pool := range p.pools {
		if len(pool) == 0 {
			continue
		}
		times := p.releasedAt[bucket]
		kept := pool[:0]
		keptTimes := times[:0]
		for i, sbx := range pool {
			released := now
			if i < len(times) && !times[i].IsZero() {
				released = times[i]
			}
			if now.Sub(released) <= ttl {
				kept = append(kept, sbx)
				keptTimes = append(keptTimes, released)
				continue
			}
			if closeErr := sbx.Close(ctx); closeErr != nil {
				platform.GetLogger().Warn("Failed to close expired sandbox", "bucket", bucket, "error", closeErr)
			}
			platform.GetLogger().Info("Sandbox pool closed expired sandbox", "bucket", bucket, "idleMs", now.Sub(released).Milliseconds())
		}
		p.pools[bucket] = kept
		p.releasedAt[bucket] = keptTimes
	}
}

func (p *SandboxPool) ensurePoolStateLocked() {
	if p.pools == nil {
		p.pools = make(map[string][]sandboxSession)
	}
	if p.releasedAt == nil {
		p.releasedAt = make(map[string][]time.Time)
	}
}

func (p *SandboxPool) currentTime() time.Time {
	if p.now != nil {
		return p.now()
	}
	return time.Now()
}

// Close terminates all sandboxes in all pools.
func (p *SandboxPool) Close(ctx context.Context) {
	p.mu.Lock()
	defer p.mu.Unlock()

	for _, pool := range p.pools {
		for _, sbx := range pool {
			_ = sbx.Close(ctx)
		}
	}
	p.pools = make(map[string][]sandboxSession)
	p.releasedAt = make(map[string][]time.Time)
	if p.factory != nil {
		_ = p.factory.Close(ctx)
	}
}

func codeExecutionSandboxProfile(ctx context.Context) (string, bool) {
	executionCtx := ComputerUseExecutionFromContext(ctx)
	if executionCtx.ProfileKey != "" {
		if executionCtx.SessionID != "" {
			return "profile:" + executionCtx.ProfileKey + ":session:" + executionCtx.SessionID, true
		}
		return "profile:" + executionCtx.ProfileKey, true
	}
	if executionCtx.SessionID != "" {
		return "session:" + executionCtx.SessionID, true
	}
	return fmt.Sprintf("ephemeral:%d", time.Now().UnixNano()), false
}

// CreateCodeExecutionTool creates a code execution tool using a sandbox.
// If githubToken is non-empty, it is injected into execution and the gh CLI is
// installed on first use.
func CreateCodeExecutionTool(pool *SandboxPool, githubToken ...string) ITool {
	ghToken := ""
	if len(githubToken) > 0 {
		ghToken = githubToken[0]
	}
	params := ToolParameters{
		Type: "object",
		Properties: map[string]any{
			"code": map[string]any{
				"type":        "string",
				"description": "The code to execute",
			},
			"language": map[string]any{
				"type":        "string",
				"enum":        []string{"python"},
				"description": "The programming language",
				"default":     "python",
			},
			"timeout": map[string]any{
				"type":        "integer",
				"description": "Execution timeout in milliseconds (1000-30000)",
				"default":     10000,
			},
		},
		Required: []string{"code"},
	}

	description := `Execute Python code in a secure sandboxed environment. Returns the output or error.

Available languages: python
Default timeout: 10 seconds (max 30 seconds)

IMPORTANT: When the user asks to execute, run, verify, or test code, you MUST call this tool. Do not just write code without executing it.

Use for:
- Data analysis and calculations
- Processing datasets
- Testing algorithms
- API calls and data fetching
- File transformations
- Verifying code correctness`

	return NewBaseTool(
		"execute_code",
		description,
		params,
		func(ctx context.Context, args string) (ToolResult, error) {
			if pool == nil || !pool.authConfigured {
				return ToolResult{
					"success": false,
					"errors":  "Sandbox provider credentials are not configured. This tool is disabled.",
				}, nil
			}

			input, err := decodeCodeExecutionArgs(args)
			if err != nil {
				return nil, err
			}
			if input.Code == "" {
				return ToolResult{
					"success": false,
					"errors":  "Code is required. Provide JSON like {\"code\":\"print(1)\",\"language\":\"python\"}.",
				}, nil
			}
			if err := util.ValidateStruct(&input); err != nil {
				return nil, fmt.Errorf("invalid arguments: %w", err)
			}

			input.Language = strings.ToLower(strings.TrimSpace(input.Language))
			if input.Language == "" {
				input.Language = "python"
			}

			switch {
			case input.Timeout <= 0:
				input.Timeout = 10000
			case input.Timeout < 1000:
				input.Timeout = 1000
			}

			profile, scopedForReuse := codeExecutionSandboxProfile(ctx)
			sbx, reusable, err := pool.AcquireWithProfile(ctx, SandboxKindCode, profile)
			if err != nil {
				return nil, fmt.Errorf("failed to acquire sandbox: %w", err)
			}

			shouldReuse := scopedForReuse
			defer func() {
				pool.ReleaseWithProfile(ctx, sbx, SandboxKindCode, profile, shouldReuse && reusable)
			}()

			env := map[string]string{}
			if ghToken != "" {
				env["GITHUB_TOKEN"] = ghToken
				setupCommand := "type gh >/dev/null 2>&1 || (curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && echo \"deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null && sudo apt update && sudo apt install gh -y) 2>&1"
				setupCtx, setupCancel := context.WithTimeout(ctx, githubSetupTimeout)
				setup, setupErr := sbx.RunCommand(setupCtx, setupCommand, githubSetupTimeout, env)
				setupCancel()
				if setupErr != nil || setup.ExitCode != 0 {
					shouldReuse = false
					msg := fmt.Sprintf("failed to set up GitHub environment: %v", setupErr)
					if setupErr == nil {
						msg = fmt.Sprintf("failed to set up GitHub environment: %s", strings.TrimSpace(setup.Stderr+setup.Stdout))
					}
					return ToolResult{
						"success": false,
						"errors":  msg,
					}, nil
				}
			}

			executionCtx, cancel := context.WithTimeout(ctx, time.Duration(input.Timeout)*time.Millisecond)
			defer cancel()

			exec, err := sbx.RunCode(executionCtx, input.Code, time.Duration(input.Timeout)*time.Millisecond, env)
			if err != nil {
				shouldReuse = false
				return ToolResult{
					"success":  false,
					"language": input.Language,
					"errors":   err.Error(),
				}, nil
			}

			if exec.HasError {
				shouldReuse = false
			}

			errors := exec.Stderr
			if exec.HasError && errors == "" {
				errors = exec.Traceback
			}

			return ToolResult{
				"success":  !exec.HasError,
				"language": input.Language,
				"output":   exec.Stdout,
				"errors":   errors,
			}, nil
		},
	)
}
