package update

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	vercelblob "github.com/claywarren/vercel_blob"
	"github.com/danielgtaylor/huma/v2"
)

const appServerProtocolVersion = "2026-05-23"
const maxAppServerHashBytes = 1024

var compareAppServerVersions = compareVersions

type AppServerUpdateResponse struct {
	Version         string `json:"version" doc:"Latest available app-server version"`
	ProtocolVersion string `json:"protocolVersion" doc:"Compatible desktop app-server protocol version"`
	URL             string `json:"url" doc:"Signed app-server binary download URL"`
	SHA256          string `json:"sha256" doc:"Hex encoded SHA-256 digest"`
	Signature       string `json:"signature" doc:"Minisign release signature"`
	PubDate         string `json:"pubDate" doc:"Publication date"`
}

type appServerUpdateOutput struct {
	Status int
	Body   *AppServerUpdateResponse
}

func registerAppServerUpdateHandler(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-desktop-app-server-update",
		Method:      http.MethodGet,
		Path:        "/api/desktop/app-server/update/{target}/{version}",
		Summary:     "Get latest compatible desktop app-server update",
		Tags:        []string{"Desktop"},
	}, func(ctx context.Context, input *struct {
		Target  string `path:"target"`
		Version string `path:"version"`
	}) (*appServerUpdateOutput, error) {
		target, ok := normalizeUpdateTarget(input.Target)
		if !ok {
			return nil, huma.Error404NotFound("Unsupported target")
		}
		currentVersion, err := normalizeVersion(input.Version)
		if err != nil {
			return nil, huma.Error422UnprocessableEntity(err.Error())
		}
		token := os.Getenv("BLOB_READ_WRITE_TOKEN")
		if token == "" {
			return nil, huma.Error500InternalServerError("Server not configured")
		}

		blobs, err := listAppServerBlobs(ctx, newBlobClient(token), target)
		if err != nil {
			slog.Error("App-server update list failed", "target", target, "version", currentVersion, "error", err)
			return nil, huma.Error500InternalServerError("Failed to fetch app-server updates")
		}
		artifact, latestVersion, ok := latestAppServerArtifact(blobs, target)
		if !ok {
			return nil, huma.Error404NotFound("No app-server updates found for target")
		}
		comparison, err := compareAppServerVersions(latestVersion, currentVersion)
		if err != nil {
			return nil, huma.Error500InternalServerError("Failed to compare app-server versions")
		}
		if comparison <= 0 {
			return &appServerUpdateOutput{Status: http.StatusNoContent}, nil
		}
		digest, err := fetchAppServerDigest(ctx, artifact.PathName, blobs)
		if err != nil {
			slog.Error("App-server update digest unavailable", "target", target, "version", latestVersion, "error", err)
			return nil, huma.Error503ServiceUnavailable("App-server update digest unavailable")
		}
		encodedSignature := fetchSignature(ctx, artifact.PathName, blobs)
		if strings.TrimSpace(encodedSignature) == "" {
			return nil, huma.Error503ServiceUnavailable("App-server update signature unavailable")
		}
		signature, err := decodeAppServerSignature(encodedSignature)
		if err != nil {
			slog.Error("App-server update signature invalid", "target", target, "version", latestVersion, "error", err)
			return nil, huma.Error503ServiceUnavailable("App-server update signature invalid")
		}
		return &appServerUpdateOutput{
			Status: http.StatusOK,
			Body: &AppServerUpdateResponse{
				Version:         latestVersion,
				ProtocolVersion: appServerProtocolVersion,
				URL:             artifact.URL,
				SHA256:          digest,
				Signature:       signature,
				PubDate:         artifact.UploadedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
			},
		}, nil
	})
}

