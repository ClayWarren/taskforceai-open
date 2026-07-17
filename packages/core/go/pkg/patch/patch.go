// Package patch parses and applies the Begin/End Patch envelope format
// (the same grammar opencode and codex converge on) against an in-memory
// line slice. It has no filesystem dependency, so any caller - local disk,
// a remote sandbox, anything else - supplies its own I/O around it.
package patch

import (
	"fmt"
	"sort"
	"strings"
)

type OpKind string

const (
	Add    OpKind = "add"
	Delete OpKind = "delete"
	Update OpKind = "update"
)

type Line struct {
	Kind byte // ' ', '-', '+'
	Text string
}

type Hunk struct {
	Lines     []Line
	EndOfFile bool
}

// SplitOldNew splits a hunk's lines into the content expected to already
// exist (context + removed lines) and the content that should replace it
// (context + added lines).
func (h Hunk) SplitOldNew() ([]string, []string) {
	var oldLines, newLines []string
	for _, l := range h.Lines {
		switch l.Kind {
		case ' ':
			oldLines = append(oldLines, l.Text)
			newLines = append(newLines, l.Text)
		case '-':
			oldLines = append(oldLines, l.Text)
		case '+':
			newLines = append(newLines, l.Text)
		}
	}
	return oldLines, newLines
}

type Op struct {
	Kind     OpKind
	Path     string
	MoveTo   string
	AddLines []string
	Hunks    []Hunk
}

const (
	beginPatchMarker  = "*** Begin Patch"
	endPatchMarker    = "*** End Patch"
	addFileMarker     = "*** Add File: "
	deleteFileMarker  = "*** Delete File: "
	updateFileMarker  = "*** Update File: "
	moveToMarker      = "*** Move to: "
	endOfFileMarker   = "*** End of File"
	hunkContextMarker = "@@"
)

// Parse tolerates surrounding text (e.g. a heredoc wrapper some models emit)
// by locating the Begin/End markers rather than requiring an exact
// whole-string match.
func Parse(text string) ([]Op, error) {
	beginIdx := strings.Index(text, beginPatchMarker)
	if beginIdx == -1 {
		return nil, fmt.Errorf("invalid patch: missing %q", beginPatchMarker)
	}
	endIdx := strings.Index(text[beginIdx:], endPatchMarker)
	if endIdx == -1 {
		return nil, fmt.Errorf("invalid patch: missing %q", endPatchMarker)
	}
	body := text[beginIdx+len(beginPatchMarker) : beginIdx+endIdx]
	lines := strings.Split(strings.Trim(body, "\n"), "\n")
	if len(lines) == 1 && lines[0] == "" {
		return nil, nil
	}

	var ops []Op
	i := 0
	for i < len(lines) {
		line := lines[i]
		switch {
		case strings.HasPrefix(line, addFileMarker):
			path := strings.TrimSpace(strings.TrimPrefix(line, addFileMarker))
			i++
			var content []string
			for i < len(lines) && !isPatchHeader(lines[i]) {
				if !strings.HasPrefix(lines[i], "+") {
					return nil, fmt.Errorf("invalid patch: expected '+' line in Add File %s, got %q", path, lines[i])
				}
				content = append(content, strings.TrimPrefix(lines[i], "+"))
				i++
			}
			ops = append(ops, Op{Kind: Add, Path: path, AddLines: content})
		case strings.HasPrefix(line, deleteFileMarker):
			path := strings.TrimSpace(strings.TrimPrefix(line, deleteFileMarker))
			i++
			ops = append(ops, Op{Kind: Delete, Path: path})
		case strings.HasPrefix(line, updateFileMarker):
			path := strings.TrimSpace(strings.TrimPrefix(line, updateFileMarker))
			i++
			moveTo := ""
			if i < len(lines) && strings.HasPrefix(lines[i], moveToMarker) {
				moveTo = strings.TrimSpace(strings.TrimPrefix(lines[i], moveToMarker))
				i++
			}
			hunks, next, err := parseHunks(lines, i, path)
			if err != nil {
				return nil, err
			}
			i = next
			ops = append(ops, Op{Kind: Update, Path: path, MoveTo: moveTo, Hunks: hunks})
		case strings.TrimSpace(line) == "":
			i++
		default:
			return nil, fmt.Errorf("invalid patch: unexpected line %q", line)
		}
	}
	return ops, nil
}

func isPatchHeader(line string) bool {
	return strings.HasPrefix(line, addFileMarker) ||
		strings.HasPrefix(line, deleteFileMarker) ||
		strings.HasPrefix(line, updateFileMarker)
}

