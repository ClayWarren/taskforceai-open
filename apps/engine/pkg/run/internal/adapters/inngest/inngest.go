package inngestadapter

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	submissioncontract "github.com/TaskForceAI/go-engine/pkg/run/submission"
	"github.com/inngest/inngestgo"
)

type Event struct {
	Name string         `json:"name"`
	Data map[string]any `json:"data"`
}

type Sender = submissioncontract.Sender

type Client struct {
	inner Sender
}

type Factory func(opts inngestgo.ClientOpts) (Sender, error)

var ErrNotConfigured = errors.New("INNGEST_EVENT_KEY not set")

func NewClient(factory Factory) *Client {
	opts, ok := buildInngestClientOpts()
	if !ok {
		return &Client{}
	}

	client, err := factory(opts)
	if err != nil {
		return &Client{}
	}

	return &Client{inner: client}
}

func NewSDKClient() (inngestgo.Client, error) {
	opts, ok := buildInngestClientOpts()
	if !ok {
		return nil, ErrNotConfigured
	}
	return inngestgo.NewClient(opts)
}

func buildInngestClientOpts() (inngestgo.ClientOpts, bool) {
	eventKey := os.Getenv("INNGEST_EVENT_KEY")
	devMode := strings.TrimSpace(os.Getenv("INNGEST_DEV")) != ""
	if eventKey == "" && !devMode {
		return inngestgo.ClientOpts{}, false
	}

	opts := inngestgo.ClientOpts{
		AppID: "taskforceai-engine",
		Dev:   new(devMode),
	}
	if eventKey != "" {
		opts.EventKey = &eventKey
	}
	return opts, true
}

func (c *Client) SetInner(inner Sender) {
	c.inner = inner
}

func (c *Client) Send(ctx context.Context, event any) (string, error) {
	if c.inner == nil {
		return "", fmt.Errorf("INNGEST_EVENT_KEY not set")
	}
	return c.inner.Send(ctx, event)
}

func (c *Client) SendEvent(ctx context.Context, eventName string, data map[string]any) error {
	if c.inner == nil {
		return fmt.Errorf("INNGEST_EVENT_KEY not set")
	}

	event := inngestgo.GenericEvent[map[string]any]{
		Name: eventName,
		Data: data,
	}

	_, err := c.inner.Send(ctx, event)
	return err
}
