package enginecoreadapter

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"

	coretools "github.com/TaskForceAI/core/pkg/tools"
)

type enginecoreFileToolRuntime struct{}

var (
	mkdirAllGeneratedFileWorkspace  = os.MkdirAll
	mkdirTempGeneratedFileWorkspace = os.MkdirTemp
	getGeneratedFileWorkingDir      = os.Getwd
	absGeneratedFileRuntimePath     = filepath.Abs
	relGeneratedFileRuntimePath     = filepath.Rel
	evalGeneratedFileRuntimeSymlink = filepath.EvalSymlinks
)

func (enginecoreFileToolRuntime) NewGeneratedFileWorkspace() string {
	baseDir := filepath.Join(os.TempDir(), "taskforceai-generated-files")
	if err := mkdirAllGeneratedFileWorkspace(baseDir, 0o750); err != nil {
		baseDir = os.TempDir()
	}
	dir, err := mkdirTempGeneratedFileWorkspace(baseDir, "run-*")
	if err != nil {
		return os.TempDir()
	}
	return dir
}

func (enginecoreFileToolRuntime) ResolveGeneratedFileArtifact(request coretools.GeneratedFileArtifactRequest) (coretools.GeneratedFileArtifact, bool) {
	cleanPath := cleanGeneratedFileRuntimePath(request.Filepath)
	if cleanPath == "" {
		return coretools.GeneratedFileArtifact{}, false
	}
	cwd := request.Cwd
	if strings.TrimSpace(cwd) == "" {
		var err error
		cwd, err = getGeneratedFileWorkingDir()
		if err != nil {
			return coretools.GeneratedFileArtifact{}, false
		}
	}
	fullPath, ok := generatedFileRuntimeFullPath(cwd, cleanPath)
	if !ok {
		return coretools.GeneratedFileArtifact{}, false
	}
	info, err := safeGeneratedFileRuntimeInfo(cwd, fullPath)
	if err != nil || info.IsDir() {
		return coretools.GeneratedFileArtifact{}, false
	}

	artifact := coretools.GeneratedFileArtifact{
		Filename:  filepath.Base(cleanPath),
		Filepath:  cleanPath,
		MimeType:  request.MimeType,
		Bytes:     info.Size(),
		LocalPath: fullPath,
	}
	if request.IncludeImage {
		data, err := os.ReadFile(fullPath) // #nosec G304 -- path is resolved under the generated-file workspace and symlinks are rejected.
		if err == nil {
			artifact.ImageBase64 = base64.StdEncoding.EncodeToString(data)
		}
	}
	return artifact, true
}

func cleanGeneratedFileRuntimePath(value string) string {
	if value == "" || value != strings.TrimSpace(value) || filepath.IsAbs(value) {
		return ""
	}
	clean := filepath.Clean(value)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return ""
	}
	return clean
}

func generatedFileRuntimeFullPath(cwd string, filePath string) (string, bool) {
	absCwd, err := absGeneratedFileRuntimePath(cwd)
	if err != nil {
		return "", false
	}
	fullPath, err := absGeneratedFileRuntimePath(filepath.Join(absCwd, filePath))
	if err != nil {
		return "", false
	}
	rel, err := relGeneratedFileRuntimePath(absCwd, fullPath)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return "", false
	}
	return fullPath, true
}

func safeGeneratedFileRuntimeInfo(cwd string, fullPath string) (os.FileInfo, error) {
	info, err := os.Lstat(fullPath)
	if err != nil {
		return nil, err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return nil, os.ErrPermission
	}
	resolvedCwd, err := evalGeneratedFileRuntimeSymlink(cwd)
	if err != nil {
		return nil, err
	}
	resolvedPath, err := evalGeneratedFileRuntimeSymlink(fullPath)
	if err != nil {
		return nil, err
	}
	rel, err := relGeneratedFileRuntimePath(resolvedCwd, resolvedPath)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return nil, os.ErrPermission
	}
	return info, nil
}
