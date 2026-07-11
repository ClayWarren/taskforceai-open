package util

import (
	"errors"
	"io/fs"
	"log/slog"
	"path"
	"path/filepath"
	"strings"
)

type GitIgnore struct {
	rules []gitIgnoreRule
}

type GitIgnoreChain struct {
	root  string
	cache map[string]*GitIgnore
}

type gitIgnoreRule struct {
	pattern  string
	negate   bool
	dirOnly  bool
	anchored bool
}

func LoadGitIgnore(root string) *GitIgnore {
	if root == "" {
		return nil
	}
	data, err := CurrentFileSystem().ReadFile(filepath.Join(root, ".gitignore"))
	if err != nil {
		if errors.Is(err, ErrFileSystemUnavailable) {
			panic(err)
		}
		if !errors.Is(err, fs.ErrNotExist) {
			slog.Warn("Unable to read gitignore; ignore rules disabled for directory", "root", root, "error", err)
		}
		return nil
	}
	lines := strings.Split(string(data), "\n")
	rules := make([]gitIgnoreRule, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		negate := false
		if strings.HasPrefix(line, "!") {
			negate = true
			line = strings.TrimPrefix(line, "!")
		}
		if strings.HasPrefix(line, `\#`) || strings.HasPrefix(line, `\!`) {
			line = strings.TrimPrefix(line, `\`)
		}
		dirOnly := strings.HasSuffix(line, "/")
		if dirOnly {
			line = strings.TrimSuffix(line, "/")
		}
		anchored := strings.HasPrefix(line, "/")
		line = strings.TrimPrefix(line, "/")
		line = filepath.ToSlash(line)
		line = strings.ReplaceAll(line, "**", "*")
		if line == "" {
			continue
		}
		rules = append(rules, gitIgnoreRule{
			pattern:  line,
			negate:   negate,
			dirOnly:  dirOnly,
			anchored: anchored,
		})
	}
	if len(rules) == 0 {
		return nil
	}
	return &GitIgnore{rules: rules}
}

func (g *GitIgnore) Ignore(rel string, isDir bool) bool {
	return g.Apply(false, rel, isDir)
}

func (g *GitIgnore) Apply(ignored bool, rel string, isDir bool) bool {
	if g == nil {
		return ignored
	}
	rel = filepath.ToSlash(rel)
	rel = strings.TrimPrefix(rel, "./")
	if rel == "" {
		return ignored
	}
	for _, rule := range g.rules {
		if rule.dirOnly && !isDir {
			continue
		}
		if rule.anchored {
			if matchPattern(rule.pattern, rel) {
				ignored = !rule.negate
			}
			continue
		}
		if matchAnySegment(rule.pattern, rel) {
			ignored = !rule.negate
		}
	}
	return ignored
}

func NewGitIgnoreChain(root string) *GitIgnoreChain {
	if root == "" {
		return nil
	}
	return &GitIgnoreChain{
		root:  root,
		cache: map[string]*GitIgnore{},
	}
}

func (c *GitIgnoreChain) Ignore(rel string, isDir bool) bool {
	if c == nil {
		return false
	}
	rel = filepath.ToSlash(rel)
	rel = strings.TrimPrefix(rel, "./")
	if rel == "" {
		return false
	}
	parts := strings.Split(rel, "/")
	dirParts := parts
	if !isDir && len(parts) > 0 {
		dirParts = parts[:len(parts)-1]
	}
	ignored := false
	for i := 0; i <= len(dirParts); i++ {
		dirRel := strings.Join(dirParts[:i], "/")
		gi := c.load(dirRel)
		if gi == nil {
			continue
		}
		target := rel
		if dirRel != "" {
			prefix := dirRel + "/"
			if after, ok := strings.CutPrefix(rel, prefix); ok {
				target = after
			}
		}
		ignored = gi.Apply(ignored, target, isDir)
	}
	return ignored
}

func (c *GitIgnoreChain) load(dirRel string) *GitIgnore {
	if gi, ok := c.cache[dirRel]; ok {
		return gi
	}
	dir := filepath.Join(c.root, filepath.FromSlash(dirRel))
	gi := LoadGitIgnore(dir)
	c.cache[dirRel] = gi
	return gi
}

func matchPattern(pattern, target string) bool {
	ok, err := path.Match(pattern, target)
	if err != nil {
		return false
	}
	return ok
}

func matchAnySegment(pattern, rel string) bool {
	if matchPattern(pattern, rel) {
		return true
	}
	base := path.Base(rel)
	if matchPattern(pattern, base) {
		return true
	}
	parts := strings.Split(rel, "/")
	for i := range parts {
		if matchPattern(pattern, strings.Join(parts[i:], "/")) {
			return true
		}
	}
	return false
}
