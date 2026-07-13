package util

var defaultSkipDirs = map[string]struct{}{
	".git":         {},
	"node_modules": {},
	"vendor":       {},
}

func ShouldSkipDir(name string) bool {
	_, ok := defaultSkipDirs[name]
	return ok
}
