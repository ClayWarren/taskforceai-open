package core

import (
	"fmt"
	"sync"
)

type SequentialIDs struct {
	mu  sync.Mutex
	seq map[string]int
}

func NewSequentialIDs() *SequentialIDs {
	return &SequentialIDs{seq: map[string]int{}}
}

func (s *SequentialIDs) Next(prefix string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.seq[prefix]++
	return fmt.Sprintf("%s_%d", prefix, s.seq[prefix])
}
