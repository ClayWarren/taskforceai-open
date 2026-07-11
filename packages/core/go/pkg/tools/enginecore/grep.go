package tools

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io/fs"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/util"
)

type grepMatch struct {
	path    string
	modTime int64
	lineNum int
	line    string
}

const grepResultLimit = 100

var statGrepPath = func(path string) (fs.FileInfo, error) { return util.CurrentFileSystem().Stat(path) }
var collectGrepMatchesForTool = collectGrepMatches
var relGrepPath = func(base, target string) (string, error) { return util.CurrentFileSystem().Rel(base, target) }

type grepMatcher func([]byte) bool

type grepIncludeMatcher func(string) bool

type grepMatchCollector struct {
	matches []grepMatch
	total   int
}

func (c *grepMatchCollector) Add(path string, modTime int64, lineNum int, line []byte) {
	c.total++
	if len(c.matches) >= grepResultLimit+1 {
		c.trim()
		if modTime <= c.matches[len(c.matches)-1].modTime {
			return
		}
	}
	c.matches = append(c.matches, grepMatch{
		path:    path,
		modTime: modTime,
		lineNum: lineNum,
		line:    string(line),
	})
}

func (c *grepMatchCollector) CanSkipFile(modTime int64) bool {
	if len(c.matches) < grepResultLimit+1 {
		return false
	}
	c.trim()
	return c.total > grepResultLimit && modTime <= c.matches[len(c.matches)-1].modTime
}

func (c *grepMatchCollector) Matches() ([]grepMatch, bool) {
	c.trim()
	return c.matches, c.total > grepResultLimit
}

func (c *grepMatchCollector) trim() {
	limit := grepResultLimit + 1
	if len(c.matches) <= limit {
		return
	}
	sortGrepMatches(c.matches)
	c.matches = c.matches[:limit]
}

func toolGrep(ctx protocol.ToolContext, args map[string]any) ToolResult {
	state := NewToolResult(args)
	parsed, missing := parseGrepArgs(args)
	if len(missing) > 0 {
		return invalidArgs("grep", args, missing...)
	}
	pattern := parsed.pattern
	search := parsed.path
	if search == "" {
		search = ctx.Cwd
	} else {
		search = filepath.Join(ctx.Cwd, search)
	}
	if err := assertExternalDirectory(ctx, search, &externalDirectoryOptions{Kind: kindDirectory}); err != nil {
		state.Status = "error"
		state.Error = "Error: " + err.Error()
		return state
	}
	searchInfo, err := statGrepPath(search)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			state.Output = "No files found"
			state.Title = pattern
			state.TitleSet = true
			state.Metadata = map[string]any{
				"matches":   0,
				"truncated": false,
			}
			return state
		}
		state.Status = "error"
		state.Error = "Error: " + err.Error()
		return state
	}
	include := parsed.include
	if strings.Contains(include, "**") {
		return grepNoMatchesResult(state, pattern)
	}
	includeMatcher := newGrepIncludeMatcher(include, search)

	re, err := compileGrepRegex(ctx, pattern)
	if err != nil {
		state.Status = "error"
		state.Error = "Error: " + err.Error()
		return state
	}

	matches, truncated, walkErr := collectGrepMatchesForTool(ctx, search, searchInfo, includeMatcher, re)
	if walkErr != nil {
		if err := checkContext(ctx); err != nil {
			state.Status = "error"
			state.Error = "Error: " + err.Error()
			return state
		}
		state.Status = "error"
		state.Error = "Error: " + walkErr.Error()
		return state
	}

	if len(matches) == 0 {
		return grepNoMatchesResult(state, pattern)
	}

	output, matchCount, truncated := formatGrepMatches(matches, ctx.Cwd, truncated)
	state.Output = output
	state.Title = pattern
	state.TitleSet = true
	state.Metadata = map[string]any{
		"matches":   matchCount,
		"truncated": truncated,
	}
	return state
}

