package util

import (
	"errors"
	"io/fs"
	"path/filepath"
	"strings"
)

var (
	absUtilPath      = func(path string) (string, error) { return CurrentFileSystem().Abs(path) }
	evalUtilSymlinks = func(path string) (string, error) { return CurrentFileSystem().EvalSymlinks(path) }
	lstatUtilPath    = func(path string) (fs.FileInfo, error) { return CurrentFileSystem().Lstat(path) }
	relUtilPath      = func(base, target string) (string, error) { return CurrentFileSystem().Rel(base, target) }
)

func ResolvePath(path string) (string, error) {
	abs, err := absUtilPath(path)
	if err != nil {
		return "", err
	}
	resolved, err := evalUtilSymlinks(abs)
	if err == nil {
		return filepath.Clean(resolved), nil
	}
	if !errors.Is(err, fs.ErrNotExist) {
		return "", err
	}
	current := abs
	suffix := []string{}
	for {
		if _, statErr := lstatUtilPath(current); statErr == nil {
			break
		}
		parent := filepath.Dir(current)
		if parent == current {
			return "", err
		}
		suffix = append([]string{filepath.Base(current)}, suffix...)
		current = parent
	}
	resolvedCurrent, resolveErr := evalUtilSymlinks(current)
	if resolveErr != nil {
		return "", resolveErr
	}
	rebuilt := resolvedCurrent
	for _, part := range suffix {
		rebuilt = filepath.Join(rebuilt, part)
	}
	return filepath.Clean(rebuilt), nil
}

func resolvePath(path string) (string, error) {
	return ResolvePath(path)
}

func ContainsPath(root, target string) bool {
	if root == "" || target == "" {
		return false
	}
	rootAbs, err := ResolvePath(root)
	if err != nil {
		return false
	}
	targetAbs := target
	if !filepath.IsAbs(target) {
		targetAbs = filepath.Join(rootAbs, target)
	}
	targetAbs, err = ResolvePath(targetAbs)
	if err != nil {
		return false
	}
	rel, err := relUtilPath(rootAbs, targetAbs)
	if err != nil {
		return false
	}
	if rel == "." {
		return true
	}
	if rel == ".." {
		return false
	}
	prefix := ".." + string(filepath.Separator)
	return !strings.HasPrefix(rel, prefix)
}

func containsPath(root, target string) bool {
	return ContainsPath(root, target)
}
