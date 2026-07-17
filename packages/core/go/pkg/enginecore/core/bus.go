package core

import (
	"sync"
	"sync/atomic"
)

type BusEvent struct {
	Name string
	Data any
}

type Bus struct {
	mu           sync.Mutex
	listeners    map[string][]chan BusEvent
	dropped      atomic.Uint64
	dropObserver atomic.Value
}

func NewBus() *Bus {
	bus := &Bus{listeners: map[string][]chan BusEvent{}}
	bus.dropObserver.Store((func(uint64))(nil))
	return bus
}

func (b *Bus) Subscribe(name string) <-chan BusEvent {
	b.mu.Lock()
	defer b.mu.Unlock()
	ch := make(chan BusEvent, 8)
	b.listeners[name] = append(b.listeners[name], ch)
	return ch
}

func (b *Bus) Unsubscribe(name string, ch <-chan BusEvent) {
	b.mu.Lock()
	defer b.mu.Unlock()
	listeners := b.listeners[name]
	var toClose chan BusEvent
	for i, listener := range listeners {
		if (<-chan BusEvent)(listener) == ch {
			toClose = listener
			listeners[i] = listeners[len(listeners)-1]
			listeners = listeners[:len(listeners)-1]
			break
		}
	}
	if len(listeners) == 0 {
		delete(b.listeners, name)
		if toClose != nil {
			close(toClose)
		}
		return
	}
	b.listeners[name] = listeners
	if toClose != nil {
		close(toClose)
	}
}

func (b *Bus) Dropped() uint64 {
	return b.dropped.Load()
}

func (b *Bus) SetDropObserver(fn func(uint64)) {
	if fn == nil {
		b.dropObserver.Store((func(uint64))(nil))
		return
	}
	b.dropObserver.Store(fn)
}

func (b *Bus) Publish(name string, data any) {
	b.mu.Lock()
	listeners := append([]chan BusEvent{}, b.listeners[name]...)
	b.mu.Unlock()
	ev := BusEvent{Name: name, Data: data}
	for _, ch := range listeners {
		b.safeSend(ch, ev)
	}
}

func (b *Bus) safeSend(ch chan BusEvent, ev BusEvent) {
	defer func() {
		if recover() != nil {
			b.recordDrop()
		}
	}()
	select {
	case ch <- ev:
	default:
		b.recordDrop()
	}
}

func (b *Bus) recordDrop() {
	count := b.dropped.Add(1)
	if fn := b.dropObserver.Load(); fn != nil {
		if cb, ok := fn.(func(uint64)); ok && cb != nil {
			cb(count)
		}
	}
}
