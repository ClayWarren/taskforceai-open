package orchestrator

import (
	"sync"

	"github.com/TaskForceAI/core/pkg/platform"
	"github.com/TaskForceAI/core/pkg/shared"
)

type BudgetManager struct {
	initial   *int
	remaining *int

	initialUSD  *float64
	consumedUSD float64
	pendingUSD  float64

	mu sync.Mutex
}

const estimatedCallUSD = 0.01

func NewBudgetManager(initial *int) *BudgetManager {
	var initialValue *int
	var remaining *int
	if initial != nil {
		initialClone := *initial
		remainingClone := *initial
		initialValue = &initialClone
		remaining = &remainingClone
	}
	return &BudgetManager{
		initial:   initialValue,
		remaining: remaining,
	}
}

func (b *BudgetManager) SetUSDBudget(usd *float64) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if usd == nil {
		b.initialUSD = nil
		return
	}
	value := *usd
	b.initialUSD = &value
}

type BudgetUsage struct {
	Initial      int
	Remaining    int
	Consumed     int
	InitialUSD   *float64
	ConsumedUSD  float64
	RemainingUSD *float64
}

func (b *BudgetManager) GetUsage() shared.Result[BudgetUsage] {
	b.mu.Lock()
	defer b.mu.Unlock()

	usage := BudgetUsage{
		ConsumedUSD: b.consumedUSD,
	}

	if b.initial != nil {
		usage.Initial = *b.initial
		remaining := 0
		if b.remaining != nil {
			remaining = *b.remaining
		}
		usage.Remaining = remaining
		usage.Consumed = *b.initial - remaining
	}

	if b.initialUSD != nil {
		usage.InitialUSD = b.initialUSD
		remUSD := *b.initialUSD - b.consumedUSD
		usage.RemainingUSD = &remUSD
	}

	return shared.Ok(usage)
}

func (b *BudgetManager) RecordCost(usd float64) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.consumedUSD += usd
}

func (b *BudgetManager) WithBudget(label string, fn func() error) error {
	b.mu.Lock()
	if b.remaining != nil {
		if *b.remaining <= 0 {
			b.mu.Unlock()
			return &platform.OrchestrationError{
				Message: "LLM call budget exceeded",
				Stage:   label,
			}
		}
		*b.remaining--
	}

	if b.initialUSD != nil {
		projectedSpend := b.consumedUSD + b.pendingUSD + estimatedCallUSD
		if projectedSpend > *b.initialUSD {
			b.mu.Unlock()
			return &platform.OrchestrationError{
				Message: "Organization USD budget exceeded",
				Stage:   label,
			}
		}
		b.pendingUSD += estimatedCallUSD
	}
	b.mu.Unlock()

	err := fn()

	b.mu.Lock()
	if b.initialUSD != nil {
		b.pendingUSD -= estimatedCallUSD
		if b.pendingUSD < 0 {
			b.pendingUSD = 0
		}
		b.consumedUSD += estimatedCallUSD
	}
	b.mu.Unlock()

	return err
}
