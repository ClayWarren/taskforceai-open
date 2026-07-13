package tools

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidateCoordinates(t *testing.T) {
	x := 10
	y := 20
	require.NoError(t, validateCoordinates(&x, &y))

	xBad := -1
	err := validateCoordinates(&xBad, &y)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "coordinate_x")

	yBad := maxCoordinate + 1
	err = validateCoordinates(&x, &yBad)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "coordinate_y")
}

func TestSanitizeKeyInput(t *testing.T) {
	assert.Equal(t, "Control+c", sanitizeKeyInput(" Control+c "))
	assert.Equal(t, "shift+alt+F4", sanitizeKeyInput("shift+alt+F4"))
	assert.Empty(t, sanitizeKeyInput(""))
	assert.Empty(t, sanitizeKeyInput("Control c"))
	assert.Empty(t, sanitizeKeyInput("Control+c\nReturn"))
	assert.Empty(t, sanitizeKeyInput("Control+c;rm -rf /"))
}

func TestDispatchActionUnknown(t *testing.T) {
	result, err := dispatchAction(context.Background(), nil, &ComputerUseArgs{Action: "unknown"})
	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "unknown action")
}

func TestComputerUseToolDisabledWithoutCredentials(t *testing.T) {
	tool := CreateComputerUseTool(&SandboxPool{})

	result, err := tool.Execute(context.Background(), `{"action":"screenshot"}`)
	require.NoError(t, err)
	assert.Equal(t, false, result["success"])
	assert.Contains(t, result["errors"], "Sandbox provider credentials")
}

func TestComputerUseToolInvalidJSON(t *testing.T) {
	tool := CreateComputerUseTool(&SandboxPool{authConfigured: true})

	result, err := tool.Execute(context.Background(), "not-json")
	require.Error(t, err)
	assert.Nil(t, result)
}

func TestComputerUseToolInvalidAction(t *testing.T) {
	tool := CreateComputerUseTool(&SandboxPool{authConfigured: true})

	result, err := tool.Execute(context.Background(), `{"action":"invalid"}`)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid arguments")
	assert.Nil(t, result)
}

func TestComputerDispatchActionClickVariants(t *testing.T) {
	x := 10
	y := 20
	cases := []struct {
		action         string
		expectedAction string
		expectedOutput string
	}{
		{
			action:         "click",
			expectedAction: "click:10:20::false",
			expectedOutput: "Clicked at 10, 20",
		},
		{
			action:         "double_click",
			expectedAction: "click:10:20::true",
			expectedOutput: "Double-clicked at 10, 20",
		},
		{
			action:         "right_click",
			expectedAction: "click:10:20:right:false",
			expectedOutput: "Right-clicked at 10, 20",
		},
	}

	sbx := &fakeSandbox{}
	for _, tc := range cases {
		t.Run(tc.action, func(t *testing.T) {
			result, err := dispatchAction(context.Background(), sbx, &ComputerUseArgs{
				Action:      tc.action,
				CoordinateX: &x,
				CoordinateY: &y,
			})
			require.NoError(t, err)
			assert.Equal(t, true, result["success"])
			assert.Equal(t, tc.expectedOutput, result["output"])
		})
	}

	assert.Equal(t, []string{
		cases[0].expectedAction,
		cases[1].expectedAction,
		cases[2].expectedAction,
	}, sbx.actions)
}

