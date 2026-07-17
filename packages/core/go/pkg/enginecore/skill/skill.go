// Package skill discovers and loads SKILL.md skill definitions - the same
// filesystem convention opencode and codex converge on: a directory tree of
// skills, each a SKILL.md with YAML frontmatter (name, description) followed
// by a markdown body of instructions that gets injected into the
// conversation when the skill is invoked.
package skill

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	yaml "go.yaml.in/yaml/v4"
)

// Info describes one discovered skill.
type Info struct {
	Name        string
	Description string
	Path        string // absolute path to the SKILL.md file
}

const skillFileName = "SKILL.md"

// skillsRelDir is the project-relative directory scanned for skills.
// Kept to one location for v1 - no remote/URL skills, no user-global
// directory yet.
var skillsRelDir = filepath.Join(".taskforceai", "skills")

type frontmatter struct {
	Name        string `yaml:"name"`
	Description string `yaml:"description"`
}

var readSkillDefinition = readSkillFile

// Discover walks {cwd}/.taskforceai/skills/**/SKILL.md and returns every
// parseable skill, sorted by name. Missing directories and malformed files
// are skipped silently - discovery must never break a session.
func Discover(cwd string) []Info {
	root := filepath.Join(cwd, skillsRelDir)
	var skills []Info
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || d.Name() != skillFileName {
			return nil //nolint:nilerr // discovery is best-effort by design
		}
		if info, ok := parseSkillFile(path); ok {
			skills = append(skills, info)
		}
		return nil
	})
	sort.Slice(skills, func(i, j int) bool { return skills[i].Name < skills[j].Name })
	return skills
}

// Load returns the named skill's markdown body (the content after the
// frontmatter), ready to inject into the conversation.
func Load(cwd, name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("skill name is required")
	}
	for _, info := range Discover(cwd) {
		if info.Name == name {
			_, body, err := readSkillDefinition(info.Path)
			if err != nil {
				return "", err
			}
			return body, nil
		}
	}
	return "", fmt.Errorf("skill %q not found", name)
}

// FormatAvailable renders the discovered skills as a terse markdown block
// for inclusion in a system prompt. Returns "" when no skills exist so
// callers can skip the section entirely.
func FormatAvailable(skills []Info) string {
	if len(skills) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("## Available Skills\n")
	b.WriteString("Use the skill tool to load a skill when a task matches its description.\n")
	for _, s := range skills {
		fmt.Fprintf(&b, "- **%s**: %s\n", s.Name, s.Description)
	}
	return strings.TrimRight(b.String(), "\n")
}

func parseSkillFile(path string) (Info, bool) {
	fm, _, err := readSkillDefinition(path)
	if err != nil || strings.TrimSpace(fm.Name) == "" {
		return Info{}, false
	}
	return Info{
		Name:        strings.TrimSpace(fm.Name),
		Description: strings.TrimSpace(fm.Description),
		Path:        path,
	}, true
}

// readSkillFile splits a SKILL.md into its YAML frontmatter and markdown
// body. The frontmatter must be delimited by "---" lines at the top of the
// file, matching the convention both opencode and codex use.
func readSkillFile(path string) (frontmatter, string, error) {
	data, err := os.ReadFile(filepath.Clean(path)) // #nosec G304 -- paths come from Discover's own walk.
	if err != nil {
		return frontmatter{}, "", err
	}
	content := strings.ReplaceAll(string(data), "\r\n", "\n")
	rest, found := strings.CutPrefix(content, "---\n")
	if !found {
		return frontmatter{}, "", fmt.Errorf("skill file %s has no frontmatter", path)
	}
	fmText, body, found := strings.Cut(rest, "\n---")
	if !found {
		return frontmatter{}, "", fmt.Errorf("skill file %s has unterminated frontmatter", path)
	}
	var fm frontmatter
	if err := yaml.Unmarshal([]byte(fmText), &fm); err != nil {
		return frontmatter{}, "", fmt.Errorf("skill file %s has invalid frontmatter: %w", path, err)
	}
	body = strings.TrimPrefix(body, "\n")
	return fm, strings.TrimSpace(body), nil
}
