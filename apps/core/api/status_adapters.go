package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/TaskForceAI/core/pkg/platform"
	adminpkg "github.com/TaskForceAI/go-core/pkg/admin"
	vercelblob "github.com/claywarren/vercel_blob"
)

type statusBlobPublisher struct {
	token     string
	marshal   func(any, string, string) ([]byte, error)
	newClient func(string) statusBlobPutter
}

type adminStatusSource struct {
	repo adminpkg.AdminIncidentsRepository
}

func (s adminStatusSource) ListStatusIncidents(ctx context.Context, limit int) ([]platform.StatusIncidentRecord, error) {
	incidents, err := s.repo.ListIncidents(ctx, limit)
	if err != nil {
		return nil, err
	}

	records := make([]platform.StatusIncidentRecord, 0, len(incidents))
	for _, incident := range incidents {
		if incident.StartedAt == nil {
			continue
		}
		records = append(records, platform.StatusIncidentRecord{
			ID:         strconv.Itoa(incident.ID),
			ServiceID:  incident.ServiceID,
			Status:     incident.Status,
			Message:    incident.Message,
			StartedAt:  incident.StartedAt.UTC(),
			ResolvedAt: incident.ResolvedAt,
		})
	}
	return records, nil
}

type statusBlobPutter interface {
	Put(ctx context.Context, pathname string, body io.Reader, options vercelblob.PutCommandOptions) (*vercelblob.PutBlobPutResult, error)
}

const vercelBlobRESTBaseURL = "https://api.vercel.com/v1/blob"

type vercelStatusBlobPutter struct {
	token   string
	baseURL string
	client  *http.Client
}

func (p vercelStatusBlobPutter) Put(
	ctx context.Context,
	pathname string,
	body io.Reader,
	options vercelblob.PutCommandOptions,
) (*vercelblob.PutBlobPutResult, error) {
	if strings.TrimSpace(pathname) == "" {
		return nil, errors.New("blob pathname is required")
	}
	baseURL := strings.TrimRight(p.baseURL, "/")
	if baseURL == "" {
		baseURL = vercelBlobRESTBaseURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, baseURL+"/"+url.PathEscape(pathname), body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+p.token)
	if options.ContentType != "" {
		req.Header.Set("Content-Type", options.ContentType)
	}
	if !options.AddRandomSuffix {
		req.Header.Set("X-Add-Random-Suffix", "0")
	}
	if options.CacheControlMaxAge > 0 {
		req.Header.Set("X-Cache-Control-Max-Age", strconv.FormatUint(options.CacheControlMaxAge, 10))
	}

	client := p.client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		errorBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("blob API returned %d: %s", resp.StatusCode, strings.TrimSpace(string(errorBody)))
	}

	var result vercelblob.PutBlobPutResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode blob response: %w", err)
	}
	return &result, nil
}

func newStatusPublisherFromEnv() platform.StatusPublisher {
	return statusBlobPublisher{token: strings.TrimSpace(os.Getenv("BLOB_READ_WRITE_TOKEN"))}
}

func (p statusBlobPublisher) PublishStatus(ctx context.Context, status platform.StatusResponse) error {
	marshal := p.marshal
	if marshal == nil {
		marshal = json.MarshalIndent
	}
	jsonData, err := marshal(status, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal status: %w", err)
	}

	if p.token == "" {
		return errors.New("BLOB_READ_WRITE_TOKEN not set")
	}

	newClient := p.newClient
	if newClient == nil {
		newClient = func(token string) statusBlobPutter {
			return vercelStatusBlobPutter{token: token}
		}
	}

	putRes, err := newClient(p.token).Put(ctx, "status.json", bytes.NewReader(jsonData), vercelblob.PutCommandOptions{
		ContentType:        "application/json",
		AddRandomSuffix:    false,
		CacheControlMaxAge: 60,
	})
	if err != nil {
		return fmt.Errorf("failed to upload to blob: %w", err)
	}

	slog.Info("Successfully published system status to Vercel Blob", "url", putRes.URL)
	return nil
}