func TestComputerClickValidationAndExecutionErrors(t *testing.T) {
	result, err := dispatchAction(context.Background(), nil, &ComputerUseArgs{Action: "click"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "coordinates required for click")
	assert.Nil(t, result)

	x := -1
	y := 20
	result, err = dispatchAction(context.Background(), nil, &ComputerUseArgs{
		Action:      "click",
		CoordinateX: &x,
		CoordinateY: &y,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "coordinate_x")
	assert.Nil(t, result)

	x = 5
	y = 6
	result, err = dispatchAction(context.Background(), &fakeSandbox{actionErr: fmt.Errorf("cannot click")}, &ComputerUseArgs{
		Action:      "click",
		CoordinateX: &x,
		CoordinateY: &y,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "click failed: cannot click")
	assert.Nil(t, result)
}

func TestComputerDragAndErrorPaths(t *testing.T) {
	sbx := &fakeSandbox{}
	startX := 12
	startY := 40
	endX := 300
	endY := 310

	result, err := dispatchAction(context.Background(), sbx, &ComputerUseArgs{
		Action:      "drag",
		CoordinateX: &startX,
		CoordinateY: &startY,
		EndX:        &endX,
		EndY:        &endY,
	})
	require.NoError(t, err)
	assert.Equal(t, true, result["success"])
	assert.Equal(t, "Dragged from 12,40 to 300,310", result["output"])
	assert.Equal(t, []string{"drag:12:40:300:310"}, sbx.actions)

	result, err = dispatchAction(context.Background(), nil, &ComputerUseArgs{
		Action:      "drag",
		CoordinateX: &startX,
		CoordinateY: &startY,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "coordinate_x, coordinate_y, end_x, and end_y are all required for drag")
	assert.Nil(t, result)

	invalidStartX := -1
	result, err = dispatchAction(context.Background(), nil, &ComputerUseArgs{
		Action:      "drag",
		CoordinateX: &invalidStartX,
		CoordinateY: &startY,
		EndX:        &endX,
		EndY:        &endY,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "coordinate_x")
	assert.Nil(t, result)

	invalidEndX := maxCoordinate + 10
	result, err = dispatchAction(context.Background(), nil, &ComputerUseArgs{
		Action:      "drag",
		CoordinateX: &startX,
		CoordinateY: &startY,
		EndX:        &invalidEndX,
		EndY:        &endY,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "coordinate_x")
	assert.Nil(t, result)

	result, err = dispatchAction(context.Background(), &fakeSandbox{actionErr: fmt.Errorf("drag failed in sandbox")}, &ComputerUseArgs{
		Action:      "drag",
		CoordinateX: &startX,
		CoordinateY: &startY,
		EndX:        &endX,
		EndY:        &endY,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "drag failed: drag failed in sandbox")
	assert.Nil(t, result)
}

func TestComputerScrollAndErrorPaths(t *testing.T) {
	sbx := &fakeSandbox{cursorX: 44, cursorY: 55}

	result, err := dispatchAction(context.Background(), sbx, &ComputerUseArgs{
		Action:    "scroll",
		ScrollDir: "down",
	})
	require.NoError(t, err)
	assert.Equal(t, true, result["success"])
	assert.Equal(t, "Scrolled down 3 clicks", result["output"])

	x := 10
	y := 11
	result, err = dispatchAction(context.Background(), sbx, &ComputerUseArgs{
		Action:      "scroll",
		CoordinateX: &x,
		CoordinateY: &y,
		ScrollDir:   "up",
		ScrollAmt:   2,
	})
	require.NoError(t, err)
	assert.Equal(t, true, result["success"])
	assert.Equal(t, "Scrolled up 2 clicks", result["output"])

	assert.Equal(t, []string{
		"scroll:44:55:down:3",
		"scroll:10:11:up:2",
	}, sbx.actions)

	result, err = dispatchAction(context.Background(), nil, &ComputerUseArgs{Action: "scroll"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "scroll_direction required for scroll action")
	assert.Nil(t, result)

	result, err = dispatchAction(context.Background(), &fakeSandbox{cursorErr: fmt.Errorf("cursor unavailable")}, &ComputerUseArgs{
		Action:    "scroll",
		ScrollDir: "down",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "cursor position failed: cursor unavailable")
	assert.Nil(t, result)

	invalidX := maxCoordinate + 1
	result, err = dispatchAction(context.Background(), nil, &ComputerUseArgs{
		Action:      "scroll",
		CoordinateX: &invalidX,
		CoordinateY: &y,
		ScrollDir:   "down",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "coordinate_x")
	assert.Nil(t, result)

	result, err = dispatchAction(context.Background(), &fakeSandbox{actionErr: fmt.Errorf("scroll failed in sandbox")}, &ComputerUseArgs{
		Action:    "scroll",
		ScrollDir: "down",
		ScrollAmt: 1,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "scroll failed: scroll failed in sandbox")
	assert.Nil(t, result)
}

func TestComputerWaitAndErrorPaths(t *testing.T) {
	result, err := dispatchAction(context.Background(), nil, &ComputerUseArgs{
		Action:   "wait",
		Duration: 1,
	})
	require.NoError(t, err)
	assert.Equal(t, true, result["success"])
	assert.Equal(t, "Waited 1ms", result["output"])

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	result, err = dispatchAction(ctx, nil, &ComputerUseArgs{Action: "wait", Duration: 10})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "wait failed: context canceled")
	assert.Nil(t, result)

	result, err = dispatchAction(ctx, nil, &ComputerUseArgs{Action: "wait"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "wait failed: context canceled")
	assert.Nil(t, result)

	result, err = dispatchAction(ctx, nil, &ComputerUseArgs{Action: "wait", Duration: 6000})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "wait failed: context canceled")
	assert.Nil(t, result)
}

func TestComputerTypeAndErrors(t *testing.T) {
	result, err := dispatchAction(context.Background(), nil, &ComputerUseArgs{Action: "type"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "text required for type action")
	assert.Nil(t, result)

	sbx := &fakeSandbox{}
	result, err = dispatchAction(context.Background(), sbx, &ComputerUseArgs{
		Action: "type",
		Text:   "it's ready",
	})
	require.NoError(t, err)
	assert.Equal(t, true, result["success"])
	assert.Equal(t, "Typed: it's ready", result["output"])
	assert.Equal(t, []string{"type:it's ready:12"}, sbx.actions)

	result, err = dispatchAction(context.Background(), &fakeSandbox{actionErr: fmt.Errorf("type failed in sandbox")}, &ComputerUseArgs{
		Action: "type",
		Text:   "hello",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "type failed: type failed in sandbox")
	assert.Nil(t, result)
}

func TestComputerKeySanitizationAndErrors(t *testing.T) {
	result, err := dispatchAction(context.Background(), nil, &ComputerUseArgs{Action: "key"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "text (key combination) required for key action")
	assert.Nil(t, result)

	result, err = dispatchAction(context.Background(), nil, &ComputerUseArgs{
		Action: "key",
		Text:   "Control+c;rm -rf /",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid key combination")
	assert.Nil(t, result)

	sbx := &fakeSandbox{}
	result, err = dispatchAction(context.Background(), sbx, &ComputerUseArgs{
		Action: "key",
		Text:   " Control+c ",
	})
	require.NoError(t, err)
	assert.Equal(t, true, result["success"])
	assert.Equal(t, "Pressed key:  Control+c ", result["output"])
	assert.Equal(t, []string{"key:Control+c"}, sbx.actions)

	result, err = dispatchAction(context.Background(), &fakeSandbox{actionErr: fmt.Errorf("key input rejected")}, &ComputerUseArgs{
		Action: "key",
		Text:   "Return",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "key press failed: key input rejected")
	assert.Nil(t, result)
}

func TestComputerCursorPositionAndErrors(t *testing.T) {
	result, err := dispatchAction(context.Background(), &fakeSandbox{cursorX: 321, cursorY: 654}, &ComputerUseArgs{Action: "cursor_position"})
	require.NoError(t, err)
	assert.Equal(t, true, result["success"])
	assert.Equal(t, "X=321\nY=654", result["output"])
	assert.Equal(t, 321, result["coordinate_x"])
	assert.Equal(t, 654, result["coordinate_y"])

	result, err = dispatchAction(context.Background(), &fakeSandbox{cursorErr: fmt.Errorf("mouse query failed")}, &ComputerUseArgs{Action: "cursor_position"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "get location failed: mouse query failed")
	assert.Nil(t, result)
}

func TestComputerScreenshot(t *testing.T) {
	const screenshotBase64 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	result, err := dispatchAction(context.Background(), &fakeSandbox{screenshot: screenshotBase64}, &ComputerUseArgs{Action: "screenshot"})
	require.NoError(t, err)
	assert.Equal(t, true, result["success"])
	assert.Equal(t, "Screenshot captured.", result["output"])
	assert.Equal(t, screenshotBase64, result["image_base64"])

	result, err = dispatchAction(context.Background(), &fakeSandbox{screenshotErr: fmt.Errorf("capture failed")}, &ComputerUseArgs{Action: "screenshot"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "capture failed")
	assert.Nil(t, result)
}

func TestComputerScreenshotCropsProviderChrome(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 4, computerScreenshotChromeCropTopPX+6))
	for y := 0; y < img.Bounds().Dy(); y++ {
		for x := 0; x < img.Bounds().Dx(); x++ {
			if y < computerScreenshotChromeCropTopPX {
				img.Set(x, y, color.RGBA{R: 255, A: 255})
			} else {
				img.Set(x, y, color.RGBA{B: 255, A: 255})
			}
		}
	}

	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, img))
	encoded := base64.StdEncoding.EncodeToString(buf.Bytes())

	result, err := dispatchAction(context.Background(), &fakeSandbox{screenshot: encoded}, &ComputerUseArgs{Action: "screenshot"})
	require.NoError(t, err)
	croppedBase64, ok := result["image_base64"].(string)
	require.True(t, ok)
	require.NotEqual(t, encoded, croppedBase64)

	croppedBytes, err := base64.StdEncoding.DecodeString(croppedBase64)
	require.NoError(t, err)
	croppedImage, _, err := image.Decode(bytes.NewReader(croppedBytes))
	require.NoError(t, err)
	assert.Equal(t, 6, croppedImage.Bounds().Dy())
	r, g, b, a := croppedImage.At(0, 0).RGBA()
	assert.Equal(t, uint32(0), r)
	assert.Equal(t, uint32(0), g)
	assert.Equal(t, uint32(0xffff), b)
	assert.Equal(t, uint32(0xffff), a)
}

func TestSanitizeComputerScreenshotBase64Fallbacks(t *testing.T) {
	assert.Equal(t, "not-base64", sanitizeComputerScreenshotBase64("not-base64"))

	encodedText := base64.StdEncoding.EncodeToString([]byte("not an image"))
	assert.Equal(t, encodedText, sanitizeComputerScreenshotBase64(encodedText))

	shortImage := image.NewRGBA(image.Rect(0, 0, 4, computerScreenshotChromeCropTopPX))
	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, shortImage))
	encodedShortImage := base64.StdEncoding.EncodeToString(buf.Bytes())
	assert.Equal(t, encodedShortImage, sanitizeComputerScreenshotBase64(encodedShortImage))

	cropped, ok := cropComputerScreenshotImage(image.NewUniform(color.Black), image.Rect(0, 0, 1, 1))
	assert.False(t, ok)
	assert.Nil(t, cropped)

	previousCrop := cropComputerScreenshotImage
	cropComputerScreenshotImage = func(image.Image, image.Rectangle) (image.Image, bool) {
		return nil, false
	}
	t.Cleanup(func() { cropComputerScreenshotImage = previousCrop })
	tallImage := image.NewRGBA(image.Rect(0, 0, 4, computerScreenshotChromeCropTopPX+1))
	buf.Reset()
	require.NoError(t, png.Encode(&buf, tallImage))
	encodedTallImage := base64.StdEncoding.EncodeToString(buf.Bytes())
	assert.Equal(t, encodedTallImage, sanitizeComputerScreenshotBase64(encodedTallImage))
	cropComputerScreenshotImage = previousCrop

	previousEncode := encodeComputerScreenshotPNG
	t.Cleanup(func() { encodeComputerScreenshotPNG = previousEncode })
	encodeComputerScreenshotPNG = func(io.Writer, image.Image) error {
		return fmt.Errorf("encode failed")
	}
	buf.Reset()
	require.NoError(t, previousEncode(&buf, tallImage))
	encodedTallImage = base64.StdEncoding.EncodeToString(buf.Bytes())
	assert.Equal(t, encodedTallImage, sanitizeComputerScreenshotBase64(encodedTallImage))
}

func TestComputerUseToolInvalidScrollDirection(t *testing.T) {
	tool := CreateComputerUseTool(&SandboxPool{authConfigured: true})

	result, err := tool.Execute(context.Background(), `{"action":"scroll","scroll_direction":"left"}`)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid arguments")
	assert.Nil(t, result)
}

func TestComputerUseToolAcquireStartAndActionFailures(t *testing.T) {
	t.Run("acquire failure", func(t *testing.T) {
		pool := &SandboxPool{
			authConfigured: true,
			maxPoolSize:    2,
			pools:          map[string][]sandboxSession{},
			factory:        &fakeFactory{createErr: fmt.Errorf("quota exceeded")},
		}
		tool := CreateComputerUseTool(pool)

		result, err := tool.Execute(context.Background(), `{"action":"screenshot"}`)

		require.Error(t, err)
		assert.Nil(t, result)
		assert.Contains(t, err.Error(), "failed to acquire sandbox: quota exceeded")
	})

	t.Run("start failure closes sandbox", func(t *testing.T) {
		closeCount := int32(0)
		sbx := &fakeSandbox{startErr: fmt.Errorf("desktop unavailable"), closeCount: &closeCount}
		pool := &SandboxPool{
			authConfigured: true,
			maxPoolSize:    2,
			pools:          map[string][]sandboxSession{},
			factory:        &fakeFactory{next: []*fakeSandbox{sbx}},
		}
		tool := CreateComputerUseTool(pool)

		result, err := tool.Execute(context.Background(), `{"action":"screenshot"}`)

		require.NoError(t, err)
		assert.Equal(t, false, result["success"])
		assert.Contains(t, result["errors"], "failed to start computer use: desktop unavailable")
		assert.Equal(t, int32(1), closeCount)
		assert.Contains(t, result, "timings_ms")
	})

	t.Run("action failure closes sandbox instead of reusing", func(t *testing.T) {
		closeCount := int32(0)
		x := 10
		y := 20
		sbx := &fakeSandbox{actionErr: fmt.Errorf("button blocked"), closeCount: &closeCount}
		pool := &SandboxPool{
			authConfigured: true,
			maxPoolSize:    2,
			pools:          map[string][]sandboxSession{makeSandboxPoolBucket(SandboxKindDesktop, "logged_out"): {sbx}},
		}
		tool := CreateComputerUseTool(pool)

		args := fmt.Sprintf(`{"action":"click","coordinate_x":%d,"coordinate_y":%d}`, x, y)
		result, err := tool.Execute(context.Background(), args)

		require.NoError(t, err)
		assert.Equal(t, false, result["success"])
		assert.Contains(t, result["errors"], "click failed: button blocked")
		assert.Equal(t, int32(1), closeCount)
		assert.Empty(t, pool.pools[makeSandboxPoolBucket(SandboxKindDesktop, "logged_out")])
	})
}

func TestComputerUseToolAppendsScreenshotForNonScreenshotActions(t *testing.T) {
	const screenshotBase64 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	sbx := &fakeSandbox{screenshot: screenshotBase64}
	bucket := makeSandboxPoolBucket(SandboxKindDesktop, "logged_out")
	pool := &SandboxPool{
		authConfigured: true,
		maxPoolSize:    2,
		pools:          map[string][]sandboxSession{bucket: {sbx}},
	}

	tool := CreateComputerUseTool(pool)
	result, err := tool.Execute(context.Background(), `{"action":"wait","duration":1}`)
	require.NoError(t, err)
	assert.Equal(t, true, result["success"])
	assert.Equal(t, "Waited 1ms", result["output"])
	assert.Equal(t, screenshotBase64, result["image_base64"])
	assert.NotContains(t, result, "screenshot_error")
	assert.Equal(t, int32(1), sbx.startCount)
}

func TestComputerUseToolAddsScreenshotErrorWhenAppendFails(t *testing.T) {
	sbx := &fakeSandbox{screenshotErr: fmt.Errorf("screenshot output too short")}
	bucket := makeSandboxPoolBucket(SandboxKindDesktop, "logged_out")
	pool := &SandboxPool{
		authConfigured: true,
		maxPoolSize:    2,
		pools:          map[string][]sandboxSession{bucket: {sbx}},
	}

	tool := CreateComputerUseTool(pool)
	result, err := tool.Execute(context.Background(), `{"action":"wait","duration":1}`)
	require.NoError(t, err)
	assert.Equal(t, true, result["success"])
	assert.Equal(t, "Waited 1ms", result["output"])
	assert.Contains(t, result["screenshot_error"], "screenshot output too short")
	assert.NotContains(t, result, "image_base64")
}

func TestComputerUseToolLoggedInProfileReuse(t *testing.T) {
	sbx := &fakeSandbox{screenshot: strings.Repeat("a", 120)}
	pool := &SandboxPool{
		authConfigured: true,
		maxPoolSize:    2,
		pools:          map[string][]sandboxSession{},
		factory:        &fakeFactory{next: []*fakeSandbox{sbx}},
	}

	ctx := WithComputerUseExecutionContext(context.Background(), ComputerUseExecutionContext{
		UseLoggedInServices: true,
		ProfileKey:          "acct-1",
	})
	tool := CreateComputerUseTool(pool)
	result, err := tool.Execute(ctx, `{"action":"screenshot"}`)
	require.NoError(t, err)
	assert.Equal(t, true, result["success"])
	assert.Len(t, pool.pools[makeSandboxPoolBucket(SandboxKindDesktop, "logged_in:acct-1")], 1)
}

func TestComputerUseToolProfileSelectionEdges(t *testing.T) {
	cases := []struct {
		name    string
		ctx     context.Context
		bucket  string
		payload string
	}{
		{
			name:    "logged in falls back to session scope",
			ctx:     WithComputerUseExecutionContext(context.Background(), ComputerUseExecutionContext{UseLoggedInServices: true, SessionID: "run-1"}),
			bucket:  makeSandboxPoolBucket(SandboxKindDesktop, "logged_in:run-1"),
			payload: `{"action":"screenshot"}`,
		},
		{
			name:    "logged in without scope",
			ctx:     WithComputerUseExecutionContext(context.Background(), ComputerUseExecutionContext{UseLoggedInServices: true}),
			bucket:  makeSandboxPoolBucket(SandboxKindDesktop, "logged_in"),
			payload: `{"action":"screenshot"}`,
		},
		{
			name:    "logged out session scope",
			ctx:     WithComputerUseExecutionContext(context.Background(), ComputerUseExecutionContext{SessionID: "run-2"}),
			bucket:  makeSandboxPoolBucket(SandboxKindDesktop, "logged_out:run-2"),
			payload: `{"action":"screenshot"}`,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			sbx := &fakeSandbox{screenshot: strings.Repeat("a", 120)}
			pool := &SandboxPool{
				authConfigured: true,
				maxPoolSize:    2,
				pools:          map[string][]sandboxSession{},
				factory:        &fakeFactory{next: []*fakeSandbox{sbx}},
			}
			tool := CreateComputerUseTool(pool)

			result, err := tool.Execute(tc.ctx, tc.payload)

			require.NoError(t, err)
			assert.Equal(t, true, result["success"])
			assert.Len(t, pool.pools[tc.bucket], 1)
		})
	}
}
