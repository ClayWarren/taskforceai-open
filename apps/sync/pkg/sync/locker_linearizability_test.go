package sync

import (
	"context"
	"fmt"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"

	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	miniredis "github.com/alicebob/miniredis/v2"
	"github.com/anishathalye/porcupine"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
)

type lockIncrementOutput struct {
	Before int64
	After  int64
	Err    string
}

func TestRedisLocker_IncrementHistoryIsLinearizable(t *testing.T) {
	server := miniredis.RunT(t)
	client := goredis.NewClient(&goredis.Options{Addr: server.Addr()})
	t.Cleanup(func() { require.NoError(t, client.Close()) })

	locker := &RedisLocker{client: redis.NewClient(client)}
	const clients = 8
	operations := make([]porcupine.Operation, clients)
	var sequence atomic.Int64
	var value atomic.Int64
	var workers sync.WaitGroup
	workers.Add(clients)

	for clientID := range clients {
		go func() {
			defer workers.Done()
			call := sequence.Add(1)
			output := lockIncrementOutput{}

			release, err := locker.Lock(context.Background(), "linearizable-user")
			if err != nil {
				output.Err = err.Error()
			} else {
				output.Before = value.Load()
				runtime.Gosched()
				output.After = output.Before + 1
				value.Store(output.After)
				release()
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

	model := porcupine.Model{
		Init: func() any { return int64(0) },
		Step: func(state, _ any, rawOutput any) (bool, any) {
			current := state.(int64)
			output := rawOutput.(lockIncrementOutput)
			if output.Err != "" || output.Before != current || output.After != current+1 {
				return false, state
			}
			return true, output.After
		},
		DescribeOperation: func(_ any, rawOutput any) string {
			output := rawOutput.(lockIncrementOutput)
			return fmt.Sprintf("increment %d -> %d error=%q", output.Before, output.After, output.Err)
		},
	}

	require.True(t, porcupine.CheckOperations(model, operations), "Redis lock history was not linearizable: %#v", operations)
	require.Equal(t, int64(clients), value.Load())
}

func TestRedisLocker_LinearizabilityModelRejectsLostUpdate(t *testing.T) {
	model := porcupine.Model{
		Init: func() any { return int64(0) },
		Step: func(state, _ any, rawOutput any) (bool, any) {
			current := state.(int64)
			output := rawOutput.(lockIncrementOutput)
			return output.Err == "" && output.Before == current && output.After == current+1, output.After
		},
	}
	history := []porcupine.Operation{
		{ClientId: 0, Input: struct{}{}, Call: 1, Output: lockIncrementOutput{Before: 0, After: 1}, Return: 4},
		{ClientId: 1, Input: struct{}{}, Call: 2, Output: lockIncrementOutput{Before: 0, After: 1}, Return: 3},
	}

	require.False(t, porcupine.CheckOperations(model, history))
}
