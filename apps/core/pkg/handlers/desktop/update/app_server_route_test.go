package update

import (
	"context"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/go-core/internal/handlertest"
	vercelblob "github.com/claywarren/vercel_blob"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type failingReadCloser struct{}

func (failingReadCloser) Read([]byte) (int, error) { return 0, errors.New("read failed") }
func (failingReadCloser) Close() error             { return nil }

func TestAppServerUpdateServesNewerSignedRuntimeMetadata(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	now := time.Date(2026, 7, 13, 22, 0, 0, 0, time.UTC)
	blobs := []vercelblob.ListBlobResultBlob{
		{PathName: "desktop/app-server/darwin-aarch64/taskforceai-app-server-0.11.7", URL: "https://blob.example/runtime", UploadedAt: now},
		{PathName: "desktop/app-server/darwin-aarch64/taskforceai-app-server-0.11.7.sha256", URL: "https://blob.example/runtime.sha256", UploadedAt: now},
		{PathName: "desktop/app-server/darwin-aarch64/taskforceai-app-server-0.11.7.sig", URL: "https://blob.example/runtime.sig", UploadedAt: now},
	}
	originalClient := newBlobClient
	newBlobClient = func(string) blobClient {
		return &mockBlobClient{listFunc: func(_ context.Context, options vercelblob.ListCommandOptions) (*vercelblob.ListBlobResult, error) {
			assert.Equal(t, "desktop/app-server/darwin-aarch64/", options.Prefix)
			return &vercelblob.ListBlobResult{Blobs: blobs}, nil
		}}
	}
	t.Cleanup(func() { newBlobClient = originalClient })
	originalHTTP := httpDo
	httpDo = func(request *http.Request) (*http.Response, error) {
		content := strings.Repeat("a", 64)
		if strings.HasSuffix(request.URL.Path, ".sig") {
			content = base64.StdEncoding.EncodeToString([]byte("untrusted comment: release signature\ntrusted comment: timestamp:1"))
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(content))}, nil
	}
	t.Cleanup(func() { httpDo = originalHTTP })

	response := handlertest.ServeStatus(t, setupUpdateRouter(t), http.StatusOK, http.MethodGet, "/api/desktop/app-server/update/darwin-aarch64/0.11.6")
	require.Contains(t, response.Body.String(), `"version":"0.11.7"`)
	require.Contains(t, response.Body.String(), `"protocolVersion":"2026-07-14"`)
	require.Contains(t, response.Body.String(), `"sha256":"`+strings.Repeat("a", 64)+`"`)
	require.Contains(t, response.Body.String(), `"signature":"untrusted comment: release signature\ntrusted comment: timestamp:1"`)
}

func TestDecodeAppServerSignatureAcceptsTauriEncodingAndRawMinisign(t *testing.T) {
	raw := "untrusted comment: release signature\ntrusted comment: timestamp:1"
	decoded, err := decodeAppServerSignature(base64.StdEncoding.EncodeToString([]byte(raw)))
	require.NoError(t, err)
	assert.Equal(t, raw, decoded)

	decoded, err = decodeAppServerSignature("  " + raw + "\n")
	require.NoError(t, err)
	assert.Equal(t, raw, decoded)

	_, err = decodeAppServerSignature("not a signature")
	require.Error(t, err)
	_, err = decodeAppServerSignature(base64.StdEncoding.EncodeToString([]byte("not Minisign")))
	require.Error(t, err)
}

func TestAppServerUpdateReturnsNoContentWhenCurrent(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
	originalClient := newBlobClient
	newBlobClient = func(string) blobClient {
		return &mockBlobClient{listFunc: func(context.Context, vercelblob.ListCommandOptions) (*vercelblob.ListBlobResult, error) {
			artifactPath := "desktop/app-server/darwin-aarch64/taskforceai-app-server-0.11.7"
			return &vercelblob.ListBlobResult{Blobs: []vercelblob.ListBlobResultBlob{
				{PathName: artifactPath, URL: "https://blob.example/runtime", UploadedAt: time.Now()},
				{PathName: artifactPath + ".sha256"},
				{PathName: artifactPath + ".sig"},
			}}, nil
		}}
	}
	t.Cleanup(func() { newBlobClient = originalClient })

	handlertest.ServeStatus(t, setupUpdateRouter(t), http.StatusNoContent, http.MethodGet, "/api/desktop/app-server/update/darwin-aarch64/0.11.7")
}

