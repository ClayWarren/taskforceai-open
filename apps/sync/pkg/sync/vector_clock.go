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
