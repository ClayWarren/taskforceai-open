package get

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/danielgtaylor/huma/v2"

	"github.com/TaskForceAI/core/pkg/platform"
)

// DownloadService defines the minimal interface used by the handler.
type DownloadService interface {
	ResolveDownload(ctx context.Context, product, platform, version string) (string, error)
	RecordDownload(ctx context.Context, data platform.DownloadLogInput) error
}

type requestInfo struct {
	ForwardedFor string
	RemoteAddr   string
	UserAgent    string
	Referer      string
}

func (r *requestInfo) Resolve(ctx huma.Context) []error {
	r.ForwardedFor = ctx.Header("X-Forwarded-For")
	r.RemoteAddr = ctx.RemoteAddr()
	r.UserAgent = ctx.Header("User-Agent")
	r.Referer = ctx.Header("Referer")
	return nil
}

// RedirectResponse represents a 302 Found redirect.
type RedirectResponse struct {
	Location string `header:"Location"`
	Status   int    `status:"302"`
}

// RegisterHandlers registers the download handlers.
func RegisterHandlers(api huma.API, svc DownloadService) {
	huma.Register(api, huma.Operation{
		OperationID: "download-product",
		Method:      http.MethodGet,
		Path:        "/api/download/{product}/{platform}/{version}",
		Summary:     "Download product binary",
		Tags:        []string{"Download"},
	}, func(ctx context.Context, input *struct {
		Product  string `path:"product"`
		Platform string `path:"platform"`
		Version  string `path:"version"`
		requestInfo
	}) (*RedirectResponse, error) {
		blobURL, err := svc.ResolveDownload(ctx, input.Product, input.Platform, input.Version)
		if err != nil {
			switch {
			case errors.Is(err, platform.ErrInvalidDownloadRequest):
				slog.Warn("Invalid download request", "product", input.Product, "platform", input.Platform, "version", input.Version)
				return nil, huma.Error400BadRequest(err.Error())
			case errors.Is(err, platform.ErrDownloadNotFound):
				slog.Warn("Download artifact not found", "product", input.Product, "platform", input.Platform, "version", input.Version)
				return nil, huma.Error404NotFound("Not found")
			case errors.Is(err, platform.ErrDownloadServiceUnavailable):
				slog.Error("Download resolution unavailable", "product", input.Product, "platform", input.Platform, "version", input.Version, "error", err)
				return nil, huma.Error500InternalServerError("Download service unavailable")
			default:
				slog.Error("Download resolution failed", "product", input.Product, "platform", input.Platform, "version", input.Version, "error", err)
				return nil, huma.Error500InternalServerError("Failed to resolve download")
			}
		}

		ip := input.ForwardedFor
		if ip == "" {
			ip = input.RemoteAddr
		}
		ip = strings.Split(ip, ",")[0]

		var ipHash *string
		if key := os.Getenv("ENCRYPTION_KEY"); key != "" {
			hash := fmt.Sprintf("%x", sha256.Sum256([]byte(ip+":"+key)))
			ipHash = &hash
		}

		ua := input.UserAgent
		ref := input.Referer
		if ref == "" {
			ref = "https://taskforceai.chat"
		}

		if err := svc.RecordDownload(ctx, platform.DownloadLogInput{
			Product:       input.Product,
			Platform:      input.Platform,
			Version:       input.Version,
			UserAgent:     &ua,
			IPAddressHash: ipHash,
			Referrer:      ref,
		}); err != nil {
			slog.Warn("Failed to record download analytics", "product", input.Product, "platform", input.Platform, "version", input.Version, "error", err)
		}
		slog.Info("Download redirect resolved", "product", input.Product, "platform", input.Platform, "version", input.Version)

		return &RedirectResponse{
			Location: blobURL,
			Status:   302,
		}, nil
	})
}
