package cache

import "errors"

// ErrNotFound reports a cache miss.
var ErrNotFound = errors.New("not found")
