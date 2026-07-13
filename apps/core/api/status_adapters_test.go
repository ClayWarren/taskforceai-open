package handler

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/core/pkg/platform"
	adminpkg "github.com/TaskForceAI/go-core/pkg/admin"
	vercelblob "github.com/claywarren/vercel_blob"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type statusIncidentsRepoStub struct {
	incidents []adminpkg.AdminIncident
	err       error
}

func (s statusIncidentsRepoStub) CreateIncident(context.Context, string, string, string) error {
	return nil
}

func (s statusIncidentsRepoStub) ListIncidents(context.Context, int) ([]adminpkg.AdminIncident, error) {
	return s.incidents, s.err
}

type fakeStatusBlobPutter struct {
	err      error
	pathname string
	body     string
	options  vercelblob.PutCommandOptions
}

func (f *fakeStatusBlobPutter) Put(_ context.Context, pathname string, body io.Reader, options vercelblob.PutCommandOptions) (*vercelblob.PutBlobPutResult, error) {
	f.pathname = pathname
	f.options = options
	data, _ := io.ReadAll(body)
	f.body = string(data)
	if f.err != nil {
		return nil, f.err
	}
	return &vercelblob.PutBlobPutResult{URL: "https://blob.test/status.json"}, nil
}

func TestStatusBlobPublisher(t *testing.T) {
	status := platform.StatusResponse{OverallStatus: platform.ServiceStatusOperational}

	t.Run("marshal error", func(t *testing.T) {
		publisher := statusBlobPublisher{
			token: "token",
			marshal: func(any, string, string) ([]byte, error) {
				return nil, errors.New("marshal failed")
			},
		}

		err := publisher.PublishStatus(context.Background(), status)

		require.Error(t, err)
		assert.Contains(t, err.Error(), "marshal failed")
	})

	t.Run("missing token", func(t *testing.T) {
		publisher := statusBlobPublisher{}

		err := publisher.PublishStatus(context.Background(), status)

		require.Error(t, err)
		assert.Contains(t, err.Error(), "BLOB_READ_WRITE_TOKEN not set")
	})

	t.Run("upload error", func(t *testing.T) {
		expected := errors.New("upload failed")
		publisher := statusBlobPublisher{
			token: "token",
			newClient: func(string) statusBlobPutter {
				return &fakeStatusBlobPutter{err: expected}
			},
		}

		err := publisher.PublishStatus(context.Background(), status)

		require.ErrorIs(t, err, expected)
	})

	t.Run("success", func(t *testing.T) {
		putter := &fakeStatusBlobPutter{}
		publisher := statusBlobPublisher{
			token: "token",
			newClient: func(token string) statusBlobPutter {
				assert.Equal(t, "token", token)
				return putter
			},
		}

		err := publisher.PublishStatus(context.Background(), status)

		require.NoError(t, err)
		assert.Equal(t, "status.json", putter.pathname)
		assert.Contains(t, putter.body, `"overallStatus": "operational"`)
		assert.Equal(t, "application/json", putter.options.ContentType)
		assert.False(t, putter.options.AddRandomSuffix)
		assert.Equal(t, uint64(60), putter.options.CacheControlMaxAge)
	})
}

func TestVercelStatusBlobPutterUsesRESTUploadContract(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPut, r.Method)
		assert.Equal(t, "/v1/blob/status.json", r.URL.Path)
		assert.Equal(t, "Bearer blob-token", r.Header.Get("Authorization"))
		assert.Equal(t, "application/json", r.Header.Get("Content-Type"))
		assert.Equal(t, "0", r.Header.Get("x-add-random-suffix"))
		assert.Equal(t, "60", r.Header.Get("x-cache-control-max-age"))
		_, _ = w.Write([]byte(`{"url":"https://blob.test/status.json","pathname":"status.json"}`))
	}))
	t.Cleanup(server.Close)

	putter := vercelStatusBlobPutter{
		token:   "blob-token",
		baseURL: server.URL + "/v1/blob",
		client:  server.Client(),
	}
	result, err := putter.Put(
		context.Background(),
		"status.json",
		strings.NewReader(`{"overallStatus":"operational"}`),
		vercelblob.PutCommandOptions{
			ContentType:        "application/json",
			CacheControlMaxAge: 60,
		},
	)

	require.NoError(t, err)
	assert.Equal(t, "https://blob.test/status.json", result.URL)
}

func TestVercelStatusBlobPutterErrorPaths(t *testing.T) {
	t.Run("missing pathname", func(t *testing.T) {
		_, err := (vercelStatusBlobPutter{}).Put(
			context.Background(), "", strings.NewReader("{}"), vercelblob.PutCommandOptions{},
		)
		require.ErrorContains(t, err, "pathname is required")
	})

	t.Run("invalid base URL", func(t *testing.T) {
		_, err := (vercelStatusBlobPutter{baseURL: "://invalid"}).Put(
			context.Background(), "status.json", strings.NewReader("{}"), vercelblob.PutCommandOptions{},
		)
		require.Error(t, err)
	})

	t.Run("API error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "invalid pathname", http.StatusBadRequest)
		}))
		t.Cleanup(server.Close)
		_, err := (vercelStatusBlobPutter{baseURL: server.URL, client: server.Client()}).Put(
			context.Background(), "status.json", strings.NewReader("{}"), vercelblob.PutCommandOptions{},
		)
		require.ErrorContains(t, err, "blob API returned 400: invalid pathname")
	})

	t.Run("invalid API response", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte("not JSON"))
		}))
		t.Cleanup(server.Close)
		_, err := (vercelStatusBlobPutter{baseURL: server.URL, client: server.Client()}).Put(
			context.Background(), "status.json", strings.NewReader("{}"), vercelblob.PutCommandOptions{},
		)
		require.ErrorContains(t, err, "decode blob response")
	})
}

func TestAdminStatusSourceMapsPersistedIncidents(t *testing.T) {
	startedAt := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	source := adminStatusSource{repo: statusIncidentsRepoStub{incidents: []adminpkg.AdminIncident{
		{ID: 9, ServiceID: "api", Status: "outage", Message: "down", StartedAt: &startedAt},
		{ID: 10, ServiceID: "web", Status: "degraded", Message: "missing timestamp"},
	}}}

	records, err := source.ListStatusIncidents(context.Background(), 50)

	require.NoError(t, err)
	require.Len(t, records, 1)
	assert.Equal(t, "9", records[0].ID)
	assert.Equal(t, platform.ServiceStatusOutage, records[0].Status)
}

func TestAdminStatusSourcePropagatesRepositoryErrors(t *testing.T) {
	source := adminStatusSource{repo: statusIncidentsRepoStub{err: errors.New("incidents unavailable")}}

	records, err := source.ListStatusIncidents(context.Background(), 50)

	require.ErrorContains(t, err, "incidents unavailable")
	assert.Nil(t, records)
}
