package core

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestOrchestrator_Basic(t *testing.T) {
	orch := NewOrchestrator(nil, nil, nil)
	assert.NotNil(t, orch)
}

func TestEnsureMetadata(t *testing.T) {
	orch := &Orchestrator{IDs: NewSequentialIDs()}
	msgs := []Message{
		{Parts: []Part{{Type: PartText, Text: "hi"}}},
	}
	orch.ensureMetadata("s1", msgs)

	assert.Equal(t, "s1", msgs[0].Info.SessionID)
	assert.NotEmpty(t, msgs[0].Info.ID)
	assert.NotZero(t, msgs[0].Info.TimeCreated)
}