func TestAppServerArtifactSelectionRejectsOtherTargetsAndHashFiles(t *testing.T) {
	now := time.Now()
	artifact, version, ok := latestAppServerArtifact([]vercelblob.ListBlobResultBlob{
		{PathName: "desktop/app-server/darwin-aarch64/taskforceai-app-server-0.11.8.sha256", UploadedAt: now},
		{PathName: "desktop/app-server/darwin-x86_64/taskforceai-app-server-9.0.0", UploadedAt: now},
		{PathName: "desktop/app-server/darwin-aarch64/taskforceai-app-server-0.11.7", UploadedAt: now},
		{PathName: "desktop/app-server/darwin-aarch64/taskforceai-app-server-0.11.7.sha256", UploadedAt: now},
		{PathName: "desktop/app-server/darwin-aarch64/taskforceai-app-server-0.11.7.sig", UploadedAt: now},
	}, "darwin-aarch64")

	require.True(t, ok)
	assert.Equal(t, "0.11.7", version)
	assert.Contains(t, artifact.PathName, "darwin-aarch64")
}

func TestAppServerUpdateRejectsInvalidRequestsAndUnavailableMetadata(t *testing.T) {
	t.Run("request validation", func(t *testing.T) {
		t.Setenv("BLOB_READ_WRITE_TOKEN", "")
		router := setupUpdateRouter(t)

		handlertest.ServeStatus(t, router, http.StatusNotFound, http.MethodGet, "/api/desktop/app-server/update/unknown/1.0.0")
		handlertest.ServeStatus(t, router, http.StatusUnprocessableEntity, http.MethodGet, "/api/desktop/app-server/update/darwin-aarch64/latest")
		handlertest.ServeStatus(t, router, http.StatusInternalServerError, http.MethodGet, "/api/desktop/app-server/update/darwin-aarch64/1.0.0")
	})

	t.Run("blob listing failure", func(t *testing.T) {
		t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
		originalClient := newBlobClient
		newBlobClient = func(string) blobClient {
			return &mockBlobClient{listFunc: func(context.Context, vercelblob.ListCommandOptions) (*vercelblob.ListBlobResult, error) {
				return nil, io.ErrUnexpectedEOF
			}}
		}
		t.Cleanup(func() { newBlobClient = originalClient })

		handlertest.ServeStatus(t, setupUpdateRouter(t), http.StatusInternalServerError, http.MethodGet, "/api/desktop/app-server/update/darwin-aarch64/1.0.0")
	})

	t.Run("no compatible artifact", func(t *testing.T) {
		t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
		originalClient := newBlobClient
		newBlobClient = func(string) blobClient {
			return &mockBlobClient{listFunc: func(context.Context, vercelblob.ListCommandOptions) (*vercelblob.ListBlobResult, error) {
				return &vercelblob.ListBlobResult{}, nil
			}}
		}
		t.Cleanup(func() { newBlobClient = originalClient })

		handlertest.ServeStatus(t, setupUpdateRouter(t), http.StatusNotFound, http.MethodGet, "/api/desktop/app-server/update/darwin-aarch64/1.0.0")
	})

	t.Run("version comparison failure", func(t *testing.T) {
		t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
		originalClient := newBlobClient
		newBlobClient = func(string) blobClient {
			return &mockBlobClient{listFunc: func(context.Context, vercelblob.ListCommandOptions) (*vercelblob.ListBlobResult, error) {
				artifactPath := "desktop/app-server/darwin-aarch64/taskforceai-app-server-1.1.0"
				return &vercelblob.ListBlobResult{Blobs: []vercelblob.ListBlobResultBlob{
					{PathName: artifactPath},
					{PathName: artifactPath + ".sha256"},
					{PathName: artifactPath + ".sig"},
				}}, nil
			}}
		}
		t.Cleanup(func() { newBlobClient = originalClient })
		originalCompare := compareAppServerVersions
		compareAppServerVersions = func(string, string) (int, error) {
			return 0, errors.New("comparison failed")
		}
		t.Cleanup(func() { compareAppServerVersions = originalCompare })

		handlertest.ServeStatus(t, setupUpdateRouter(t), http.StatusInternalServerError, http.MethodGet, "/api/desktop/app-server/update/darwin-aarch64/1.0.0")
	})

	t.Run("digest missing", func(t *testing.T) {
		t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
		originalClient := newBlobClient
		newBlobClient = func(string) blobClient {
			return &mockBlobClient{listFunc: func(context.Context, vercelblob.ListCommandOptions) (*vercelblob.ListBlobResult, error) {
				artifactPath := "desktop/app-server/darwin-aarch64/taskforceai-app-server-1.1.0"
				return &vercelblob.ListBlobResult{Blobs: []vercelblob.ListBlobResultBlob{
					{PathName: artifactPath},
					{PathName: artifactPath + ".sha256", URL: "https://blob.example/runtime.sha256"},
					{PathName: artifactPath + ".sig", URL: "https://blob.example/runtime.sig"},
				}}, nil
			}}
		}
		t.Cleanup(func() { newBlobClient = originalClient })
		originalHTTP := httpDo
		httpDo = func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: http.StatusNotFound, Body: io.NopCloser(strings.NewReader("missing"))}, nil
		}
		t.Cleanup(func() { httpDo = originalHTTP })

		handlertest.ServeStatus(t, setupUpdateRouter(t), http.StatusServiceUnavailable, http.MethodGet, "/api/desktop/app-server/update/darwin-aarch64/1.0.0")
	})

	t.Run("signature missing", func(t *testing.T) {
		t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
		artifactPath := "desktop/app-server/darwin-aarch64/taskforceai-app-server-1.1.0"
		originalClient := newBlobClient
		newBlobClient = func(string) blobClient {
			return &mockBlobClient{listFunc: func(context.Context, vercelblob.ListCommandOptions) (*vercelblob.ListBlobResult, error) {
				return &vercelblob.ListBlobResult{Blobs: []vercelblob.ListBlobResultBlob{
					{PathName: artifactPath},
					{PathName: artifactPath + ".sha256", URL: "https://blob.example/runtime.sha256"},
					{PathName: artifactPath + ".sig", URL: "https://blob.example/runtime.sig"},
				}}, nil
			}}
		}
		t.Cleanup(func() { newBlobClient = originalClient })
		originalHTTP := httpDo
		httpDo = func(request *http.Request) (*http.Response, error) {
			if strings.HasSuffix(request.URL.Path, ".sig") {
				return &http.Response{StatusCode: http.StatusNotFound, Body: io.NopCloser(strings.NewReader("missing"))}, nil
			}
			return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(strings.Repeat("a", 64)))}, nil
		}
		t.Cleanup(func() { httpDo = originalHTTP })

		handlertest.ServeStatus(t, setupUpdateRouter(t), http.StatusServiceUnavailable, http.MethodGet, "/api/desktop/app-server/update/darwin-aarch64/1.0.0")
	})

	t.Run("signature invalid", func(t *testing.T) {
		t.Setenv("BLOB_READ_WRITE_TOKEN", "token")
		artifactPath := "desktop/app-server/darwin-aarch64/taskforceai-app-server-1.1.0"
		originalClient := newBlobClient
		newBlobClient = func(string) blobClient {
			return &mockBlobClient{listFunc: func(context.Context, vercelblob.ListCommandOptions) (*vercelblob.ListBlobResult, error) {
				return &vercelblob.ListBlobResult{Blobs: []vercelblob.ListBlobResultBlob{
					{PathName: artifactPath},
					{PathName: artifactPath + ".sha256", URL: "https://blob.example/runtime.sha256"},
					{PathName: artifactPath + ".sig", URL: "https://blob.example/runtime.sig"},
				}}, nil
			}}
		}
		t.Cleanup(func() { newBlobClient = originalClient })
		originalHTTP := httpDo
		httpDo = func(request *http.Request) (*http.Response, error) {
			content := strings.Repeat("a", 64)
			if strings.HasSuffix(request.URL.Path, ".sig") {
				content = base64.StdEncoding.EncodeToString([]byte("not Minisign"))
			}
			return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(content))}, nil
		}
		t.Cleanup(func() { httpDo = originalHTTP })

		handlertest.ServeStatus(t, setupUpdateRouter(t), http.StatusServiceUnavailable, http.MethodGet, "/api/desktop/app-server/update/darwin-aarch64/1.0.0")
	})
}

