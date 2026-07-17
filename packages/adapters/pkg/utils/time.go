package utils

import "time"

// Clock defines the interface for managing time deterministically.
type Clock interface {
	Now() int64
	Time() time.Time
}

// RealClock implements Clock using system time.
type RealClock struct{}

func (c RealClock) Now() int64 {
	return time.Now().UnixMilli()
}

func (c RealClock) Time() time.Time {
	return time.Now()
}

// FixedClock implements Clock with a fixed time for testing.
type FixedClock struct {
	currentTime int64
}

func NewFixedClock(t int64) *FixedClock {
	return &FixedClock{currentTime: t}
}

func (c *FixedClock) Now() int64 {
	return c.currentTime
}

func (c *FixedClock) Time() time.Time {
	return time.UnixMilli(c.currentTime)
}

func (c *FixedClock) Advance(ms int64) {
	c.currentTime += ms
}

func (c *FixedClock) Set(t int64) {
	c.currentTime = t
}

var SystemClock = RealClock{}
