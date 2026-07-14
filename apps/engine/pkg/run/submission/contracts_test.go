package submission

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSubmissionError(t *testing.T) {
	var nilSubmissionError *Error
	assert.Equal(t, "task submission failed", nilSubmissionError.Error())
	require.NoError(t, nilSubmissionError.Unwrap())

	empty := &Error{}
	assert.Equal(t, "task submission failed", empty.Error())

	cause := errors.New("queue unavailable")
	submissionError := &Error{Code: Queue, Err: cause}
	assert.Equal(t, cause.Error(), submissionError.Error())
	require.ErrorIs(t, submissionError, cause)
}
