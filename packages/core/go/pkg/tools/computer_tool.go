package tools

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"regexp"
	"strings"
	"time"

	"github.com/TaskForceAI/core/pkg/enginecore/util"
	"github.com/TaskForceAI/core/pkg/platform"
)

// ComputerUseArgs holds the arguments for computer interaction.
type ComputerUseArgs struct {
	Action      string `json:"action" validate:"required,oneof=screenshot click double_click right_click drag scroll wait type key cursor_position"`
	CoordinateX *int   `json:"coordinate_x,omitempty"`
	CoordinateY *int   `json:"coordinate_y,omitempty"`
	EndX        *int   `json:"end_x,omitempty"` // drag destination
	EndY        *int   `json:"end_y,omitempty"` // drag destination
	Text        string `json:"text,omitempty"`
	ScrollDir   string `json:"scroll_direction,omitempty" validate:"omitempty,oneof=up down"`
	ScrollAmt   int    `json:"scroll_amount,omitempty" validate:"omitempty,min=0,max=100"`
	Duration    int    `json:"duration,omitempty" validate:"omitempty,min=0,max=5000"`
}

// CreateComputerUseTool creates a tool for interacting with a virtual desktop.
func CreateComputerUseTool(pool *SandboxPool) ITool {
	params := ToolParameters{
		Type: "object",
		Properties: map[string]any{
			"action": map[string]any{
				"type":        "string",
				"enum":        []string{"screenshot", "click", "double_click", "right_click", "drag", "scroll", "wait", "type", "key", "cursor_position"},
				"description": "The action to perform on the computer",
			},
			"coordinate_x": map[string]any{
				"type":        "integer",
				"description": "X coordinate (required for click, double_click, right_click, drag)",
			},
			"coordinate_y": map[string]any{
				"type":        "integer",
				"description": "Y coordinate (required for click, double_click, right_click, drag)",
			},
			"end_x": map[string]any{
				"type":        "integer",
				"description": "Destination X coordinate (required for drag)",
			},
			"end_y": map[string]any{
				"type":        "integer",
				"description": "Destination Y coordinate (required for drag)",
			},
			"text": map[string]any{
				"type":        "string",
				"description": "Text to type or key sequence to press",
			},
			"scroll_direction": map[string]any{
				"type":        "string",
				"enum":        []string{"up", "down"},
				"description": "Direction to scroll (required for scroll action)",
			},
			"scroll_amount": map[string]any{
				"type":        "integer",
				"description": "Number of scroll clicks (default 3)",
			},
			"duration": map[string]any{
				"type":        "integer",
				"description": "Wait duration in milliseconds (default 1000, max 5000)",
			},
		},
		Required: []string{"action"},
	}

	description := `Interact with a virtual computer desktop. You can view the screen, move the mouse, click, drag, scroll, and type.

Supported Actions:
- screenshot: Returns an image of the current screen.
- click: Moves mouse to (x,y) and left-clicks.
- double_click: Moves mouse to (x,y) and double-clicks.
- right_click: Moves mouse to (x,y) and right-clicks.
- drag: Click and drag from (coordinate_x, coordinate_y) to (end_x, end_y).
- scroll: Scrolls up or down by the specified amount.
- wait: Pause for a duration (default 1s, max 5s). Use after clicks to let pages load.
- type: Types the provided text.
- key: Presses a specific key combination (e.g., 'Return', 'Control+c').
- cursor_position: Returns the current mouse coordinates.

Use this tool to navigate websites, use applications, and perform tasks that require a GUI.`

	return NewBaseTool(
		"computer_use",
		description,
		params,
		func(ctx context.Context, args string) (ToolResult, error) {
			totalStart := time.Now()
			timings := make(map[string]int64)
			recordTiming := func(name string, start time.Time) {
				timings[name] = time.Since(start).Milliseconds()
			}
			resultWithTimings := func(result ToolResult) ToolResult {
				recordTiming("total", totalStart)
				result["timings_ms"] = timings
				return result
			}

			if pool == nil || !pool.authConfigured {
				return ToolResult{
					"success": false,
					"errors":  "Sandbox provider credentials are not configured. This tool is disabled.",
				}, nil
			}

			var input ComputerUseArgs
			if err := json.Unmarshal([]byte(args), &input); err != nil {
				return nil, err
			}
			if err := util.ValidateStruct(&input); err != nil {
				return nil, fmt.Errorf("invalid arguments: %w", err)
			}

			executionCtx := ComputerUseExecutionFromContext(ctx)
			profile := "logged_out"
			if executionCtx.UseLoggedInServices {
				profileScope := executionCtx.ProfileKey
				if profileScope == "" {
					profileScope = executionCtx.SessionID
				}
				if profileScope != "" {
					profile = "logged_in:" + profileScope
				} else {
					profile = "logged_in"
				}
			} else if executionCtx.SessionID != "" {
				// Keep browser state for the active run only; session IDs are per-run.
				profile = "logged_out:" + executionCtx.SessionID
			}
			profileClass := sandboxProfileClass(profile)

			acquireStart := time.Now()
			sbx, reusable, err := pool.AcquireWithProfile(ctx, SandboxKindDesktop, profile)
			recordTiming("sandbox_acquire", acquireStart)
			if err != nil {
				return nil, fmt.Errorf("failed to acquire sandbox: %w", err)
			}
			startComputerUse := time.Now()
			if err := sbx.StartComputerUse(ctx); err != nil {
				recordTiming("desktop_start", startComputerUse)
				_ = sbx.Close(ctx)
				result := ToolResult{
					"success": false,
					"errors":  fmt.Sprintf("failed to start computer use: %v", err),
				}
				platform.GetLogger().Warn("Computer use desktop start failed",
					"profileClass", profileClass,
					"action", input.Action,
					"durationMs", timings["desktop_start"],
					"error", err,
				)
				return resultWithTimings(result), nil
			}
			recordTiming("desktop_start", startComputerUse)

			shouldReuse := executionCtx.UseLoggedInServices || executionCtx.SessionID != ""
			defer func() {
				pool.ReleaseWithProfile(ctx, sbx, SandboxKindDesktop, profile, shouldReuse && reusable)
			}()

			actionStart := time.Now()
			result, err := dispatchAction(ctx, sbx, &input)
			recordTiming("action", actionStart)
			if err != nil {
				shouldReuse = false
				result := ToolResult{
					"success": false,
					"errors":  err.Error(),
				}
				platform.GetLogger().Warn("Computer use action failed",
					"profileClass", profileClass,
					"action", input.Action,
					"durationMs", timings["action"],
					"error", err,
				)
				return resultWithTimings(result), nil
			}

			if input.Action != "screenshot" {
				screenshotStart := time.Now()
				scr, scrErr := doScreenshot(ctx, sbx)
				recordTiming("followup_screenshot", screenshotStart)
				if scrErr == nil {
					result["image_base64"] = scr["image_base64"]
				} else {
					result["screenshot_error"] = scrErr.Error()
				}
			}

			recordTiming("total", totalStart)
			result["timings_ms"] = timings
			platform.GetLogger().Info("Computer use action completed",
				"profileClass", profileClass,
				"action", input.Action,
				"sandboxAcquireMs", timings["sandbox_acquire"],
				"desktopStartMs", timings["desktop_start"],
				"actionMs", timings["action"],
				"followupScreenshotMs", timings["followup_screenshot"],
				"totalMs", timings["total"],
			)
			return result, nil
		},
	)
}

