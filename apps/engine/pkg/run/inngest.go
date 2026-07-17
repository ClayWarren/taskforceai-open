package run

import (
	inngestadapter "github.com/TaskForceAI/go-engine/pkg/run/internal/adapters/inngest"
	submissioncontract "github.com/TaskForceAI/go-engine/pkg/run/submission"
	"github.com/inngest/inngestgo"
)

type InngestEvent = inngestadapter.Event
type InngestSender = submissioncontract.Sender
type InngestClient = inngestadapter.Client

var errInngestNotConfigured = inngestadapter.ErrNotConfigured

var newInngestClient = func(opts inngestgo.ClientOpts) (InngestSender, error) {
	return inngestgo.NewClient(opts)
}

func NewInngestClient() *InngestClient {
	return inngestadapter.NewClient(newInngestClient)
}

func NewInngestSDKClient() (inngestgo.Client, error) {
	return inngestadapter.NewSDKClient()
}
