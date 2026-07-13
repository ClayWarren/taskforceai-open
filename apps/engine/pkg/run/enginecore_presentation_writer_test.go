package run

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	enginecoretools "github.com/TaskForceAI/core/pkg/tools/enginecore"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/unidoc/unioffice/presentation"
)

func TestEnginecoreFilePresentationWriter(t *testing.T) {
	tmpDir := t.TempDir()

	target := filepath.Join(tmpDir, "reports", "deck.pptx")
	err := (enginecoreFilePresentationWriter{}).WritePresentation(context.Background(), enginecoretools.PresentationWriteRequest{
		Path: target,
		Slides: []enginecoretools.PresentationSlide{
			{Title: "Report", Body: "Content"},
		},
	})
	if err == nil {
		assert.FileExists(t, target)
		return
	}

	var writeErr enginecoretools.PresentationWriteError
	require.ErrorAs(t, err, &writeErr)
	assert.Equal(t, enginecoretools.PresentationWriteFailureFile, writeErr.Kind)
}

func TestEnginecoreFilePresentationWriterDirectoryError(t *testing.T) {
	tmpDir := t.TempDir()
	blocker := filepath.Join(tmpDir, "blocked")
	require.NoError(t, os.WriteFile(blocker, []byte("not a directory"), 0o600))

	err := (enginecoreFilePresentationWriter{}).WritePresentation(context.Background(), enginecoretools.PresentationWriteRequest{
		Path: filepath.Join(blocker, "deck.pptx"),
	})
	var writeErr enginecoretools.PresentationWriteError
	require.ErrorAs(t, err, &writeErr)
	assert.Equal(t, enginecoretools.PresentationWriteFailureDirectory, writeErr.Kind)
}

func TestEnginecoreFilePresentationWriterFileError(t *testing.T) {
	target := filepath.Join(t.TempDir(), "deck.pptx")
	require.NoError(t, os.Mkdir(target, 0o750))

	err := (enginecoreFilePresentationWriter{}).WritePresentation(context.Background(), enginecoretools.PresentationWriteRequest{
		Path: target,
	})
	var writeErr enginecoretools.PresentationWriteError
	require.ErrorAs(t, err, &writeErr)
	assert.Equal(t, enginecoretools.PresentationWriteFailureFile, writeErr.Kind)
}

func TestEnginecoreFilePresentationWriterSaveSuccess(t *testing.T) {
	originalSave := saveEnginecorePresentationToFile
	t.Cleanup(func() { saveEnginecorePresentationToFile = originalSave })
	saveEnginecorePresentationToFile = func(*presentation.Presentation, string) error {
		return nil
	}

	err := (enginecoreFilePresentationWriter{}).WritePresentation(context.Background(), enginecoretools.PresentationWriteRequest{
		Path: filepath.Join(t.TempDir(), "deck.pptx"),
	})
	require.NoError(t, err)
}