func parseHunks(lines []string, start int, path string) ([]Hunk, int, error) {
	var hunks []Hunk
	i := start
	for i < len(lines) && strings.HasPrefix(lines[i], hunkContextMarker) {
		i++ // the @@ line itself only carries optional context text we don't need for matching
		var hunk Hunk
		for i < len(lines) {
			line := lines[i]
			if isPatchHeader(line) || strings.HasPrefix(line, hunkContextMarker) {
				break
			}
			if line == endOfFileMarker {
				hunk.EndOfFile = true
				i++
				break
			}
			if line == "" {
				i++
				continue
			}
			kind := line[0]
			if kind != ' ' && kind != '-' && kind != '+' {
				return nil, 0, fmt.Errorf("invalid patch: unexpected line in Update File %s: %q", path, line)
			}
			hunk.Lines = append(hunk.Lines, Line{Kind: kind, Text: line[1:]})
			i++
		}
		hunks = append(hunks, hunk)
	}
	if len(hunks) == 0 {
		return nil, 0, fmt.Errorf("invalid patch: Update File %s has no hunks", path)
	}
	return hunks, i, nil
}

// SplitLines splits file content into lines the way ApplyHunks expects -
// without a trailing empty element for a final newline.
func SplitLines(content string) []string {
	if content == "" {
		return []string{}
	}
	return strings.Split(strings.TrimSuffix(content, "\n"), "\n")
}

// JoinLines is the inverse of SplitLines.
func JoinLines(lines []string) string {
	return strings.Join(lines, "\n")
}

// JoinLinesPreservingFinalNewline restores the source file's final-newline
// convention after a patch update. The patch grammar does not encode a
// request to add or remove that byte, so updates must leave it unchanged.
func JoinLinesPreservingFinalNewline(lines []string, source string) string {
	joined := JoinLines(lines)
	if strings.HasSuffix(source, "\n") {
		joined += "\n"
	}
	return joined
}

// ApplyHunks locates each hunk's old-content within fileLines (via a fuzzy
// fallback chain) and returns the resulting line slice with every hunk
// applied. Replacements are computed in hunk order but applied in reverse
// index order so earlier edits don't shift the offsets of later ones - the
// same trick both opencode and codex use.
func ApplyHunks(fileLines []string, hunks []Hunk) ([]string, error) {
	type replacement struct {
		start, end int // end is exclusive
		lines      []string
	}

	var replacements []replacement
	searchFrom := 0
	for _, hunk := range hunks {
		oldLines, newLines := hunk.SplitOldNew()
		start, ok := seekLines(fileLines, oldLines, searchFrom, hunk.EndOfFile)
		if !ok {
			return nil, fmt.Errorf("could not locate context for a hunk")
		}
		end := start + len(oldLines)
		replacements = append(replacements, replacement{start: start, end: end, lines: newLines})
		searchFrom = end
	}

	sort.Slice(replacements, func(i, j int) bool { return replacements[i].start > replacements[j].start })

	result := append([]string{}, fileLines...)
	for _, r := range replacements {
		tail := append([]string{}, result[r.end:]...)
		result = append(result[:r.start], append(append([]string{}, r.lines...), tail...)...)
	}
	return result, nil
}

// seekLines finds where the old-content block occurs within fileLines,
// starting from searchFrom. It tries four progressively looser comparisons -
// exact, right-trimmed, fully trimmed, and Unicode-normalized - matching the
// fallback chain both opencode and codex rely on for real-world model output.
// When endOfFile is set, the search prefers a match ending at fileLines' end.
func seekLines(fileLines, oldLines []string, searchFrom int, endOfFile bool) (int, bool) {
	if len(oldLines) == 0 {
		if endOfFile {
			return len(fileLines), true
		}
		return searchFrom, true
	}

	tiers := []func(a, b string) bool{
		func(a, b string) bool { return a == b },
		func(a, b string) bool { return strings.TrimRight(a, " \t") == strings.TrimRight(b, " \t") },
		func(a, b string) bool { return strings.TrimSpace(a) == strings.TrimSpace(b) },
		func(a, b string) bool {
			return normalizeUnicodePunctuation(strings.TrimSpace(a)) == normalizeUnicodePunctuation(strings.TrimSpace(b))
		},
	}

	for _, equal := range tiers {
		if endOfFile {
			start := len(fileLines) - len(oldLines)
			if start >= searchFrom && matchesAt(fileLines, oldLines, start, equal) {
				return start, true
			}
			continue
		}
		for start := searchFrom; start+len(oldLines) <= len(fileLines); start++ {
			if matchesAt(fileLines, oldLines, start, equal) {
				return start, true
			}
		}
	}
	return 0, false
}

func matchesAt(fileLines, oldLines []string, start int, equal func(a, b string) bool) bool {
	for i, want := range oldLines {
		if !equal(fileLines[start+i], want) {
			return false
		}
	}
	return true
}

var unicodePunctuationReplacer = strings.NewReplacer(
	"‘", "'", "’", "'", // smart single quotes
	"“", "\"", "”", "\"", // smart double quotes
	"–", "-", "—", "-", // en/em dash
	"…", "...", // ellipsis
	" ", " ", // non-breaking space
)

func normalizeUnicodePunctuation(s string) string {
	return unicodePunctuationReplacer.Replace(s)
}
