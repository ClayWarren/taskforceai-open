package run

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/inngest/inngestgo"
)

type InngestEvent struct {
	Name string         `json:"name"`
	Data map[string]any `json:"data"`
}

type InngestSender interface {
	Send(ctx context.Context, event any) (string, error)
}

type InngestClient struct {
	inner InngestSender
}

var newInngestClient = func(opts inngestgo.ClientOpts) (InngestSender, error) {
	return inngestgo.NewClient(opts)
}

var errInngestNotConfigured = errors.New("INNGEST_EVENT_KEY not set")

func NewInngestClient() *InngestClient {
	opts, ok := buildInngestClientOpts()
	if !ok {
		return &InngestClient{}
	}

	client, err := newInngestClient(opts)
	if err != nil {
		return &InngestClient{}
	}

	return &InngestClient{inner: client}
}

func NewInngestSDKClient() (inngestgo.Client, error) {
	opts, ok := buildInngestClientOpts()
	if !ok {
		return nil, errInngestNotConfigured
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

func (c *InngestClient) SetInner(inner InngestSender) {
	c.inner = inner
}

func (c *InngestClient) Send(ctx context.Context, event any) (string, error) {
	if c.inner == nil {
		return "", fmt.Errorf("INNGEST_EVENT_KEY not set")
	}
	return c.inner.Send(ctx, event)
}

func (c *InngestClient) SendEvent(ctx context.Context, eventName string, data map[string]any) error {
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
