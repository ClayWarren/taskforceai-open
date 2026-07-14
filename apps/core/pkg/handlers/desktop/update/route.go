package update

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/danielgtaylor/huma/v2"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"

	vercelblob "github.com/claywarren/vercel_blob"
)

const desktopUpdateCacheTTL = 5 * time.Minute

type blobClient interface {
	List(ctx context.Context, options vercelblob.ListCommandOptions) (*vercelblob.ListBlobResult, error)
}

type updateCache interface {
	Get(ctx context.Context, key string) (string, error)
	Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
}

// envTokenProvider implements vercelblob.TokenProvider
type envTokenProvider struct {
	token string
}

func (p *envTokenProvider) GetToken(operation, pathname string) (string, error) {
	return p.token, nil
}

var newBlobClient = func(token string) blobClient {
	return vercelblob.NewClientExternal(&envTokenProvider{token: token})
}

var getUpdateCache = func() (updateCache, error) {
	return infraredis.GetClient()
}

var desktopUpdateHTTPClient = &http.Client{
	Transport: otelhttp.NewTransport(http.DefaultTransport),
	Timeout:   10 * time.Second,
}

var httpDo = func(req *http.Request) (*http.Response, error) {
	return desktopUpdateHTTPClient.Do(req)
}

var buildDesktopUpdateResponse = desktopUpdateResponseFromLatest
var marshalCachedDesktopUpdate = json.Marshal

var errDesktopUpdateNotAvailable = errors.New("desktop update not available")
var compareDesktopVersions = compareVersions

var requestVersionPattern = regexp.MustCompile(`^v?[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$`)

var artifactNameSuffixes = []string{
	".app.tar.gz",
	".appimage.tar.gz",
	".msi.zip",
	".appimage",
	".dmg",
	".exe",
	".msi",
	".deb",
	".rpm",
}

var artifactArchSuffixes = []string{
	"-aarch64",
	"-arm64",
	"-x86_64",
	"-amd64",
	"-x64",
}

type UpdateResponse struct {
	Version   string                    `json:"version" doc:"Latest available version"`
	Notes     string                    `json:"notes" doc:"Release notes"`
	PubDate   string                    `json:"pub_date" doc:"Publication date"`
	URL       string                    `json:"url" doc:"Download URL for dynamic updater clients"`
	Signature string                    `json:"signature" doc:"Signature for dynamic updater clients"`
	Platforms map[string]PlatformUpdate `json:"platforms" doc:"Platform specific update info"`
}

type PlatformUpdate struct {
	Signature string `json:"signature" doc:"Signature for verification"`
	URL       string `json:"url" doc:"Download URL"`
}

type updateOutput struct {
	Status int
	Body   *UpdateResponse
}

type cachedDesktopUpdate struct {
	Target    string `json:"target"`
	Version   string `json:"version"`
	PubDate   string `json:"pubDate"`
	URL       string `json:"url"`
	Signature string `json:"signature"`
	PathName  string `json:"pathName"`
}

