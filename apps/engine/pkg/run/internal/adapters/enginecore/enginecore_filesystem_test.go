package enginecoreadapter

import (
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

func TestEnginecoreOSFileSystemReadFileLimit(t *testing.T) {
	path := filepath.Join(t.TempDir(), "limited.txt")
	if err := os.WriteFile(path, []byte("abcdef"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	tests := []struct {
		name          string
		limit         int64
		wantData      string
		wantTruncated bool
	}{
		{name: "below limit", limit: 8, wantData: "abcdef"},
		{name: "exact limit", limit: 6, wantData: "abcdef"},
		{name: "over limit", limit: 3, wantData: "abc", wantTruncated: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			data, truncated, err := (enginecoreOSFileSystem{}).ReadFileLimit(path, test.limit)
			if err != nil {
				t.Fatalf("ReadFileLimit: %v", err)
			}
			if string(data) != test.wantData || truncated != test.wantTruncated {
				t.Fatalf(
					"ReadFileLimit = %q, %v; want %q, %v",
					data,
					truncated,
					test.wantData,
					test.wantTruncated,
				)
			}
		})
	}

	data, truncated, err := (enginecoreOSFileSystem{}).ReadFileLimit(path+".missing", 3)
	if err == nil || data != nil || truncated {
		t.Fatalf("missing ReadFileLimit = %q, %v, %v; want nil, false, error", data, truncated, err)
	}
}

func TestEnginecoreOSFileSystemOperations(t *testing.T) {
	adapter := enginecoreOSFileSystem{}
	root := t.TempDir()
	nested := filepath.Join(root, "nested")
	if err := adapter.MkdirAll(nested, 0o700); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	path := filepath.Join(nested, "file.txt")
	if err := adapter.WriteFile(path, []byte("payload"), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	data, err := adapter.ReadFile(path)
	if err != nil || string(data) != "payload" {
		t.Fatalf("ReadFile = %q, %v", data, err)
	}
	entries, err := adapter.ReadDir(nested)
	if err != nil || len(entries) != 1 {
		t.Fatalf("ReadDir = %#v, %v", entries, err)
	}
	within, err := adapter.ReadFileWithin(root, filepath.Join("nested", "file.txt"))
	if err != nil || string(within) != "payload" {
		t.Fatalf("ReadFileWithin = %q, %v", within, err)
	}
	if _, err := adapter.ReadFileWithin(filepath.Join(root, "missing"), "file.txt"); err == nil {
		t.Fatal("expected missing root error")
	}
	if _, err := adapter.Stat(path); err != nil {
		t.Fatalf("Stat: %v", err)
	}
	if _, err := adapter.Lstat(path); err != nil {
		t.Fatalf("Lstat: %v", err)
	}
	abs, err := adapter.Abs(path)
	if err != nil || !filepath.IsAbs(abs) {
		t.Fatalf("Abs = %q, %v", abs, err)
	}
	resolved, err := adapter.EvalSymlinks(path)
	if err != nil || resolved == "" {
		t.Fatalf("EvalSymlinks = %q, %v", resolved, err)
	}
	relative, err := adapter.Rel(root, path)
	if err != nil || relative != filepath.Join("nested", "file.txt") {
		t.Fatalf("Rel = %q, %v", relative, err)
	}
	visited := 0
	if err := adapter.WalkDir(root, func(_ string, _ fs.DirEntry, err error) error {
		if err == nil {
			visited++
		}
		return err
	}); err != nil || visited < 3 {
		t.Fatalf("WalkDir visited %d: %v", visited, err)
	}
	renamed := filepath.Join(nested, "renamed.txt")
	if err := adapter.Rename(path, renamed); err != nil {
		t.Fatalf("Rename: %v", err)
	}
	if err := adapter.Remove(renamed); err != nil {
		t.Fatalf("Remove: %v", err)
	}

	_, _, err = adapter.ReadFileLimit(nested, 8)
	if err == nil {
		t.Fatal("expected directory read error")
	}
}
