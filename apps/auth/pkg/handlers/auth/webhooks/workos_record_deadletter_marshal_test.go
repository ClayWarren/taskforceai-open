package webhooks

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
)

type marshalFailError struct{}

func (marshalFailError) Error() string                { return "marshal failed" }
func (marshalFailError) MarshalJSON() ([]byte, error) { return nil, errors.New("marshal failed") }

func TestRecordDeadLetter_MarshalFailure(t *testing.T) {
	original := jsonMarshal
	jsonMarshal = func(any) ([]byte, error) {
		return nil, errors.New("marshal failed")
	}
	t.Cleanup(func() { jsonMarshal = original })

	store := &deadLetterStoreStub{}
	h := &WorkOSWebhookHandlerStruct{ReplayStore: store}
	h.recordDeadLetter(context.Background(), "evt_bad", "user.created", marshalFailError{}, "failed")
	assert.Empty(t, store.setKey)
}