const (
	maxCoordinate                     = 10000 // Reasonable upper bound for screen coordinates
	computerScreenshotChromeCropTopPX = 24
)

var (
	cropComputerScreenshotImage = func(img image.Image, rect image.Rectangle) (image.Image, bool) {
		subImage, ok := img.(interface {
			SubImage(r image.Rectangle) image.Image
		})
		if !ok {
			return nil, false
		}
		return subImage.SubImage(rect), true
	}
	encodeComputerScreenshotPNG = png.Encode
)

// validateCoordinates checks that coordinates are within reasonable bounds.
func validateCoordinates(x, y *int) error {
	if x != nil && (*x < 0 || *x > maxCoordinate) {
		return fmt.Errorf("coordinate_x %d is out of bounds (0-%d)", *x, maxCoordinate)
	}
	if y != nil && (*y < 0 || *y > maxCoordinate) {
		return fmt.Errorf("coordinate_y %d is out of bounds (0-%d)", *y, maxCoordinate)
	}
	return nil
}

// dispatchAction routes the action to the appropriate handler and returns a ToolResult.
func dispatchAction(ctx context.Context, sbx sandboxSession, input *ComputerUseArgs) (ToolResult, error) {
	switch input.Action {
	case "screenshot":
		return doScreenshot(ctx, sbx)
	case "click":
		return doClick(ctx, sbx, input, "", false, "Clicked")
	case "double_click":
		return doClick(ctx, sbx, input, "", true, "Double-clicked")
	case "right_click":
		return doClick(ctx, sbx, input, "right", false, "Right-clicked")
	case "drag":
		return doDrag(ctx, sbx, input)
	case "scroll":
		return doScroll(ctx, sbx, input)
	case "wait":
		return doWait(ctx, input)
	case "type":
		return doType(ctx, sbx, input)
	case "key":
		return doKey(ctx, sbx, input)
	case "cursor_position":
		return doCursorPosition(ctx, sbx)
	default:
		return nil, fmt.Errorf("unknown action: %s", input.Action)
	}
}

