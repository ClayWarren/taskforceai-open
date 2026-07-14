package pkg

import (
	"context"
)

type SearchProvider string

const (
	ProviderBrave SearchProvider = "brave"
)

type IHttpClient interface {
	Get(ctx context.Context, url string, headers map[string]string) ([]byte, int, error)
}
