package handler

import (
	"context"
	"errors"
	"os"
	"strings"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/core/pkg/platform"
	vercelblob "github.com/claywarren/vercel_blob"
)

type downloadStoreAdapter struct {
	q *db.Queries
}

func (a downloadStoreAdapter) RecordDownload(ctx context.Context, input platform.RecordDownloadInput) error {
	return a.q.RecordDownload(ctx, db.RecordDownloadParams{
		Product:       input.Product,
		Platform:      input.Platform,
		Version:       input.Version,
		UserAgent:     input.UserAgent,
		IpAddressHash: input.IPAddressHash,
		Referrer:      input.Referrer,
	})
}

type downloadBlobArtifactStore struct {
	token     string
	newClient func(string) downloadBlobLister
}

type downloadBlobLister interface {
	List(ctx context.Context, options vercelblob.ListCommandOptions) (*vercelblob.ListBlobResult, error)
}

func newDownloadArtifactStoreFromEnv() platform.DownloadArtifactStore {
	return downloadBlobArtifactStore{token: strings.TrimSpace(os.Getenv("BLOB_READ_WRITE_TOKEN"))}
}

func (s downloadBlobArtifactStore) ListDownloadArtifacts(ctx context.Context, prefix string) ([]platform.DownloadArtifact, error) {
	if s.token == "" {
		return nil, errors.New("missing BLOB_READ_WRITE_TOKEN")
	}

	newClient := s.newClient
	if newClient == nil {
		newClient = func(token string) downloadBlobLister {
			return vercelblob.NewClientExternal(&downloadBlobTokenProvider{token: token})
		}
	}

	blobs, err := listDownloadBlobs(ctx, newClient(s.token), prefix)
	if err != nil {
		return nil, err
	}
	artifacts := make([]platform.DownloadArtifact, len(blobs))
	for i, blob := range blobs {
		artifacts[i] = platform.DownloadArtifact{
			PathName:   blob.PathName,
			URL:        blob.URL,
			UploadedAt: blob.UploadedAt,
		}
	}
	return artifacts, nil
}

func listDownloadBlobs(ctx context.Context, client downloadBlobLister, prefix string) ([]vercelblob.ListBlobResultBlob, error) {
	var blobs []vercelblob.ListBlobResultBlob
	cursor := ""
	for {
		listRes, err := client.List(ctx, vercelblob.ListCommandOptions{Prefix: prefix, Cursor: cursor})
		if err != nil {
			return nil, err
		}
		blobs = append(blobs, listRes.Blobs...)
		if !listRes.HasMore || listRes.Cursor == "" {
			return blobs, nil
		}
		cursor = listRes.Cursor
	}
}

type downloadBlobTokenProvider struct{ token string }

func (p *downloadBlobTokenProvider) GetToken(_, _ string) (string, error) { return p.token, nil }