func grepNoMatchesResult(state ToolResult, pattern string) ToolResult {
	state.Output = "No files found"
	state.Title = pattern
	state.TitleSet = true
	state.Metadata = map[string]any{
		"matches":   0,
		"truncated": false,
	}
	return state
}

func compileGrepRegex(ctx protocol.ToolContext, pattern string) (*regexp.Regexp, error) {
	regexCtx, regexCancel := context.WithTimeout(ctx.Ctx, 5*time.Second)
	defer regexCancel()

	type regexResult struct {
		re  *regexp.Regexp
		err error
	}
	rCh := make(chan regexResult, 1)
	go func() {
		r, e := regexp.Compile(pattern)
		rCh <- regexResult{r, e}
	}()

	select {
	case <-regexCtx.Done():
		return nil, fmt.Errorf("regex compilation timed out")
	case result := <-rCh:
		if result.err != nil {
			return nil, fmt.Errorf("invalid regex: %w", result.err)
		}
		return result.re, nil
	}
}

func newGrepMatcher(re *regexp.Regexp) grepMatcher {
	prefix, complete := re.LiteralPrefix()
	if complete && prefix != "" {
		needle := []byte(prefix)
		return func(line []byte) bool {
			return bytes.Contains(line, needle)
		}
	}
	return re.Match
}

func collectGrepMatches(ctx protocol.ToolContext, search string, searchInfo fs.FileInfo, include grepIncludeMatcher, re *regexp.Regexp) ([]grepMatch, bool, error) {
	rootPath := grepRootPath(search, searchInfo)

	matches := grepMatchCollector{}
	ignore := util.NewGitIgnoreChain(search)
	matcher := newGrepMatcher(re)
	walkErr := util.CurrentFileSystem().WalkDir(search, func(p string, d fs.DirEntry, err error) error {
		return visitGrepPath(ctx, grepVisitInput{
			search:   search,
			rootPath: rootPath,
			include:  include,
			matcher:  matcher,
			ignore:   ignore,
			matches:  &matches,
		}, p, d, err)
	})
	collected, truncated := matches.Matches()
	return collected, truncated, walkErr
}

type grepVisitInput struct {
	search   string
	rootPath string
	include  grepIncludeMatcher
	matcher  grepMatcher
	ignore   *util.GitIgnoreChain
	matches  *grepMatchCollector
}

func visitGrepPath(ctx protocol.ToolContext, input grepVisitInput, p string, d fs.DirEntry, err error) error {
	if err := checkContext(ctx); err != nil {
		return err
	}
	if err != nil {
		return err
	}
	if d.IsDir() {
		return handleGrepDir(input.ignore, input.search, p, d)
	}
	if shouldSkipGrepFile(input.ignore, input.search, input.include, p) {
		return nil
	}
	return appendFileMatches(input, p, d)
}

func grepRootPath(search string, searchInfo fs.FileInfo) string {
	if searchInfo.IsDir() {
		return search
	}
	return filepath.Dir(search)
}

func handleGrepDir(ignore *util.GitIgnoreChain, search, path string, d fs.DirEntry) error {
	if util.ShouldSkipDir(d.Name()) {
		return filepath.SkipDir
	}
	if ignore != nil {
		if rel, relErr := filepath.Rel(search, path); relErr == nil && ignore.Ignore(rel, true) {
			return filepath.SkipDir
		}
	}
	return nil
}

func shouldSkipGrepFile(ignore *util.GitIgnoreChain, search string, include grepIncludeMatcher, path string) bool {
	if ignore != nil {
		if rel, relErr := filepath.Rel(search, path); relErr == nil && ignore.Ignore(rel, false) {
			return true
		}
	}
	return include != nil && !include(path)
}

