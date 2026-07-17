package enginecoreadapter

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	coretools "github.com/TaskForceAI/core/pkg/tools"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEnginecoreFileToolRuntimeCreatesGeneratedWorkspace(t *testing.T) {
	runtime := enginecoreFileToolRuntime{}

	dir := runtime.NewGeneratedFileWorkspace()

	require.NotEmpty(t, dir)
	info, err := os.Stat(dir)
	require.NoError(t, err)
	assert.True(t, info.IsDir())
	assert.Contains(t, dir, filepath.Join(os.TempDir(), "taskforceai-generated-files"))
}

func TestEnginecoreFileToolRuntimeWorkspaceFallbacks(t *testing.T) {
	originalMkdirAll := mkdirAllGeneratedFileWorkspace
	originalMkdirTemp := mkdirTempGeneratedFileWorkspace
	t.Cleanup(func() {
		mkdirAllGeneratedFileWorkspace = originalMkdirAll
		mkdirTempGeneratedFileWorkspace = originalMkdirTemp
	})

	mkdirAllGeneratedFileWorkspace = func(string, os.FileMode) error {
		return errors.New("mkdir failed")
	}
	dir := (enginecoreFileToolRuntime{}).NewGeneratedFileWorkspace()
	assert.NotEmpty(t, dir)

	mkdirTempGeneratedFileWorkspace = func(string, string) (string, error) {
		return "", errors.New("temp failed")
	}
	assert.Equal(t, os.TempDir(), (enginecoreFileToolRuntime{}).NewGeneratedFileWorkspace())
}

func TestEnginecoreFileToolRuntimeResolvesGeneratedArtifact(t *testing.T) {
	dir := t.TempDir()
	filePath := filepath.Join("exports", "chart.png")
	fullPath := filepath.Join(dir, filePath)
	require.NoError(t, os.MkdirAll(filepath.Dir(fullPath), 0o750))
	require.NoError(t, os.WriteFile(fullPath, []byte("png bytes"), 0o600))

	artifact, ok := (enginecoreFileToolRuntime{}).ResolveGeneratedFileArtifact(coretools.GeneratedFileArtifactRequest{
		Cwd:          dir,
		Filepath:     filePath,
		ToolName:     "create_chart",
		MimeType:     "image/png",
		IncludeImage: true,
	})

	require.True(t, ok)
	assert.Equal(t, "chart.png", artifact.Filename)
	assert.Equal(t, filePath, artifact.Filepath)
	assert.Equal(t, "image/png", artifact.MimeType)
	assert.Equal(t, int64(len("png bytes")), artifact.Bytes)
	assert.Equal(t, fullPath, artifact.LocalPath)
	assert.NotEmpty(t, artifact.ImageBase64)
}

func TestEnginecoreFileToolRuntimeResolvesGeneratedArtifactWithDefaultCwd(t *testing.T) {
	dir := t.TempDir()
	t.Chdir(dir)
	require.NoError(t, os.WriteFile("report.txt", []byte("report"), 0o600))

	artifact, ok := (enginecoreFileToolRuntime{}).ResolveGeneratedFileArtifact(coretools.GeneratedFileArtifactRequest{
		Filepath: "report.txt",
		MimeType: "text/plain",
	})

	require.True(t, ok)
	assert.Equal(t, "report.txt", artifact.Filename)
	assert.Equal(t, int64(len("report")), artifact.Bytes)
}

func TestEnginecoreFileToolRuntimeRejectsUnsafeGeneratedArtifactPaths(t *testing.T) {
	runtime := enginecoreFileToolRuntime{}
	dir := t.TempDir()

	for _, filePath := range []string{"", " report.csv", "report.csv ", "/tmp/report.csv", "../report.csv"} {
		t.Run(filePath, func(t *testing.T) {
			_, ok := runtime.ResolveGeneratedFileArtifact(coretools.GeneratedFileArtifactRequest{
				Cwd:      dir,
				Filepath: filePath,
				MimeType: "text/csv",
			})
			assert.False(t, ok)
		})
	}
}

func TestEnginecoreFileToolRuntimeRejectsDefaultCwdError(t *testing.T) {
	originalGetwd := getGeneratedFileWorkingDir
	t.Cleanup(func() { getGeneratedFileWorkingDir = originalGetwd })
	getGeneratedFileWorkingDir = func() (string, error) {
		return "", errors.New("getwd failed")
	}

	_, ok := (enginecoreFileToolRuntime{}).ResolveGeneratedFileArtifact(coretools.GeneratedFileArtifactRequest{
		Filepath: "report.txt",
	})
	assert.False(t, ok)
}

func TestEnginecoreFileToolRuntimeRejectsFullPathResolutionFailure(t *testing.T) {
	originalRel := relGeneratedFileRuntimePath
	t.Cleanup(func() { relGeneratedFileRuntimePath = originalRel })
	relGeneratedFileRuntimePath = func(string, string) (string, error) {
		return "..", nil
	}

	_, ok := (enginecoreFileToolRuntime{}).ResolveGeneratedFileArtifact(coretools.GeneratedFileArtifactRequest{
		Cwd:      t.TempDir(),
		Filepath: "report.txt",
	})
	assert.False(t, ok)
}

