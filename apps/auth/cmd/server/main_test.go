package main

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"testing"
)

func TestMainOpenAPIOutput(t *testing.T) {
	oldArgs := os.Args
	oldStdout := os.Stdout
	defer func() {
		os.Args = oldArgs
		os.Stdout = oldStdout
	}()

	os.Args = []string{"server", "--openapi"}

	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatalf("pipe error: %v", err)
	}
	os.Stdout = writer

	main()

	_ = writer.Close()
	var buf bytes.Buffer
	_, _ = io.Copy(&buf, reader)
	_ = reader.Close()

	if buf.Len() == 0 {
		t.Fatal("expected openapi output")
	}

	var payload map[string]any
	if err := json.Unmarshal(buf.Bytes(), &payload); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if _, ok := payload["openapi"]; !ok {
		t.Fatal("expected openapi field in output")
	}
}
