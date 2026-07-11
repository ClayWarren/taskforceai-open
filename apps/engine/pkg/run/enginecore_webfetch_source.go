package run

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"sync"
	"time"

	enginecoretools "github.com/TaskForceAI/core/pkg/tools/enginecore"
)

type enginecoreHTTPWebFetchSource struct{}

const enginecoreWebFetchMaxResponseBytes = 5 * 1024 * 1024

var (
	enginecoreWebFetchSourceMu        sync.Mutex
	enginecoreWebFetchSourceInstalled bool
	enginecorePrivateIPNets           []*net.IPNet
	newEnginecoreWebFetchRequest      = http.NewRequestWithContext
	doEnginecoreWebFetchRequest       = func(client *http.Client, req *http.Request) (*http.Response, error) {
		return client.Do(req)
	}
	lookupEnginecoreWebFetchIPAddr = func(ctx context.Context, host string) ([]net.IPAddr, error) {
		return (&net.Resolver{}).LookupIPAddr(ctx, host)
	}
	dialEnginecoreWebFetchContext = (&net.Dialer{
		Timeout:   10 * time.Second,
		KeepAlive: 30 * time.Second,
	}).DialContext
)

func init() {
	for _, cidr := range []string{
		"10.0.0.0/8",
		"172.16.0.0/12",
		"192.168.0.0/16",
		"127.0.0.0/8",
		"169.254.0.0/16",
		"::1/128",
		"fc00::/7",
		"fe80::/10",
	} {
		_, ipNet, _ := net.ParseCIDR(cidr)
		enginecorePrivateIPNets = append(enginecorePrivateIPNets, ipNet)
	}
}

func installEnginecoreWebFetchSource() {
	enginecoreWebFetchSourceMu.Lock()
	defer enginecoreWebFetchSourceMu.Unlock()
	if enginecoreWebFetchSourceInstalled {
		return
	}
	enginecoretools.SetWebFetchSource(enginecoreHTTPWebFetchSource{})
	enginecoreWebFetchSourceInstalled = true
}

func (enginecoreHTTPWebFetchSource) Fetch(ctx context.Context, request enginecoretools.WebFetchRequest) (enginecoretools.WebFetchResponse, error) {
	if isPrivateEnginecoreWebFetchURL(ctx, request.URL) {
		return enginecoretools.WebFetchResponse{}, enginecoretools.ErrWebFetchPrivateAddress
	}

	client := &http.Client{
		Timeout:   10 * time.Second,
		Transport: newEnginecoreWebFetchTransport(),
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return fmt.Errorf("stopped after 5 redirects")
			}
			return validateEnginecoreWebFetchRedirect(ctx, req)
		},
	}
	req, err := newEnginecoreWebFetchRequest(ctx, http.MethodGet, request.URL, nil)
	if err != nil {
		return enginecoretools.WebFetchResponse{}, err
	}
	resp, err := doEnginecoreWebFetchRequest(client, req)
	if err != nil {
		if errors.Is(err, enginecoretools.ErrWebFetchPrivateAddress) {
			return enginecoretools.WebFetchResponse{}, enginecoretools.ErrWebFetchPrivateAddress
		}
		return enginecoretools.WebFetchResponse{}, enginecoretools.ErrWebFetchConnection
	}
	if resp == nil {
		return enginecoretools.WebFetchResponse{}, enginecoretools.ErrWebFetchConnection
	}

	body, readErr := io.ReadAll(io.LimitReader(resp.Body, enginecoreWebFetchMaxResponseBytes+1))
	closeErr := resp.Body.Close()
	if readErr != nil {
		return enginecoretools.WebFetchResponse{}, readErr
	}
	if closeErr != nil {
		return enginecoretools.WebFetchResponse{}, closeErr
	}
	if len(body) > enginecoreWebFetchMaxResponseBytes {
		return enginecoretools.WebFetchResponse{}, fmt.Errorf("webfetch response exceeds %d byte limit", enginecoreWebFetchMaxResponseBytes)
	}

	return enginecoretools.WebFetchResponse{
		StatusCode:  resp.StatusCode,
		Body:        body,
		ContentType: resp.Header.Get("Content-Type"),
	}, nil
}

func newEnginecoreWebFetchTransport() *http.Transport {
	base, ok := http.DefaultTransport.(*http.Transport)
	if !ok {
		return &http.Transport{
			DialContext:       dialValidatedEnginecoreWebFetchAddress,
			ForceAttemptHTTP2: true,
		}
	}
	transport := base.Clone()
	transport.Proxy = nil
	transport.DialContext = dialValidatedEnginecoreWebFetchAddress
	return transport
}

func dialValidatedEnginecoreWebFetchAddress(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, enginecoretools.ErrWebFetchPrivateAddress
	}
	addrs, err := lookupEnginecoreWebFetchIPAddr(ctx, host)
	if err != nil || len(addrs) == 0 {
		return nil, enginecoretools.ErrWebFetchPrivateAddress
	}
	for _, addr := range addrs {
		if isPrivateEnginecoreWebFetchIP(addr.IP) {
			return nil, enginecoretools.ErrWebFetchPrivateAddress
		}
	}

	var lastErr error
	for _, addr := range addrs {
		conn, dialErr := dialEnginecoreWebFetchContext(ctx, network, net.JoinHostPort(addr.IP.String(), port))
		if dialErr == nil {
			return conn, nil
		}
		lastErr = dialErr
	}
	return nil, lastErr
}

func validateEnginecoreWebFetchRedirect(ctx context.Context, req *http.Request) error {
	if req == nil || req.URL == nil {
		return fmt.Errorf("invalid URL")
	}
	if isPrivateEnginecoreWebFetchHost(ctx, req.URL.Host) {
		return enginecoretools.ErrWebFetchPrivateAddress
	}
	return nil
}

func isPrivateEnginecoreWebFetchURL(ctx context.Context, rawURL string) bool {
	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		return true
	}
	return isPrivateEnginecoreWebFetchHost(ctx, parsedURL.Host)
}

func isPrivateEnginecoreWebFetchHost(ctx context.Context, host string) bool {
	if os.Getenv("GO_ENV") == "test" || os.Getenv("TESTING") == "true" {
		return false
	}
	if parsedHost, _, err := net.SplitHostPort(host); err == nil {
		host = parsedHost
	}
	addrs, err := lookupEnginecoreWebFetchIPAddr(ctx, host)
	if err != nil {
		return true
	}
	for _, addr := range addrs {
		if isPrivateEnginecoreWebFetchIP(addr.IP) {
			return true
		}
	}
	return false
}

func isPrivateEnginecoreWebFetchIP(ip net.IP) bool {
	if ip == nil || !ip.IsGlobalUnicast() || ip.IsPrivate() {
		return true
	}
	for _, ipNet := range enginecorePrivateIPNets {
		if ipNet.Contains(ip) {
			return true
		}
	}
	return false
}
