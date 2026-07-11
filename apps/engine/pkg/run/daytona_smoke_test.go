//go:build daytona_smoke

package run

import (
	"context"
	"encoding/base64"
	"os"
	"strings"
	"testing"
	"time"

	coretools "github.com/TaskForceAI/core/pkg/tools"
)

const daytonaSmokeTimeout = 3 * time.Minute

func TestDaytonaComputerUseSmoke(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), daytonaSmokeTimeout)
	defer cancel()

	pool := newDaytonaSandboxPoolFromEnv()
	defer pool.Close(context.Background())

	tool := coretools.CreateComputerUseTool(pool)
	result, err := tool.Execute(ctx, `{"action":"screenshot"}`)
	if err != nil {
		t.Fatalf("computer_use screenshot failed: %v", err)
	}
	if result["success"] != true {
		t.Fatalf("computer_use screenshot returned failure: %v", result["errors"])
	}

	image, ok := result["image_base64"].(string)
	if !ok || strings.TrimSpace(image) == "" {
		t.Fatalf("computer_use screenshot did not return image_base64")
	}
	if comma := strings.IndexByte(image, ','); comma >= 0 {
		image = image[comma+1:]
	}
	decoded, err := base64.StdEncoding.DecodeString(image)
	if err != nil {
		t.Fatalf("computer_use screenshot was not valid base64: %v", err)
	}
	if len(decoded) < 1024 {
		t.Fatalf("computer_use screenshot was unexpectedly small: %d bytes", len(decoded))
	}

	if path := os.Getenv("DAYTONA_SMOKE_SCREENSHOT"); path != "" {
		if err := os.WriteFile(path, decoded, 0o600); err != nil {
			t.Fatalf("write screenshot: %v", err)
		}
	}
	t.Logf("computer_use screenshot captured: %d bytes", len(decoded))
}

func TestDaytonaCodeExecutionSmoke(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), daytonaSmokeTimeout)
	defer cancel()

	pool := newDaytonaSandboxPoolFromEnv()
	defer pool.Close(context.Background())

	tool := coretools.CreateCodeExecutionTool(pool)
	result, err := tool.Execute(ctx, `{
		"language": "python",
		"code": "import platform\nprint('daytona-code-ok')\nprint(platform.python_version())",
		"timeout": 10000
	}`)
	if err != nil {
		t.Fatalf("execute_code failed: %v", err)
	}
	if result["success"] != true {
		t.Fatalf("execute_code returned failure: %v", result["errors"])
	}

	output, ok := result["output"].(string)
	if !ok {
		t.Fatalf("execute_code output was not a string: %T", result["output"])
	}
	if !hasLine(output, "daytona-code-ok") {
		t.Fatalf("execute_code output missing sentinel: %q", output)
	}
	t.Logf("execute_code output: %s", output)
}

func hasLine(output, expected string) bool {
	for line := range strings.Lines(output) {
		if strings.TrimSuffix(line, "\n") == expected {
			return true
		}
	}
	return false
}
