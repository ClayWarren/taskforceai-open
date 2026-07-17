package taskregistry

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/anishathalye/porcupine"
	"github.com/stretchr/testify/require"
)

type taskStartClaimOutput struct {
	Started bool
	Err     string
}

func taskStartClaimModel() porcupine.Model {
	return porcupine.Model{
		Init: func() any { return false },
		Step: func(rawState, _ any, rawOutput any) (bool, any) {
			claimed := rawState.(bool)
			output := rawOutput.(taskStartClaimOutput)
			if output.Err != "" {
				return false, claimed
			}
			if !claimed {
				return output.Started, output.Started
			}
			return !output.Started, claimed
		},
		DescribeOperation: func(_ any, rawOutput any) string {
			output := rawOutput.(taskStartClaimOutput)
			return fmt.Sprintf("started=%t error=%q", output.Started, output.Err)
		},
	}
}

func TestTaskRegistry_MarkStartedHistoryIsLinearizable(t *testing.T) {
	registry, _, cleanup := setupMiniredisRegistry(t)
	t.Cleanup(cleanup)

	const taskID = "linearizable-start-claim"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))

	const clients = 8
	operations := make([]porcupine.Operation, clients)
	var sequence atomic.Int64
	var workers sync.WaitGroup
	workers.Add(clients)

	for clientID := range clients {
		go func() {
			defer workers.Done()
			call := sequence.Add(1)
			started, err := registry.MarkStartedWithError(taskID)
			output := taskStartClaimOutput{Started: started}
			if err != nil {
				output.Err = err.Error()
			}
			operations[clientID] = porcupine.Operation{
				ClientId: clientID,
				Input:    struct{}{},
				Call:     call,
				Output:   output,
				Return:   sequence.Add(1),
			}
		}()
	}
	workers.Wait()

	require.True(t, porcupine.CheckOperations(taskStartClaimModel(), operations), "task-start claim history was not linearizable: %#v", operations)
}

func TestTaskRegistry_MarkStartedModelRejectsTwoWinners(t *testing.T) {
	history := []porcupine.Operation{
		{ClientId: 0, Input: struct{}{}, Call: 1, Output: taskStartClaimOutput{Started: true}, Return: 3},
		{ClientId: 1, Input: struct{}{}, Call: 2, Output: taskStartClaimOutput{Started: true}, Return: 4},
	}

	require.False(t, porcupine.CheckOperations(taskStartClaimModel(), history))
}
