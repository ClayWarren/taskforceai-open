package filesystem

import (
	"io/fs"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/internal/filepolicy"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/internal/toolutil"
	"github.com/TaskForceAI/core/pkg/enginecore/util"
)

type fileEntry struct {
	path  string
	mtime time.Time
}

const globResultLimit = 100

var statGlobPath = func(path string) (fs.FileInfo, error) { return util.CurrentFileSystem().Stat(path) }
var walkGlobDir = func(root string, visit fs.WalkDirFunc) error { return util.CurrentFileSystem().WalkDir(root, visit) }
var relGlobPath = func(base, target string) (string, error) { return util.CurrentFileSystem().Rel(base, target) }

type globFileCollector struct {
	files  []fileEntry
	total  int
	sorted bool
}

func (c *globFileCollector) Add(file fileEntry) {
	c.total++
	if len(c.files) >= globResultLimit+1 {
		c.sort()
		if !file.mtime.After(c.files[len(c.files)-1].mtime) {
			return
		}
		c.trim(globResultLimit + 1)
	}
	c.files = append(c.files, file)
	c.sorted = false
}

func (c *globFileCollector) Files() ([]fileEntry, bool, int) {
	c.trim(globResultLimit + 1)
	return c.files, c.total > globResultLimit, c.total
}

func (c *globFileCollector) trim(limit int) {
	if len(c.files) <= limit {
		return
	}
	c.sort()
	c.files = c.files[:limit]
}

func (c *globFileCollector) sort() {
	if c.sorted {
		return
	}
	sortGlobFiles(c.files)
	c.sorted = true
}

func matchesGlobPattern(pattern, rel, base string) bool {
	if ok, matchErr := path.Match(pattern, base); matchErr == nil && ok {
		return true
	}
	if ok, matchErr := path.Match(pattern, rel); matchErr == nil && ok {
		return true
	}
	return false
}

func ExecuteGlob(ctx protocol.ToolContext, args map[string]any) protocol.ToolResult {
	state := toolutil.NewResult(args)
	parsed, missing := parseGlobArgs(args)
	if len(missing) > 0 {
		return toolutil.InvalidArgs("glob", args, missing...)
	}
	pathArg := parsed.path
	search := pathArg
	if search == "" {
		search = ctx.Cwd
	} else {
		search = filepath.Join(ctx.Cwd, search)
	}
	if _, err := statGlobPath(search); err != nil {
		state.Status = "error"
		state.Error = "Error: No such file or directory: '<cwd>/" + strings.TrimPrefix(strings.ReplaceAll(search, ctx.Cwd, "<cwd>"), "<cwd>/") + "'"
		state.Input = args
		return state
	}
	if err := filepolicy.Assert(ctx, search, &filepolicy.Options{Kind: filepolicy.Directory}); err != nil {
		state.Status = "error"
		state.Error = "Error: " + err.Error()
		return state
	}
	ignore := util.NewGitIgnoreChain(search)
	patterns := expandBrace(parsed.pattern)
	for i, pattern := range patterns {
		patterns[i] = filepath.ToSlash(pattern)
	}
	collector, walkErr := collectGlobFiles(ctx, search, ignore, patterns)
	if walkErr != nil {
		state.Status = "error"
		state.Error = "Error: " + walkErr.Error()
		return state
	}

	files, truncated, totalMatches := collector.Files()
	sortGlobFiles(files)
	if truncated {
		files = files[:globResultLimit]
	}

	state.Output = strings.ReplaceAll(strings.Join(globOutput(files, truncated), "\n"), ctx.Cwd, "<cwd>")
	state.Title = ""
	state.TitleSet = true
	if pathArg != "" && pathArg != "." {
		state.Title = pathArg
	}
	state.Metadata = map[string]any{"count": totalMatches, "shown": len(files), "truncated": truncated}
	return state
}

func collectGlobFiles(ctx protocol.ToolContext, search string, ignore *util.GitIgnoreChain, patterns []string) (globFileCollector, error) {
	collector := globFileCollector{}
	err := walkGlobDir(search, func(p string, d fs.DirEntry, err error) error {
		if err := toolutil.CheckContext(ctx); err != nil {
			return err
		}
		if err != nil {
			return err
		}
		if d.IsDir() {
			if util.ShouldSkipDir(d.Name()) {
				return filepath.SkipDir
			}
			if ignore != nil {
				if rel, relErr := relGlobPath(search, p); relErr == nil && ignore.Ignore(filepath.ToSlash(rel), true) {
					return filepath.SkipDir
				}
			}
			return nil
		}
		rel, relErr := relGlobPath(search, p)
		if relErr != nil {
			return relErr
		}
		slashRel := filepath.ToSlash(rel)
		if ignore != nil {
			if ignore.Ignore(slashRel, false) {
				return nil
			}
		}
		matched := false
		for _, pat := range patterns {
			if matchesGlobPattern(pat, slashRel, d.Name()) {
				matched = true
				break
			}
		}
		if !matched {
			return nil
		}
		info, statErr := d.Info()
		if statErr != nil {
			return statErr
		}
		collector.Add(fileEntry{path: p, mtime: info.ModTime()})
		return nil
	})
	return collector, err
}

func globOutput(files []fileEntry, truncated bool) []string {
	output := []string{}
	if len(files) == 0 {
		output = append(output, "No files found")
	} else {
		for _, f := range files {
			output = append(output, filepath.ToSlash(f.path))
		}
		if truncated {
			output = append(output, "", "(Results are truncated. Consider using a more specific path or pattern.)")
		}
	}
	return output
}

func sortGlobFiles(files []fileEntry) {
	sort.Slice(files, func(i, j int) bool {
		return files[i].mtime.After(files[j].mtime)
	})
}

func expandBrace(pattern string) []string {
	start := strings.Index(pattern, "{")
	end := strings.Index(pattern, "}")
	if start == -1 || end == -1 || end < start {
		return []string{pattern}
	}
	inner := pattern[start+1 : end]
	parts := strings.Split(inner, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		out = append(out, pattern[:start]+part+pattern[end+1:])
	}
	return out
}
