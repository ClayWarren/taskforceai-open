package transports

import (
	"encoding/json"
	"os"

	"github.com/TaskForceAI/logger/pkg"
)

type ConsoleTransport struct {
	marshalFunc func(v any) ([]byte, error)
}

func NewConsoleTransport() *ConsoleTransport {
	return &ConsoleTransport{
		marshalFunc: json.Marshal,
	}
}

func (t *ConsoleTransport) Name() string {
	return "console"
}

func (t *ConsoleTransport) Log(entry pkg.LogEntry) error {
	marshal := t.marshalFunc
	if marshal == nil {
		marshal = json.Marshal
	}
	data, err := marshal(entry)
	if err != nil {
		return err
	}

	stream := os.Stdout
	if entry.Level == pkg.LevelError || entry.Level == pkg.LevelWarn {
		stream = os.Stderr
	}

	data = append(data, '\n')
	_, _ = stream.Write(data)
	return nil
}

func (t *ConsoleTransport) Flush() error {
	return nil
}
