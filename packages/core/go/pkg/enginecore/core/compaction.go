package core

import (
	"slices"
	"sort"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
)

// CompactionOptions controls compaction behavior.
type CompactionOptions struct {
	Auto  bool
	Prune bool
}

// CompactionInfo carries model/token info to decide overflow.
type CompactionInfo struct {
	InputTokens  int
	OutputTokens int
	CacheRead    int
	ModelContext int
	ModelOutput  int
	ModelInput   int
	OutputMax    int
}

type Compactor struct {
	Options CompactionOptions
	Bus     *Bus
}

// IsOverflow mirrors TS logic at a high level.
func (c *Compactor) IsOverflow(info CompactionInfo) bool {
	if !c.Options.Auto {
		return false
	}
	if info.ModelContext == 0 {
		return false
	}
	count := info.InputTokens + info.CacheRead + info.OutputTokens
	output := info.ModelOutput
	if info.OutputMax > 0 && info.OutputMax < output {
		output = info.OutputMax
	}
	usable := info.ModelInput
	if usable == 0 {
		usable = info.ModelContext - output
	}
	return count > usable
}

const (
	pruneMinimum = 20_000
	pruneProtect = 40_000
)

const compactMinimumTokens = 30_000

var pruneProtectedTools = map[string]struct{}{
	"skill": {},
}

// PruneToolOutputs removes older tool outputs to keep context smaller.
// It keeps the last two user turns and any messages marked summary.
func (c *Compactor) PruneToolOutputs(messages []Message) bool {
	if !c.Options.Prune {
		return false
	}
	return pruneToolOutputs(messages)
}

// Compact produces a summary and removes older messages once content grows large.
func (c *Compactor) Compact(messages []Message, summaryGen SummaryGenerator) (bool, []Message) {
	if !c.Options.Auto {
		return false, messages
	}
	if len(messages) == 0 {
		return false, messages
	}
	if tokenEstimateMessages(messages) < compactMinimumTokens {
		return false, messages
	}

	cutoff := cutoffIndex(messages, 2)
	if cutoff <= 0 {
		return false, messages
	}

	summaryMsg := Message{
		Info: MessageInfo{
			Role:       RoleAssistant,
			Agent:      "compaction",
			Mode:       "compaction",
			ProviderID: protocol.DefaultProviderID,
			ModelID:    protocol.DefaultQualifiedModelID,
			Summary:    true,
		},
		Parts: []Part{{Type: PartText, Text: summaryGen.Generate(messages[:cutoff])}},
	}
	next := append([]Message{summaryMsg}, messages[cutoff:]...)
	return true, next
}

func pruneToolOutputs(messages []Message) bool {
	pruned := false
	total := 0
	toPrune := make([]pruneCandidate, 0)
	turns := 0

	for _, msg := range slices.Backward(messages) {
		if msg.Info.Role == RoleUser {
			turns++
		}
		if turns < 2 {
			continue
		}
		if msg.Info.Role == RoleAssistant && msg.Info.Summary {
			break
		}
		for _, part := range slices.Backward(msg.Parts) {
			if part.Type != PartTool || part.State == nil {
				continue
			}
			if part.State.Status != "completed" || part.State.Output == "" {
				continue
			}
			if _, ok := pruneProtectedTools[part.Tool]; ok {
				continue
			}
			estimate := tokenEstimate(part.State.Output)
			total += estimate
			toPrune = append(toPrune, pruneCandidate{state: part.State, size: estimate})
		}
	}

	if total > pruneMinimum {
		sort.Slice(toPrune, func(i, j int) bool {
			return toPrune[i].size > toPrune[j].size
		})
		for _, candidate := range toPrune {
			if total <= pruneMinimum {
				break
			}
			state := candidate.state
			state.Output = ""
			if state.Metadata == nil {
				state.Metadata = map[string]any{}
			}
			state.Metadata["compacted"] = true
			pruned = true
			total -= candidate.size
		}
	}
	return pruned
}

func tokenEstimate(text string) int {
	if text == "" {
		return 0
	}
	ascii := 0
	nonASCII := 0
	for _, r := range text {
		if r <= 0x7f {
			ascii++
		} else {
			nonASCII++
		}
	}
	return (ascii+3)/4 + nonASCII
}

func tokenEstimateMessages(messages []Message) int {
	total := 0
	for _, msg := range messages {
		for _, part := range msg.Parts {
			est := 0
			switch part.Type {
			case PartText, PartReason:
				est = tokenEstimate(part.Text)
			case PartTool:
				if part.State != nil {
					est = tokenEstimate(part.State.Output)
				}
			case PartStepFinish, PartSystem:
				// No token contribution.
			}
			total = addTokenEstimate(total, est)
		}
	}
	return total
}

func addTokenEstimate(total, est int) int {
	maxInt := int(^uint(0) >> 1)
	if est > 0 && total > maxInt-est {
		return maxInt
	}
	return total + est
}

type pruneCandidate struct {
	state *ToolState
	size  int
}

// cutoffIndex returns index for keeping the last N user turns.
func cutoffIndex(messages []Message, keepUserTurns int) int {
	if keepUserTurns <= 0 {
		return 0
	}
	turns := 0
	for i, message := range slices.Backward(messages) {
		if message.Info.Role == RoleUser {
			turns++
			if turns >= keepUserTurns {
				return i
			}
		}
	}
	return 0
}

func (c *Compactor) NotifyCompacted(sessionID string) {
	if c.Bus == nil {
		return
	}
	c.Bus.Publish("session.compacted", map[string]any{
		"sessionID": sessionID,
	})
}