// RegisterHandlers registers the desktop update handlers.
func RegisterHandlers(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-desktop-update",
		Method:      http.MethodGet,
		Path:        "/api/desktop/update/{target}/{version}",
		Summary:     "Get latest desktop update",
		Tags:        []string{"Desktop"},
	}, func(ctx context.Context, input *struct {
		Target  string `path:"target"`
		Version string `path:"version"`
	}) (*updateOutput, error) {
		target, ok := normalizeUpdateTarget(input.Target)
		if !ok {
			slog.Warn("Desktop update requested for unsupported target", "target", input.Target, "version", input.Version)
			return nil, huma.Error404NotFound("Unsupported target")
		}

		currentVersion, err := normalizeVersion(input.Version)
		if err != nil {
			slog.Warn("Desktop update requested with invalid version", "target", target, "version", input.Version)
			return nil, huma.Error422UnprocessableEntity(err.Error())
		}

		token := os.Getenv("BLOB_READ_WRITE_TOKEN")
		if token == "" {
			slog.Error("Desktop update unavailable: blob token missing", "target", target, "version", currentVersion)
			return nil, huma.Error500InternalServerError("Server not configured")
		}

		if cached, cacheOK := loadCachedDesktopUpdate(ctx, target); cacheOK {
			response, responseErr := buildDesktopUpdateResponse(target, currentVersion, cached)
			if errors.Is(responseErr, errDesktopUpdateNotAvailable) {
				return &updateOutput{Status: http.StatusNoContent}, nil
			}
			if responseErr != nil {
				return nil, responseErr
			}
			slog.Info("Desktop update served from cache", "target", target, "currentVersion", currentVersion, "latestVersion", cached.Version, "artifact", cached.PathName)
			return &updateOutput{Status: http.StatusOK, Body: response}, nil
		}

		client := newBlobClient(token)
		blobs, err := listAllDesktopBlobs(ctx, client)
		if err != nil {
			slog.Error("Desktop update list failed", "target", target, "version", currentVersion, "error", err)
			return nil, huma.Error500InternalServerError("Failed to fetch updates")
		}

		if len(blobs) == 0 {
			slog.Warn("Desktop update requested but no blobs are available", "target", target, "version", currentVersion)
			return nil, huma.Error404NotFound("No updates found")
		}

		latest, latestVersion, found := latestArtifactForTarget(blobs, target)
		if !found {
			slog.Warn("Desktop update requested but no target artifact was found", "target", target, "version", currentVersion, "blobCount", len(blobs))
			return nil, huma.Error404NotFound("No updates found for target")
		}

		signature := fetchSignature(ctx, latest.PathName, blobs)
		if strings.TrimSpace(signature) == "" {
			slog.Error("Desktop update signature unavailable", "target", target, "version", latestVersion, "artifact", latest.PathName)
			return nil, huma.Error503ServiceUnavailable("Update signature unavailable")
		}
		latestUpdate := cachedDesktopUpdate{
			Target:    target,
			Version:   latestVersion,
			PubDate:   latest.UploadedAt.UTC().Format(time.RFC3339),
			URL:       latest.URL,
			Signature: signature,
			PathName:  latest.PathName,
		}
		storeCachedDesktopUpdate(ctx, latestUpdate)

		update, responseErr := buildDesktopUpdateResponse(target, currentVersion, latestUpdate)
		if errors.Is(responseErr, errDesktopUpdateNotAvailable) {
			slog.Info("Desktop update not available", "target", target, "currentVersion", currentVersion, "latestVersion", latestVersion)
			return &updateOutput{Status: http.StatusNoContent}, nil
		}
		if responseErr != nil {
			return nil, responseErr
		}

		slog.Info("Desktop update served", "target", target, "currentVersion", currentVersion, "latestVersion", latestVersion, "artifact", latest.PathName)
		return &updateOutput{Status: http.StatusOK, Body: update}, nil
	})
	registerAppServerUpdateHandler(api)
}

func desktopUpdateResponseFromLatest(target, currentVersion string, latest cachedDesktopUpdate) (*UpdateResponse, error) {
	latest = canonicalizeCachedDesktopUpdate(latest)
	cmp, cmpErr := compareDesktopVersions(latest.Version, currentVersion)
	if cmpErr != nil {
		slog.Error("Desktop update version comparison failed", "target", target, "currentVersion", currentVersion, "latestVersion", latest.Version, "error", cmpErr)
		return nil, huma.Error500InternalServerError("Failed to compare versions")
	}
	if cmp <= 0 {
		return nil, errDesktopUpdateNotAvailable
	}

	update := &UpdateResponse{
		Version:   latest.Version,
		Notes:     "Bug fixes and performance improvements",
		PubDate:   latest.PubDate,
		URL:       latest.URL,
		Signature: latest.Signature,
		Platforms: make(map[string]PlatformUpdate),
	}
	addPlatformUpdateFromCached(update, target, latest)
	return update, nil
}

