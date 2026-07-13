package sync

// ResolutionStrategy names the product policy for resolving concurrent sync edits.
type ResolutionStrategy string

const (
	StrategyServerWins ResolutionStrategy = "server_wins"
	StrategyClientWins ResolutionStrategy = "client_wins"
	StrategyAutoMerge  ResolutionStrategy = "auto_merge"
)
