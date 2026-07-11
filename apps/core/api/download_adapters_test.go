package handler

import (
	"context"
	"errors"
	"testing"
	"time"

	vercelblob "github.com/claywarren/vercel_blob"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeDownloadBlobLister struct {
	pages []vercelblob.ListBlobResult
	seen  []vercelblob.ListCommandOptions
}

func (f *fakeDownloadBlobLister) List(_ context.Context, options vercelblob.ListCommandOptions) (*vercelblob.ListBlobResult, error) {
	f.seen = append(f.seen, options)
	if len(f.pages) == 0 {
		return &vercelblob.ListBlobResult{}, nil
	}
	page := f.pages[0]
	f.pages = f.pages[1:]
	return &page, nil
}

func TestDownloadBlobArtifactStore(t *testing.T) {
	t.Run("requires token", func(t *testing.T) {
		store := downloadBlobArtifactStore{}

		_, err := store.ListDownloadArtifacts(context.Background(), "desktop/macos/")

		require.Error(t, err)
		assert.Contains(t, err.Error(), "missing BLOB_READ_WRITE_TOKEN")
	})

	t.Run("paginates and maps blobs", func(t *testing.T) {
		now := time.Now()
		lister := &fakeDownloadBlobLister{
			pages: []vercelblob.ListBlobResult{
				{
					Blobs:   []vercelblob.ListBlobResultBlob{{PathName: "desktop/macos/old.dmg", URL: "https://blob.test/old", UploadedAt: now.Add(-time.Hour)}},
					Cursor:  "next",
					HasMore: true,
				},
				{
					Blobs: []vercelblob.ListBlobResultBlob{{PathName: "desktop/macos/new.dmg", URL: "https://blob.test/new", UploadedAt: now}},
				},
			},
		}
		store := downloadBlobArtifactStore{
			token: "token",
			newClient: func(token string) downloadBlobLister {
				assert.Equal(t, "token", token)
				return lister
			},
		}

		artifacts, err := store.ListDownloadArtifacts(context.Background(), "desktop/macos/")

		require.NoError(t, err)
		require.Len(t, artifacts, 2)
		assert.Equal(t, "desktop/macos/old.dmg", artifacts[0].PathName)
		assert.Equal(t, "https://blob.test/new", artifacts[1].URL)
		require.Len(t, lister.seen, 2)
		assert.Empty(t, lister.seen[0].Cursor)
		assert.Equal(t, "next", lister.seen[1].Cursor)
	})

	t.Run("propagates list errors", func(t *testing.T) {
		expected := errors.New("list failed")
		store := downloadBlobArtifactStore{
			token: "token",
			newClient: func(string) downloadBlobLister {
				return errorDownloadBlobLister{err: expected}
			},
		}

		_, err := store.ListDownloadArtifacts(context.Background(), "desktop/macos/")

		require.ErrorIs(t, err, expected)
	})
}

type errorDownloadBlobLister struct {
	err error
}

func (e errorDownloadBlobLister) List(context.Context, vercelblob.ListCommandOptions) (*vercelblob.ListBlobResult, error) {
	return nil, e.err
}