func TestListAppServerBlobsPaginates(t *testing.T) {
	requests := 0
	client := &mockBlobClient{listFunc: func(_ context.Context, options vercelblob.ListCommandOptions) (*vercelblob.ListBlobResult, error) {
		requests++
		if options.Cursor == "" {
			return &vercelblob.ListBlobResult{
				Blobs:   []vercelblob.ListBlobResultBlob{{PathName: "first"}},
				HasMore: true,
				Cursor:  "next-page",
			}, nil
		}
		assert.Equal(t, "next-page", options.Cursor)
		return &vercelblob.ListBlobResult{Blobs: []vercelblob.ListBlobResultBlob{{PathName: "second"}}}, nil
	}}

	blobs, err := listAppServerBlobs(context.Background(), client, "darwin-aarch64")
	require.NoError(t, err)
	assert.Equal(t, 2, requests)
	assert.Len(t, blobs, 2)
}

func TestLatestAppServerArtifactChoosesNewestVersionAndUpload(t *testing.T) {
	now := time.Now()
	artifact, version, ok := latestAppServerArtifact([]vercelblob.ListBlobResultBlob{
		{PathName: "desktop/app-server/darwin-aarch64/taskforceai-app-server-invalid", UploadedAt: now},
		{PathName: "desktop/app-server/darwin-aarch64/taskforceai-app-server-invalid.sha256", UploadedAt: now},
		{PathName: "desktop/app-server/darwin-aarch64/taskforceai-app-server-invalid.sig", UploadedAt: now},
		{PathName: "desktop/app-server/darwin-aarch64/taskforceai-app-server-0.9.0", UploadedAt: now},
		{PathName: "desktop/app-server/darwin-aarch64/taskforceai-app-server-0.9.0.sha256", UploadedAt: now},
		{PathName: "desktop/app-server/darwin-aarch64/taskforceai-app-server-1.0.0", URL: "old-version", UploadedAt: now},
		{PathName: "desktop/app-server/darwin-aarch64/taskforceai-app-server-1.1.0", URL: "old-upload", UploadedAt: now},
		{PathName: "desktop/app-server/darwin-aarch64/taskforceai-app-server-1.1.0", URL: "new-upload", UploadedAt: now.Add(time.Minute)},
		{PathName: "desktop/app-server/darwin-aarch64/taskforceai-app-server-1.0.0.sha256"},
		{PathName: "desktop/app-server/darwin-aarch64/taskforceai-app-server-1.0.0.sig"},
		{PathName: "desktop/app-server/darwin-aarch64/taskforceai-app-server-1.1.0.sha256"},
		{PathName: "desktop/app-server/darwin-aarch64/taskforceai-app-server-1.1.0.sig"},
		{PathName: "desktop/app-server/darwin-aarch64/taskforceai-app-server-1.2.0", URL: "incomplete", UploadedAt: now},
		{PathName: "desktop/app-server/darwin-aarch64/taskforceai-app-server-1.2.0.sha256", UploadedAt: now.Add(time.Minute)},
		{PathName: "desktop/app-server/darwin-aarch64/taskforceai-app-server-1.2.0.sig", UploadedAt: now.Add(time.Minute)},
	}, "darwin-aarch64")

	require.True(t, ok)
	assert.Equal(t, "1.1.0", version)
	assert.Equal(t, "new-upload", artifact.URL)
}