func TestEnginecoreFileToolRuntimeRejectsSymlinkDirectoryAndOutsidePath(t *testing.T) {
	runtime := enginecoreFileToolRuntime{}
	dir := t.TempDir()
	outside := filepath.Join(t.TempDir(), "secret.csv")
	require.NoError(t, os.WriteFile(outside, []byte("secret"), 0o600))

	linkPath := filepath.Join(dir, "export.csv")
	require.NoError(t, os.Symlink(outside, linkPath))
	_, ok := runtime.ResolveGeneratedFileArtifact(coretools.GeneratedFileArtifactRequest{
		Cwd:      dir,
		Filepath: "export.csv",
		MimeType: "text/csv",
	})
	assert.False(t, ok)

	require.NoError(t, os.Mkdir(filepath.Join(dir, "exports"), 0o750))
	_, ok = runtime.ResolveGeneratedFileArtifact(coretools.GeneratedFileArtifactRequest{
		Cwd:      dir,
		Filepath: "exports",
		MimeType: "text/csv",
	})
	assert.False(t, ok)

	relOutside, err := filepath.Rel(dir, outside)
	require.NoError(t, err)
	require.True(t, strings.HasPrefix(relOutside, ".."))
	_, ok = runtime.ResolveGeneratedFileArtifact(coretools.GeneratedFileArtifactRequest{
		Cwd:      dir,
		Filepath: relOutside,
		MimeType: "text/csv",
	})
	assert.False(t, ok)
}

func TestEnginecoreFileToolRuntimeFullPathFallbacks(t *testing.T) {
	fullPath, ok := generatedFileRuntimeFullPath(t.TempDir(), "nested/report.csv")
	require.True(t, ok)
	assert.True(t, filepath.IsAbs(fullPath))
	assert.True(t, strings.HasSuffix(fullPath, filepath.Join("nested", "report.csv")))

	_, ok = generatedFileRuntimeFullPath(t.TempDir(), "../report.csv")
	assert.False(t, ok)

	originalAbs := absGeneratedFileRuntimePath
	originalRel := relGeneratedFileRuntimePath
	t.Cleanup(func() {
		absGeneratedFileRuntimePath = originalAbs
		relGeneratedFileRuntimePath = originalRel
	})
	absGeneratedFileRuntimePath = func(path string) (string, error) {
		return "", errors.New("abs failed")
	}
	_, ok = generatedFileRuntimeFullPath(t.TempDir(), "report.csv")
	assert.False(t, ok)

	calls := 0
	absGeneratedFileRuntimePath = func(path string) (string, error) {
		calls++
		if calls == 2 {
			return "", errors.New("join abs failed")
		}
		return filepath.Clean(path), nil
	}
	_, ok = generatedFileRuntimeFullPath(t.TempDir(), "report.csv")
	assert.False(t, ok)

	absGeneratedFileRuntimePath = originalAbs
	relGeneratedFileRuntimePath = func(string, string) (string, error) {
		return "", errors.New("rel failed")
	}
	_, ok = generatedFileRuntimeFullPath(t.TempDir(), "report.csv")
	assert.False(t, ok)
}

func TestEnginecoreFileToolRuntimeSafeInfoErrors(t *testing.T) {
	dir := t.TempDir()

	_, err := safeGeneratedFileRuntimeInfo(dir, filepath.Join(dir, "missing.txt"))
	require.Error(t, err)

	filePath := filepath.Join(dir, "report.txt")
	require.NoError(t, os.WriteFile(filePath, []byte("report"), 0o600))
	_, err = safeGeneratedFileRuntimeInfo(filepath.Join(dir, "missing-cwd"), filePath)
	require.Error(t, err)

	brokenLink := filepath.Join(dir, "broken-link")
	require.NoError(t, os.Symlink(filepath.Join(dir, "missing-target"), brokenLink))
	_, err = safeGeneratedFileRuntimeInfo(dir, brokenLink)
	require.ErrorIs(t, err, os.ErrPermission)

	originalEval := evalGeneratedFileRuntimeSymlink
	originalRel := relGeneratedFileRuntimePath
	t.Cleanup(func() {
		evalGeneratedFileRuntimeSymlink = originalEval
		relGeneratedFileRuntimePath = originalRel
	})
	evalCalls := 0
	evalGeneratedFileRuntimeSymlink = func(path string) (string, error) {
		evalCalls++
		if evalCalls == 2 {
			return "", errors.New("path eval failed")
		}
		return path, nil
	}
	_, err = safeGeneratedFileRuntimeInfo(dir, filePath)
	require.ErrorContains(t, err, "path eval failed")

	evalGeneratedFileRuntimeSymlink = originalEval
	relGeneratedFileRuntimePath = func(string, string) (string, error) {
		return "", errors.New("rel failed")
	}
	_, err = safeGeneratedFileRuntimeInfo(dir, filePath)
	require.ErrorIs(t, err, os.ErrPermission)
}