func addPlatformUpdateFromCached(update *UpdateResponse, platform string, latest cachedDesktopUpdate) {
	update.Platforms[platform] = PlatformUpdate{
		Signature: latest.Signature,
		URL:       latest.URL,
	}
}

func desktopUpdateCacheKey(target string) string {
	return "desktop:update:latest:" + target
}

func loadCachedDesktopUpdate(ctx context.Context, target string) (cachedDesktopUpdate, bool) {
	cache, err := getUpdateCache()
	if err != nil || cache == nil {
		if err != nil {
			slog.Debug("Desktop update cache unavailable", "target", target, "error", err)
		}
		return cachedDesktopUpdate{}, false
	}
	raw, err := cache.Get(ctx, desktopUpdateCacheKey(target))
	if err != nil {
		if !errors.Is(err, infraredis.ErrKeyNotFound) {
			slog.Warn("Desktop update cache read failed", "target", target, "error", err)
		}
		return cachedDesktopUpdate{}, false
	}
	var cached cachedDesktopUpdate
	if err := json.Unmarshal([]byte(raw), &cached); err != nil {
		slog.Warn("Desktop update cache payload invalid", "target", target, "error", err)
		return cachedDesktopUpdate{}, false
	}
	if cached.Target != target || cached.Version == "" || cached.URL == "" || strings.TrimSpace(cached.Signature) == "" {
		slog.Warn("Desktop update cache payload incomplete", "target", target, "cachedTarget", cached.Target, "version", cached.Version)
		return cachedDesktopUpdate{}, false
	}
	if cached.PathName != "" {
		platform, ok := artifactPlatform(cached.PathName)
		if !ok || platform != target {
			slog.Warn("Desktop update cache target mismatch", "target", target, "cachedTarget", cached.Target, "artifact", cached.PathName, "artifactPlatform", platform)
			return cachedDesktopUpdate{}, false
		}
	}
	return cached, true
}

func storeCachedDesktopUpdate(ctx context.Context, latest cachedDesktopUpdate) {
	cache, err := getUpdateCache()
	if err != nil || cache == nil {
		if err != nil {
			slog.Debug("Desktop update cache unavailable for write", "target", latest.Target, "error", err)
		}
		return
	}
	data, err := marshalCachedDesktopUpdate(latest)
	if err != nil {
		slog.Warn("Desktop update cache payload encoding failed", "target", latest.Target, "error", err)
		return
	}
	if err := cache.Set(ctx, desktopUpdateCacheKey(latest.Target), data, desktopUpdateCacheTTL); err != nil {
		slog.Warn("Desktop update cache write failed", "target", latest.Target, "error", err)
	}
}

