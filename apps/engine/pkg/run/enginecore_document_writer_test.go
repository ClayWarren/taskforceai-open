package run

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	enginecoretools "github.com/TaskForceAI/core/pkg/tools/enginecore"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/unidoc/unioffice/document"
)

func TestEnginecoreFileDocumentWriter(t *testing.T) {
	tmpDir := t.TempDir()

	target := filepath.Join(tmpDir, "reports", "data.docx")
	err := (enginecoreFileDocumentWriter{}).WriteDocument(context.Background(), enginecoretools.DocumentWriteRequest{
		Path:  target,
		Title: "Report",
		Sections: []enginecoretools.DocumentSection{
			{Heading: "Summary", Content: "Content"},
		},
	})
	if err == nil {
		assert.FileExists(t, target)
		return
	}

	var writeErr enginecoretools.DocumentWriteError
	require.ErrorAs(t, err, &writeErr)
	assert.Equal(t, enginecoretools.DocumentWriteFailureFile, writeErr.Kind)
}

func TestEnginecoreFileDocumentWriterDirectoryError(t *testing.T) {
	tmpDir := t.TempDir()
	blocker := filepath.Join(tmpDir, "blocked")
	require.NoError(t, os.WriteFile(blocker, []byte("not a directory"), 0o600))

	err := (enginecoreFileDocumentWriter{}).WriteDocument(context.Background(), enginecoretools.DocumentWriteRequest{
		Path: filepath.Join(blocker, "data.docx"),
	})
	var writeErr enginecoretools.DocumentWriteError
	require.ErrorAs(t, err, &writeErr)
	assert.Equal(t, enginecoretools.DocumentWriteFailureDirectory, writeErr.Kind)
}

func TestEnginecoreFileDocumentWriterFileError(t *testing.T) {
	target := filepath.Join(t.TempDir(), "data.docx")
	require.NoError(t, os.Mkdir(target, 0o750))

	err := (enginecoreFileDocumentWriter{}).WriteDocument(context.Background(), enginecoretools.DocumentWriteRequest{
		Path: target,
	})
	var writeErr enginecoretools.DocumentWriteError
	require.ErrorAs(t, err, &writeErr)
	assert.Equal(t, enginecoretools.DocumentWriteFailureFile, writeErr.Kind)
}

func TestEnginecoreFileDocumentWriterSaveSuccess(t *testing.T) {
	originalSave := saveEnginecoreDocumentToFile
	t.Cleanup(func() { saveEnginecoreDocumentToFile = originalSave })
	saveEnginecoreDocumentToFile = func(*document.Document, string) error {
		return nil
	}

	err := (enginecoreFileDocumentWriter{}).WriteDocument(context.Background(), enginecoretools.DocumentWriteRequest{
		Path: filepath.Join(t.TempDir(), "data.docx"),
	})
	require.NoError(t, err)
}
