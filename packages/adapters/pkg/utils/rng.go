package utils

import (
	"math/rand/v2"

	"github.com/google/uuid"
)

// RNG is an abstraction for random number generation.
type RNG interface {
	Random() float64
	UUID() string
}

// RealRNG uses system random sources.
type RealRNG struct{}

// Random returns a random number between 0.0 and 1.0.
func (r RealRNG) Random() float64 {
	return rand.Float64() // #nosec G404
}

// UUID generates a version 4 UUID string using google/uuid.
func (r RealRNG) UUID() string {
	return uuid.NewString()
}

// MockRNG is a deterministic RNG for testing.
type MockRNG struct {
	nextValue float64
	nextUUID  string
}

// NewMockRNG creates a new MockRNG with default values.
func NewMockRNG(val float64, uuid string) *MockRNG {
	return &MockRNG{nextValue: val, nextUUID: uuid}
}

func (m *MockRNG) Random() float64 {
	return m.nextValue
}

func (m *MockRNG) UUID() string {
	return m.nextUUID
}

func (m *MockRNG) SetNextRandom(val float64) {
	m.nextValue = val
}

func (m *MockRNG) SetNextUUID(val string) {
	m.nextUUID = val
}

// SystemRNG is a global instance of the real RNG.
var SystemRNG = RealRNG{}