func decodeAppServerSignature(value string) (string, error) {
	value = strings.TrimSpace(value)
	if strings.HasPrefix(value, "untrusted comment:") {
		return value, nil
	}
	decoded, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return "", fmt.Errorf("decode signature: %w", err)
	}
	signature := strings.TrimSpace(string(decoded))
	if !strings.HasPrefix(signature, "untrusted comment:") {
		return "", fmt.Errorf("decoded signature is not Minisign data")
	}
	return signature, nil
}

func listAppServerBlobs(ctx context.Context, client blobClient, target string) ([]vercelblob.ListBlobResultBlob, error) {
	prefix := fmt.Sprintf("desktop/app-server/%s/", target)
	var blobs []vercelblob.ListBlobResultBlob
	cursor := ""
	for {
		page, err := client.List(ctx, vercelblob.ListCommandOptions{Prefix: prefix, Cursor: cursor})
		if err != nil {
			return nil, err
		}
		blobs = append(blobs, page.Blobs...)
		if !page.HasMore || page.Cursor == "" {
			return blobs, nil
		}
		cursor = page.Cursor
	}
}

func latestAppServerArtifact(blobs []vercelblob.ListBlobResultBlob, target string) (vercelblob.ListBlobResultBlob, string, bool) {
	prefix := fmt.Sprintf("desktop/app-server/%s/taskforceai-app-server-", target)
	availableBlobs := make(map[string]vercelblob.ListBlobResultBlob, len(blobs))
	for _, blob := range blobs {
		availableBlobs[blob.PathName] = blob
	}
	var latest vercelblob.ListBlobResultBlob
	latestVersion := ""
	for _, blob := range blobs {
		if !strings.HasPrefix(blob.PathName, prefix) || strings.HasSuffix(blob.PathName, ".sha256") {
			continue
		}
		digest, ok := availableBlobs[blob.PathName+".sha256"]
		if !ok || blob.UploadedAt.Before(digest.UploadedAt) {
			continue
		}
		signature, ok := availableBlobs[blob.PathName+".sig"]
		if !ok || blob.UploadedAt.Before(signature.UploadedAt) {
			continue
		}
		version := strings.TrimPrefix(blob.PathName, prefix)
		normalized, err := normalizeVersion(version)
		if err != nil {
			continue
		}
		if latestVersion == "" {
			latest, latestVersion = blob, normalized
			continue
		}
		comparison, err := compareVersions(normalized, latestVersion)
		if err == nil && (comparison > 0 || comparison == 0 && blob.UploadedAt.After(latest.UploadedAt)) {
			latest, latestVersion = blob, normalized
		}
	}
	return latest, latestVersion, latestVersion != ""
}

func fetchAppServerDigest(ctx context.Context, artifactPath string, blobs []vercelblob.ListBlobResultBlob) (string, error) {
	hashPath := artifactPath + ".sha256"
	for _, blob := range blobs {
		if blob.PathName != hashPath {
			continue
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, blob.URL, nil)
		if err != nil {
			return "", err
		}
		response, err := httpDo(req)
		if err != nil {
			return "", err
		}
		if response == nil {
			return "", fmt.Errorf("hash endpoint returned no response")
		}
		defer response.Body.Close()
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			return "", fmt.Errorf("hash endpoint returned status %d", response.StatusCode)
		}
		content, err := io.ReadAll(io.LimitReader(response.Body, maxAppServerHashBytes+1))
		if err != nil {
			return "", err
		}
		if len(content) > maxAppServerHashBytes {
			return "", fmt.Errorf("hash response exceeded size limit")
		}
		digest := strings.Fields(string(content))
		if len(digest) == 0 || !validSHA256(digest[0]) {
			return "", fmt.Errorf("hash response was invalid")
		}
		return strings.ToLower(digest[0]), nil
	}
	return "", fmt.Errorf("hash blob %s not found", filepath.Base(hashPath))
}

func validSHA256(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, char := range value {
		if !strings.ContainsRune("0123456789abcdefABCDEF", char) {
			return false
		}
	}
	return true
}