func TestFetchAppServerDigestRejectsInvalidResponses(t *testing.T) {
	const artifactPath = "desktop/app-server/darwin-aarch64/taskforceai-app-server-1.1.0"
	const hashURL = "https://blob.example/runtime.sha256"
	blobs := []vercelblob.ListBlobResultBlob{{PathName: artifactPath + ".sha256", URL: hashURL}}

	t.Run("invalid request URL", func(t *testing.T) {
		invalidBlobs := []vercelblob.ListBlobResultBlob{{PathName: artifactPath + ".sha256", URL: ":"}}
		_, err := fetchAppServerDigest(context.Background(), artifactPath, invalidBlobs)
		require.Error(t, err)
	})

	tests := []struct {
		name     string
		response *http.Response
		err      error
	}{
		{name: "transport error", err: errors.New("transport failed")},
		{name: "nil response"},
		{name: "bad status", response: &http.Response{StatusCode: http.StatusBadGateway, Body: io.NopCloser(strings.NewReader("bad gateway"))}},
		{name: "read error", response: &http.Response{StatusCode: http.StatusOK, Body: failingReadCloser{}}},
		{name: "oversized", response: &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(strings.Repeat("a", maxAppServerHashBytes+1)))}},
		{name: "empty", response: &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader("  \n"))}},
		{name: "invalid hex", response: &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(strings.Repeat("z", 64)))}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			originalHTTP := httpDo
			httpDo = func(*http.Request) (*http.Response, error) { return test.response, test.err }
			t.Cleanup(func() { httpDo = originalHTTP })

			_, err := fetchAppServerDigest(context.Background(), artifactPath, blobs)
			require.Error(t, err)
		})
	}

	t.Run("missing hash blob", func(t *testing.T) {
		_, err := fetchAppServerDigest(context.Background(), artifactPath, nil)
		require.ErrorContains(t, err, "not found")
	})

	t.Run("normalizes uppercase digest", func(t *testing.T) {
		originalHTTP := httpDo
		httpDo = func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(strings.Repeat("A", 64) + "  runtime"))}, nil
		}
		t.Cleanup(func() { httpDo = originalHTTP })

		digest, err := fetchAppServerDigest(context.Background(), artifactPath, blobs)
		require.NoError(t, err)
		assert.Equal(t, strings.Repeat("a", 64), digest)
	})
}

func TestValidSHA256RejectsInvalidLengthAndCharacters(t *testing.T) {
	assert.False(t, validSHA256("short"))
	assert.False(t, validSHA256(strings.Repeat("g", 64)))
	assert.True(t, validSHA256(strings.Repeat("f", 64)))
}