func doScreenshot(ctx context.Context, sbx sandboxSession) (ToolResult, error) {
	b64, err := sbx.Screenshot(ctx)
	if err != nil {
		return nil, err
	}
	return ToolResult{
		"success":      true,
		"output":       "Screenshot captured.",
		"image_base64": sanitizeComputerScreenshotBase64(b64),
	}, nil
}

func sanitizeComputerScreenshotBase64(raw string) string {
	decoded, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return raw
	}
	img, _, err := image.Decode(bytes.NewReader(decoded))
	if err != nil {
		return raw
	}
	bounds := img.Bounds()
	if bounds.Dy() <= computerScreenshotChromeCropTopPX {
		return raw
	}

	cropRect := image.Rect(
		bounds.Min.X,
		bounds.Min.Y+computerScreenshotChromeCropTopPX,
		bounds.Max.X,
		bounds.Max.Y,
	)
	cropped, ok := cropComputerScreenshotImage(img, cropRect)
	if !ok {
		return raw
	}

	var buf bytes.Buffer
	if err := encodeComputerScreenshotPNG(&buf, cropped); err != nil {
		return raw
	}
	return base64.StdEncoding.EncodeToString(buf.Bytes())
}

// doClick handles click, double_click, and right_click via sandbox mouse APIs.
func doClick(
	ctx context.Context,
	sbx sandboxSession,
	input *ComputerUseArgs,
	button string,
	double bool,
	label string,
) (ToolResult, error) {
	if input.CoordinateX == nil || input.CoordinateY == nil {
		return nil, fmt.Errorf("coordinates required for %s", input.Action)
	}
	if err := validateCoordinates(input.CoordinateX, input.CoordinateY); err != nil {
		return nil, err
	}
	if err := sbx.Click(ctx, *input.CoordinateX, *input.CoordinateY, button, double); err != nil {
		return nil, fmt.Errorf("%s failed: %w", input.Action, err)
	}
	return ToolResult{
		"success": true,
		"output":  fmt.Sprintf("%s at %d, %d", label, *input.CoordinateX, *input.CoordinateY),
	}, nil
}

func doDrag(ctx context.Context, sbx sandboxSession, input *ComputerUseArgs) (ToolResult, error) {
	if input.CoordinateX == nil || input.CoordinateY == nil || input.EndX == nil || input.EndY == nil {
		return nil, fmt.Errorf("coordinate_x, coordinate_y, end_x, and end_y are all required for drag")
	}
	if err := validateCoordinates(input.CoordinateX, input.CoordinateY); err != nil {
		return nil, err
	}
	if err := validateCoordinates(input.EndX, input.EndY); err != nil {
		return nil, err
	}
	if err := sbx.Drag(ctx, *input.CoordinateX, *input.CoordinateY, *input.EndX, *input.EndY); err != nil {
		return nil, fmt.Errorf("drag failed: %w", err)
	}
	return ToolResult{
		"success": true,
		"output":  fmt.Sprintf("Dragged from %d,%d to %d,%d", *input.CoordinateX, *input.CoordinateY, *input.EndX, *input.EndY),
	}, nil
}

