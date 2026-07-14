package sync

import coresync "github.com/TaskForceAI/core/pkg/sync"

const (
	Equal              = coresync.Equal
	Before             = coresync.Before
	After              = coresync.After
	Concurrent         = coresync.Concurrent
	StrategyServerWins = coresync.StrategyServerWins
	StrategyClientWins = coresync.StrategyClientWins
	StrategyAutoMerge  = coresync.StrategyAutoMerge
)

type ComparisonResult = coresync.ComparisonResult
type ResolutionStrategy = coresync.ResolutionStrategy
type VectorClock = coresync.VectorClock

var DecodeVectorClock = coresync.DecodeVectorClock

func compareSyncPayload(server, client VectorClock, serverVersion, clientVersion int32) ComparisonResult {
	if len(client) == 0 {
		switch {
		case clientVersion < serverVersion:
			return After
		case clientVersion > serverVersion:
			return Before
		case clientVersion > 0:
			return Equal
		}
	}
	return server.Compare(client)
}