func newGrepIncludeMatcher(include, root string) grepIncludeMatcher {
	if include == "" {
		return nil
	}
	if !strings.ContainsAny(filepath.ToSlash(include), `/\`) {
		return func(path string) bool {
			ok, err := filepath.Match(include, filepath.Base(path))
			return err == nil && ok
		}
	}
	return func(path string) bool {
		return matchesGlob(include, path, root)
	}
}

func appendFileMatches(input grepVisitInput, path string, d fs.DirEntry) error {
	relPath, relErr := relGrepPath(input.rootPath, path)
	if relErr != nil {
		return relErr
	}
	info, statErr := d.Info()
	if statErr != nil {
		return statErr
	}
	modTime := info.ModTime().UnixMilli()
	data, readErr := util.CurrentFileSystem().ReadFileWithin(input.rootPath, relPath)
	if readErr != nil {
		return readErr
	}
	if input.matches.CanSkipFile(modTime) {
		return nil
	}
	scanGrepLines(data, func(lineNum int, line []byte) {
		if input.matcher(line) {
			input.matches.Add(path, modTime, lineNum, line)
		}
	})
	return nil
}

func scanGrepLines(data []byte, visit func(lineNum int, line []byte)) {
	if len(data) == 0 {
		visit(1, nil)
		return
	}

	lineNum := 1
	for start := 0; start < len(data); {
		next := bytes.IndexByte(data[start:], '\n')
		if next < 0 {
			visit(lineNum, trimGrepCarriageReturn(data[start:]))
			return
		}

		end := start + next
		visit(lineNum, trimGrepCarriageReturn(data[start:end]))
		lineNum++
		start = end + 1
		if start == len(data) {
			visit(lineNum, nil)
			return
		}
	}
}

func trimGrepCarriageReturn(line []byte) []byte {
	if len(line) > 0 && line[len(line)-1] == '\r' {
		return line[:len(line)-1]
	}
	return line
}

func formatGrepMatches(matches []grepMatch, cwd string, alreadyTruncated bool) (string, int, bool) {
	sortGrepMatches(matches)
	truncated := alreadyTruncated || len(matches) > grepResultLimit
	finalMatches := matches
	if truncated {
		finalMatches = matches[:grepResultLimit]
	}

	outputLines := grepOutputLines(finalMatches, truncated)
	return strings.ReplaceAll(strings.Join(outputLines, "\n"), cwd, "<cwd>"), len(finalMatches), truncated
}

func sortGrepMatches(matches []grepMatch) {
	sort.Slice(matches, func(i, j int) bool {
		return matches[i].modTime > matches[j].modTime
	})
}

func grepOutputLines(matches []grepMatch, truncated bool) []string {
	outputLines := []string{fmt.Sprintf("Found %d matches", len(matches))}
	currentFile := ""
	for _, match := range matches {
		if currentFile != match.path {
			if currentFile != "" {
				outputLines = append(outputLines, "")
			}
			currentFile = match.path
			outputLines = append(outputLines, filepath.ToSlash(match.path)+":")
		}
		outputLines = append(outputLines, fmt.Sprintf("  Line %d: %s", match.lineNum, truncateGrepLine(match.line)))
	}
	if truncated {
		outputLines = append(outputLines, "", "(Results are truncated. Consider using a more specific path or pattern.)")
	}
	return outputLines
}

func truncateGrepLine(line string) string {
	if len(line) > 2000 {
		return line[:2000] + "..."
	}
	return line
}

func splitLines(text string) []string {
	if text == "" {
		return []string{""}
	}
	text = strings.ReplaceAll(text, "\r\n", "\n")
	return strings.Split(text, "\n")
}

func matchesGlob(glob, path, root string) bool {
	rel := path
	if root != "" {
		if r, err := filepath.Rel(root, path); err == nil {
			rel = r
		}
	}
	rel = filepath.ToSlash(rel)
	base := filepath.Base(path)
	if ok, matchErr := filepath.Match(glob, base); matchErr == nil && ok {
		return true
	}
	if ok, matchErr := filepath.Match(glob, rel); matchErr == nil && ok {
		return true
	}
	return false
}