func doScroll(ctx context.Context, sbx sandboxSession, input *ComputerUseArgs) (ToolResult, error) {
	dir := input.ScrollDir
	if dir == "" {
		return nil, fmt.Errorf("scroll_direction required for scroll action")
	}
	amt := input.ScrollAmt
	if amt <= 0 {
		amt = 3
	}

	x, y := 0, 0
	if input.CoordinateX != nil && input.CoordinateY != nil {
		if err := validateCoordinates(input.CoordinateX, input.CoordinateY); err != nil {
			return nil, err
		}
		x = *input.CoordinateX
		y = *input.CoordinateY
	} else {
		var err error
		x, y, err = sbx.CursorPosition(ctx)
		if err != nil {
			return nil, fmt.Errorf("cursor position failed: %w", err)
		}
	}

	if err := sbx.Scroll(ctx, x, y, dir, amt); err != nil {
		return nil, fmt.Errorf("scroll failed: %w", err)
	}
	return ToolResult{
		"success": true,
		"output":  fmt.Sprintf("Scrolled %s %d clicks", dir, amt),
	}, nil
}

func doWait(ctx context.Context, input *ComputerUseArgs) (ToolResult, error) {
	dur := input.Duration
	if dur <= 0 {
		dur = 1000
	}
	if dur > 5000 {
		dur = 5000
	}

	timer := time.NewTimer(time.Duration(dur) * time.Millisecond)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return nil, fmt.Errorf("wait failed: %w", ctx.Err())
	case <-timer.C:
	}
	return ToolResult{
		"success": true,
		"output":  fmt.Sprintf("Waited %dms", dur),
	}, nil
}

func doType(ctx context.Context, sbx sandboxSession, input *ComputerUseArgs) (ToolResult, error) {
	if input.Text == "" {
		return nil, fmt.Errorf("text required for type action")
	}
	if err := sbx.Type(ctx, input.Text, 12); err != nil {
		return nil, fmt.Errorf("type failed: %w", err)
	}
	return ToolResult{
		"success": true,
		"output":  fmt.Sprintf("Typed: %s", input.Text),
	}, nil
}

func doKey(ctx context.Context, sbx sandboxSession, input *ComputerUseArgs) (ToolResult, error) {
	if input.Text == "" {
		return nil, fmt.Errorf("text (key combination) required for key action")
	}
	safeKey := sanitizeKeyInput(input.Text)
	if safeKey == "" {
		return nil, fmt.Errorf("invalid key combination: %s", input.Text)
	}
	if err := sbx.Key(ctx, safeKey); err != nil {
		return nil, fmt.Errorf("key press failed: %w", err)
	}
	return ToolResult{
		"success": true,
		"output":  fmt.Sprintf("Pressed key: %s", input.Text),
	}, nil
}

func doCursorPosition(ctx context.Context, sbx sandboxSession) (ToolResult, error) {
	x, y, err := sbx.CursorPosition(ctx)
	if err != nil {
		return nil, fmt.Errorf("get location failed: %w", err)
	}
	stdout := fmt.Sprintf("X=%d\nY=%d", x, y)
	return ToolResult{
		"success":      true,
		"output":       stdout,
		"coordinate_x": x,
		"coordinate_y": y,
	}, nil
}

// validKeyPattern matches sandbox key names: alphanumeric, underscore, plus signs for combos.
// Examples: "Return", "Control+c", "shift+alt+F4"
var validKeyPattern = regexp.MustCompile(`^[a-zA-Z0-9_+]+$`)

// sanitizeKeyInput validates that a key combination only contains safe characters.
// Returns the input unchanged if valid, or empty string if invalid.
func sanitizeKeyInput(key string) string {
	key = strings.TrimSpace(key)
	if key == "" || !validKeyPattern.MatchString(key) {
		return ""
	}
	return key
}