func listAllDesktopBlobs(ctx context.Context, client blobClient) ([]vercelblob.ListBlobResultBlob, error) {
	var blobs []vercelblob.ListBlobResultBlob
	cursor := ""
	for {
		listRes, err := client.List(ctx, vercelblob.ListCommandOptions{
			Prefix: "desktop/",
			Cursor: cursor,
		})
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

func fetchSignature(ctx context.Context, pathName string, allBlobs []vercelblob.ListBlobResultBlob) string {
	sigPath := pathName + ".sig"
	for _, b := range allBlobs {
		if b.PathName == sigPath {
			req, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, b.URL, nil)
			if reqErr != nil {
				return ""
			}
			resp, err := httpDo(req)
			if err != nil {
				slog.Error("Failed to fetch signature", "blobURL", b.URL, "error", err)
				return ""
			}
			if resp == nil {
				slog.Error("HTTP client returned nil response", "blobURL", b.URL)
				return ""
			}
			defer resp.Body.Close()

			content, readErr := io.ReadAll(resp.Body)
			if readErr != nil || resp.StatusCode < 200 || resp.StatusCode >= 300 {
				slog.Error("Failed to read signature body or unexpected status", "blobURL", b.URL, "statusCode", resp.StatusCode)
				return ""
			}
			return string(content)
		}
	}
	return ""
}

func extractArtifactVersion(pathName string) (string, bool) {
	base := filepath.Base(pathName)
	normalizedBase := strings.ToLower(base)
	if strings.HasSuffix(normalizedBase, ".sig") {
		base = base[:len(base)-len(".sig")]
		normalizedBase = normalizedBase[:len(normalizedBase)-len(".sig")]
	}
	for _, suffix := range artifactNameSuffixes {
		if strings.HasSuffix(normalizedBase, suffix) {
			base = base[:len(base)-len(suffix)]
			break
		}
	}

	_, version, ok := strings.Cut(base, "-")
	if !ok {
		return "", false
	}

	for _, suffix := range artifactArchSuffixes {
		version = strings.TrimSuffix(version, suffix)
	}

	normalized, err := normalizeVersion(version)
	if err != nil {
		return "", false
	}
	return normalized, true
}

func canonicalizeCachedDesktopUpdate(latest cachedDesktopUpdate) cachedDesktopUpdate {
	if version, ok := extractArtifactVersion(latest.PathName); ok {
		latest.Version = version
	}
	return latest
}

func normalizeUpdateTarget(target string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(target)) {
	case "windows", "windows-x86_64":
		return "windows-x86_64", true
	case "windows-aarch64", "windows-arm64":
		return "windows-aarch64", true
	case "linux", "linux-x86_64", "linux-x64", "linux-amd64":
		return "linux-x86_64", true
	case "linux-aarch64", "linux-arm64":
		return "linux-aarch64", true
	case "darwin", "macos", "darwin-x86_64", "macos-x64", "macos-x86_64":
		return "darwin-x86_64", true
	case "darwin-aarch64", "darwin-arm64", "macos-arm64", "macos-aarch64":
		return "darwin-aarch64", true
	default:
		return "", false
	}
}

func normalizeVersion(version string) (string, error) {
	version = strings.TrimSpace(version)
	if !requestVersionPattern.MatchString(version) {
		return "", fmt.Errorf("invalid version format")
	}
	return strings.TrimPrefix(version, "v"), nil
}

func artifactPlatform(pathName string) (string, bool) {
	normalizedPath := strings.ToLower(filepath.ToSlash(pathName))
	switch {
	case strings.HasSuffix(normalizedPath, ".msi.zip") || strings.HasSuffix(normalizedPath, ".msi"):
		if strings.Contains(normalizedPath, "arm64") || strings.Contains(normalizedPath, "aarch64") {
			return "windows-aarch64", true
		}
		return "windows-x86_64", true
	case strings.HasSuffix(normalizedPath, ".appimage.tar.gz") || strings.HasSuffix(normalizedPath, ".appimage"):
		return linuxArtifactPlatform(normalizedPath)
	case strings.Contains(normalizedPath, "macos") && strings.HasSuffix(normalizedPath, ".app.tar.gz"):
		if strings.Contains(normalizedPath, "arm64") || strings.Contains(normalizedPath, "aarch64") {
			return "darwin-aarch64", true
		}
		return "darwin-x86_64", true
	default:
		return "", false
	}
}

func linuxArtifactPlatform(pathName string) (string, bool) {
	baseName := filepath.Base(pathName)
	switch {
	case strings.HasPrefix(pathName, "desktop/linux-arm64/") ||
		strings.HasPrefix(pathName, "desktop/linux-aarch64/") ||
		strings.Contains(baseName, "arm64") ||
		strings.Contains(baseName, "aarch64"):
		return "linux-aarch64", true
	case strings.HasPrefix(pathName, "desktop/linux/") ||
		strings.Contains(baseName, "x86_64") ||
		strings.Contains(baseName, "amd64") ||
		strings.Contains(baseName, "x64"):
		return "linux-x86_64", true
	default:
		return "", false
	}
}

