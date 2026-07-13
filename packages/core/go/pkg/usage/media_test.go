package usage

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
)

type eventRepoStub struct {
	rows []EventRow
	err  error
}

func (s *eventRepoStub) CreateUsageEvents(_ context.Context, rows []EventRow) error {
	s.rows = append(s.rows, rows...)
	return s.err
}

func TestRecordMediaUsage(t *testing.T) {
	repo := &eventRepoStub{}
	require.NoError(t, RecordMediaUsage(context.Background(), repo, MediaEventParams{
		TaskID: "image", Model: imageGenerationModelID,
	}))
	require.Equal(t, "image", repo.rows[0].Modality)
	require.Equal(t, int64(39_000), repo.rows[0].CostMicros)

	require.NoError(t, RecordMediaUsage(context.Background(), repo, MediaEventParams{
		TaskID: "video", Model: videoGenerationModelID, Prompt: "make a 15 second clip",
	}))
	require.Equal(t, "video", repo.rows[1].Modality)
	require.Equal(t, float64(15), repo.rows[1].Quantity)
	require.Equal(t, int64(2_100_000), repo.rows[1].CostMicros)

	require.NoError(t, RecordMediaUsage(context.Background(), repo, MediaEventParams{Model: "unknown"}))
	writeErr := errors.New("write failed")
	require.ErrorIs(t, RecordMediaUsage(context.Background(), &eventRepoStub{err: writeErr}, MediaEventParams{
		TaskID: "image-error", Model: imageGenerationModelID,
	}), writeErr)
}
