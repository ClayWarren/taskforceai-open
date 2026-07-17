package team

import (
	"context"
	"fmt"
	"sync"

	"github.com/TaskForceAI/core/pkg/platform"
)

// MaxHandlersPerEvent bounds event handler registrations per event type.
const MaxHandlersPerEvent = 100

// InMemoryBus is the default process-local implementation of Bus.
type InMemoryBus struct {
	mu       sync.RWMutex
	handlers map[string][]func(context.Context, map[string]any) error
}

func NewInMemoryBus() *InMemoryBus {
	return &InMemoryBus{handlers: make(map[string][]func(context.Context, map[string]any) error)}
}

func (b *InMemoryBus) Publish(ctx context.Context, event string, props any) error {
	b.mu.RLock()
	handlers, ok := b.handlers[event]
	b.mu.RUnlock()
	if !ok {
		return nil
	}
	properties, ok := props.(map[string]any)
	if !ok {
		platform.GetLogger().Warn("Team event publish received invalid properties", "event", event)
		return nil
	}
	for _, handler := range handlers {
		if err := handler(ctx, properties); err != nil {
			platform.GetLogger().Warn("Team event handler failed", "event", event, "error", err)
		}
	}
	return nil
}

func (b *InMemoryBus) Subscribe(_ context.Context, event string, handler func(context.Context, map[string]any) error) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.handlers[event]) >= MaxHandlersPerEvent {
		return fmt.Errorf("maximum number of handlers (%d) reached for event %q", MaxHandlersPerEvent, event)
	}
	b.handlers[event] = append(b.handlers[event], handler)
	return nil
}