func latestArtifactForTarget(blobs []vercelblob.ListBlobResultBlob, target string) (vercelblob.ListBlobResultBlob, string, bool) {
	var latest vercelblob.ListBlobResultBlob
	latestVersion := ""
	found := false

	for _, blob := range blobs {
		version, ok := extractArtifactVersion(blob.PathName)
		if !ok {
			continue
		}
		platform, ok := artifactPlatform(blob.PathName)
		if !ok || platform != target {
			continue
		}

		if !found {
			latest = blob
			latestVersion = version
			found = true
			continue
		}

		cmp, err := compareDesktopVersions(version, latestVersion)
		if err != nil {
			continue
		}
		if cmp > 0 || (cmp == 0 && blob.UploadedAt.After(latest.UploadedAt)) {
			latest = blob
			latestVersion = version
		}
	}

	return latest, latestVersion, found
}

type parsedVersion struct {
	major      int
	minor      int
	patch      int
	preRelease []string
}

func parseVersion(version string) (parsedVersion, error) {
	cleaned, err := normalizeVersion(version)
	if err != nil {
		return parsedVersion{}, err
	}

	mainPart := cleaned
	preRelease := ""
	if idx := strings.Index(mainPart, "+"); idx >= 0 {
		mainPart = mainPart[:idx]
	}
	if idx := strings.Index(mainPart, "-"); idx >= 0 {
		preRelease = mainPart[idx+1:]
		mainPart = mainPart[:idx]
	}

	coreParts := strings.Split(mainPart, ".")
	major, _ := strconv.Atoi(coreParts[0])
	minor, _ := strconv.Atoi(coreParts[1])
	patch, _ := strconv.Atoi(coreParts[2])

	parsed := parsedVersion{
		major: major,
		minor: minor,
		patch: patch,
	}
	if preRelease != "" {
		parsed.preRelease = strings.Split(preRelease, ".")
	}
	return parsed, nil
}

func compareVersions(a, b string) (int, error) {
	parsedA, err := parseVersion(a)
	if err != nil {
		return 0, err
	}
	parsedB, err := parseVersion(b)
	if err != nil {
		return 0, err
	}

	if parsedA.major != parsedB.major {
		if parsedA.major > parsedB.major {
			return 1, nil
		}
		return -1, nil
	}
	if parsedA.minor != parsedB.minor {
		if parsedA.minor > parsedB.minor {
			return 1, nil
		}
		return -1, nil
	}
	if parsedA.patch != parsedB.patch {
		if parsedA.patch > parsedB.patch {
			return 1, nil
		}
		return -1, nil
	}

	return comparePreRelease(parsedA.preRelease, parsedB.preRelease), nil
}

func comparePreRelease(a, b []string) int {
	if len(a) == 0 && len(b) == 0 {
		return 0
	}
	if len(a) == 0 {
		return 1
	}
	if len(b) == 0 {
		return -1
	}

	minLen := min(len(b), len(a))
	for i := 0; i < minLen; i++ {
		aNum, aNumErr := strconv.Atoi(a[i])
		bNum, bNumErr := strconv.Atoi(b[i])
		switch {
		case aNumErr == nil && bNumErr == nil:
			if aNum > bNum {
				return 1
			}
			if aNum < bNum {
				return -1
			}
		case aNumErr == nil && bNumErr != nil:
			return -1
		case aNumErr != nil && bNumErr == nil:
			return 1
		default:
			if a[i] > b[i] {
				return 1
			}
			if a[i] < b[i] {
				return -1
			}
		}
	}

	if len(a) > len(b) {
		return 1
	}
	if len(a) < len(b) {
		return -1
	}
	return 0
}
