package auditflush

import "sync"

var (
	mu       sync.RWMutex
	nextID   uint64
	flushFns map[uint64]func()
)

func Register(flush func()) func() {
	if flush == nil {
		return func() {}
	}

	mu.Lock()
	if flushFns == nil {
		flushFns = make(map[uint64]func())
	}
	id := nextID
	nextID++
	flushFns[id] = flush
	mu.Unlock()

	var once sync.Once
	return func() {
		once.Do(func() {
			mu.Lock()
			delete(flushFns, id)
			mu.Unlock()
		})
	}
}

func Flush() {
	mu.RLock()
	callbacks := make([]func(), 0, len(flushFns))
	for _, flush := range flushFns {
		callbacks = append(callbacks, flush)
	}
	mu.RUnlock()

	for _, flush := range callbacks {
		flush()
	}
}
