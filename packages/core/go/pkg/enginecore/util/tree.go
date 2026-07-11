package util

import (
	"io/fs"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

var (
	walkTreeDir = func(root string, visit fs.WalkDirFunc) error { return CurrentFileSystem().WalkDir(root, visit) }
	relTreePath = func(base, target string) (string, error) { return CurrentFileSystem().Rel(base, target) }
)

type treeNode struct {
	name     string
	parent   *treeNode
	children []*treeNode
	childMap map[string]*treeNode
	sorted   bool
}

func Tree(cwd string, limit int) (string, error) {
	if cwd == "" {
		return "", nil
	}
	if limit <= 0 {
		limit = 50
	}
	root, err := collectTree(cwd)
	if err != nil {
		return "", err
	}

	result := &treeNode{}
	current := []*treeNode{root}
	processed := 0
	for len(current) > 0 {
		next := []*treeNode{}
		for _, node := range current {
			sortTree(node)
			if len(node.children) > 0 {
				next = append(next, node.children...)
			}
		}
		maxChildren := 0
		for _, node := range current {
			if len(node.children) > maxChildren {
				maxChildren = len(node.children)
			}
		}
		for i := 0; i < maxChildren && processed < limit; i++ {
			for _, node := range current {
				if i >= len(node.children) {
					continue
				}
				child := node.children[i]
				copyPath(result, root, child)
				processed++
				if processed >= limit {
					break
				}
			}
		}
		if processed >= limit {
			all := append([]*treeNode{}, current...)
			all = append(all, next...)
			for _, node := range all {
				compare := findCopiedPath(result, root, node)
				if compare == nil {
					continue
				}
				if len(compare.children) != len(node.children) {
					diff := len(node.children) - len(compare.children)
					addChild(compare, "["+itoa(diff)+" truncated]")
				}
			}
			break
		}
		current = next
	}

	lines := []string{}
	for _, child := range result.children {
		renderTree(child, 0, &lines)
	}
	return strings.Join(lines, "\n"), nil
}

func collectTree(root string) (*treeNode, error) {
	tree := &treeNode{}
	root = filepath.Clean(root)
	rootPrefix := root
	if !strings.HasSuffix(rootPrefix, string(filepath.Separator)) {
		rootPrefix += string(filepath.Separator)
	}
	ignore := NewGitIgnoreChain(root)
	err := walkTreeDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if ShouldSkipDir(d.Name()) {
				return filepath.SkipDir
			}
			if ignore != nil {
				if rel, relErr := treeRelativePath(root, rootPrefix, p); relErr == nil && rel != "" && ignore.Ignore(rel, true) {
					return filepath.SkipDir
				}
			}
			return nil
		}
		if ignore != nil {
			if rel, relErr := treeRelativePath(root, rootPrefix, p); relErr == nil && ignore.Ignore(rel, false) {
				return nil
			}
		}
		rel, relErr := treeRelativePath(root, rootPrefix, p)
		if relErr != nil {
			return relErr
		}
		if rel == "" || rel == "." || strings.Contains(rel, ".taskforceai") {
			return nil
		}
		addPath(tree, rel)
		return nil
	})
	return tree, err
}

func treeRelativePath(root, rootPrefix, path string) (string, error) {
	if path == root {
		return "", nil
	}
	if rel, ok := strings.CutPrefix(path, rootPrefix); ok {
		return filepath.ToSlash(rel), nil
	}
	rel, err := relTreePath(root, path)
	if err != nil {
		return "", err
	}
	return filepath.ToSlash(rel), nil
}

func addPath(root *treeNode, rel string) {
	current := root
	for {
		part, rest, found := strings.Cut(rel, "/")
		if part != "" {
			current = addChild(current, part)
		}
		if !found {
			return
		}
		rel = rest
	}
}

func addChild(node *treeNode, name string) *treeNode {
	if node.childMap == nil {
		node.childMap = make(map[string]*treeNode, len(node.children)+1)
		for _, child := range node.children {
			node.childMap[child.name] = child
		}
	}
	if child := node.childMap[name]; child != nil {
		return child
	}
	child := &treeNode{name: name, parent: node}
	node.children = append(node.children, child)
	node.childMap[name] = child
	node.sorted = false
	return child
}

func sortTree(node *treeNode) {
	if node.sorted {
		return
	}
	sort.Slice(node.children, func(i, j int) bool {
		a := node.children[i]
		b := node.children[j]
		if len(a.children) == 0 && len(b.children) > 0 {
			return false
		}
		if len(b.children) == 0 && len(a.children) > 0 {
			return true
		}
		return a.name < b.name
	})
	node.sorted = true
}

func copyPath(resultRoot, sourceRoot, target *treeNode) {
	path := pathToNode(sourceRoot, target)
	current := resultRoot
	for _, node := range path {
		current = addChild(current, node.name)
	}
}

func findCopiedPath(resultRoot, sourceRoot, target *treeNode) *treeNode {
	path := pathToNode(sourceRoot, target)
	current := resultRoot
	for _, node := range path {
		if current.childMap == nil {
			return nil
		}
		current = current.childMap[node.name]
		if current == nil {
			return nil
		}
	}
	return current
}

func pathToNode(root, target *treeNode) []*treeNode {
	if root == target {
		return nil
	}
	path := []*treeNode{}
	for node := target; node != nil && node != root; node = node.parent {
		path = append(path, node)
	}
	for i, j := 0, len(path)-1; i < j; i, j = i+1, j-1 {
		path[i], path[j] = path[j], path[i]
	}
	return path
}

func renderTree(node *treeNode, depth int, lines *[]string) {
	indent := strings.Repeat("\t", depth)
	label := node.name
	if len(node.children) > 0 {
		label += "/"
	}
	*lines = append(*lines, indent+label)
	for _, child := range node.children {
		renderTree(child, depth+1, lines)
	}
}

func itoa(value int) string {
	return strconv.Itoa(value)
}
