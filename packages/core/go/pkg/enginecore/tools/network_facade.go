package tools

import (
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/network"
)

var (
	ErrWebFetchConnection        = network.ErrWebFetchConnection
	ErrWebFetchPrivateAddress    = network.ErrWebFetchPrivateAddress
	ErrWebFetchSourceUnavailable = network.ErrWebFetchSourceUnavailable
)

type (
	WebFetchRequest  = network.WebFetchRequest
	WebFetchResponse = network.WebFetchResponse
	WebFetchSource   = network.WebFetchSource
)

func SetWebFetchSource(source WebFetchSource) func() { return network.SetWebFetchSource(source) }

func toolWebFetch(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return network.ExecuteWebFetch(ctx, args)
}
