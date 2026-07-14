package enginecoreadapter

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	enginecoretools "github.com/TaskForceAI/core/pkg/enginecore/tools"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEnginecoreFilePDFWriter(t *testing.T) {
	tmpDir := t.TempDir()

	target := filepath.Join(tmpDir, "reports", "data.pdf")
	err := (enginecoreFilePDFWriter{}).WritePDF(context.Background(), enginecoretools.PDFWriteRequest{
		Path:  target,
		Title: "Report",
		Sections: []enginecoretools.DocumentSection{
			{Heading: "Summary", Content: "Content"},
		},
	})
	require.NoError(t, err)
	assert.FileExists(t, target)
}

func TestEnginecoreFilePDFWriterDirectoryError(t *testing.T) {
	tmpDir := t.TempDir()
	blocker := filepath.Join(tmpDir, "blocked")
	require.NoError(t, os.WriteFile(blocker, []byte("not a directory"), 0o600))

	err := (enginecoreFilePDFWriter{}).WritePDF(context.Background(), enginecoretools.PDFWriteRequest{
		Path: filepath.Join(blocker, "data.pdf"),
	})
	var writeErr enginecoretools.PDFWriteError
	require.ErrorAs(t, err, &writeErr)
	assert.Equal(t, enginecoretools.PDFWriteFailureDirectory, writeErr.Kind)
}

func TestEnginecoreFilePDFWriterFileError(t *testing.T) {
	target := filepath.Join(t.TempDir(), "data.pdf")
	require.NoError(t, os.Mkdir(target, 0o750))

	err := (enginecoreFilePDFWriter{}).WritePDF(context.Background(), enginecoretools.PDFWriteRequest{
		Path: target,
	})
	var writeErr enginecoretools.PDFWriteError
	require.ErrorAs(t, err, &writeErr)
	assert.Equal(t, enginecoretools.PDFWriteFailureFile, writeErr.Kind)
}
