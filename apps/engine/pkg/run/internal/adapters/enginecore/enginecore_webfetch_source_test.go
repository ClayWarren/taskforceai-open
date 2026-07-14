package enginecoreadapter

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"

	enginecoretools "github.com/TaskForceAI/core/pkg/enginecore/tools"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type enginecoreWebFetchBody struct {
	readErr  error
	closeErr error
}

type enginecoreRoundTripperFunc func(*http.Request) (*http.Response, error)

func (fn enginecoreRoundTripperFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func (b enginecoreWebFetchBody) Read([]byte) (int, error) {
	if b.readErr != nil {
		return 0, b.readErr
	}
	return 0, io.EOF
}

func (b enginecoreWebFetchBody) Close() error {
	return b.closeErr
}

func resetEnginecoreWebFetchHooks(t *testing.T) {
	t.Helper()
	previousRequest := newEnginecoreWebFetchRequest
	previousDo := doEnginecoreWebFetchRequest
	previousLookup := lookupEnginecoreWebFetchIPAddr
	previousDial := dialEnginecoreWebFetchContext
	t.Cleanup(func() {
		newEnginecoreWebFetchRequest = previousRequest
		doEnginecoreWebFetchRequest = previousDo
		lookupEnginecoreWebFetchIPAddr = previousLookup
		dialEnginecoreWebFetchContext = previousDial
	})
}

func TestEnginecoreHTTPWebFetchSource(t *testing.T) {
	source := enginecoreHTTPWebFetchSource{}

	t.Run("fetches successful responses", func(t *testing.T) {
		t.Setenv("TESTING", "true")
		resetEnginecoreWebFetchHooks(t)
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("content-type", "text/plain")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("web content"))
		}))
		t.Cleanup(server.Close)
		doEnginecoreWebFetchRequest = func(client *http.Client, req *http.Request) (*http.Response, error) {
			client.Transport = http.DefaultTransport
			return client.Do(req)
		}

		resp, err := source.Fetch(context.Background(), enginecoretools.WebFetchRequest{URL: server.URL})
		require.NoError(t, err)
		assert.Equal(t, http.StatusOK, resp.StatusCode)
		assert.Equal(t, []byte("web content"), resp.Body)
		assert.Equal(t, "text/plain", resp.ContentType)
	})

	t.Run("default request hook delegates to the client", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		}))
		t.Cleanup(server.Close)
		req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, server.URL, nil)
		require.NoError(t, err)
		resp, err := doEnginecoreWebFetchRequest(server.Client(), req)
		require.NoError(t, err)
		require.NoError(t, resp.Body.Close())
		assert.Equal(t, http.StatusNoContent, resp.StatusCode)
	})

	t.Run("builds a safe transport when the default is custom", func(t *testing.T) {
		previous := http.DefaultTransport
		http.DefaultTransport = enginecoreRoundTripperFunc(func(*http.Request) (*http.Response, error) {
			return nil, errors.New("unused")
		})
		t.Cleanup(func() { http.DefaultTransport = previous })

		transport := newEnginecoreWebFetchTransport()
		assert.NotNil(t, transport.DialContext)
		assert.True(t, transport.ForceAttemptHTTP2)
	})

	t.Run("blocks private hosts", func(t *testing.T) {
		t.Setenv("GO_ENV", "production")
		t.Setenv("TESTING", "false")

		_, err := source.Fetch(context.Background(), enginecoretools.WebFetchRequest{URL: "http://127.0.0.1:1234"})
		require.ErrorIs(t, err, enginecoretools.ErrWebFetchPrivateAddress)
	})

	t.Run("test environments bypass private host blocking", func(t *testing.T) {
		t.Setenv("TESTING", "true")

		assert.False(t, isPrivateEnginecoreWebFetchHost(context.Background(), "localhost:8080"))
	})

	t.Run("dns lookup failures fail closed", func(t *testing.T) {
		t.Setenv("GO_ENV", "production")
		t.Setenv("TESTING", "false")

		assert.True(t, isPrivateEnginecoreWebFetchHost(context.Background(), "definitely-does-not-exist.invalid"))
	})

	t.Run("invalid redirect request is rejected", func(t *testing.T) {
		require.ErrorContains(t, validateEnginecoreWebFetchRedirect(context.Background(), nil), "invalid URL")
	})

	t.Run("request construction errors surface directly", func(t *testing.T) {
		t.Setenv("TESTING", "true")
		resetEnginecoreWebFetchHooks(t)
		newEnginecoreWebFetchRequest = func(context.Context, string, string, io.Reader) (*http.Request, error) {
			return nil, errors.New("request failed")
		}

		_, err := source.Fetch(context.Background(), enginecoretools.WebFetchRequest{URL: "https://example.com"})
		require.ErrorContains(t, err, "request failed")
	})

	t.Run("transport errors map to connection error", func(t *testing.T) {
		t.Setenv("TESTING", "true")
		resetEnginecoreWebFetchHooks(t)
		doEnginecoreWebFetchRequest = func(*http.Client, *http.Request) (*http.Response, error) {
			return nil, errors.New("dial failed")
		}

		_, err := source.Fetch(context.Background(), enginecoretools.WebFetchRequest{URL: "https://example.com"})
		require.ErrorIs(t, err, enginecoretools.ErrWebFetchConnection)

		doEnginecoreWebFetchRequest = func(*http.Client, *http.Request) (*http.Response, error) {
			return nil, enginecoretools.ErrWebFetchPrivateAddress
		}
		_, err = source.Fetch(context.Background(), enginecoretools.WebFetchRequest{URL: "https://example.com"})
		require.ErrorIs(t, err, enginecoretools.ErrWebFetchPrivateAddress)

		doEnginecoreWebFetchRequest = func(*http.Client, *http.Request) (*http.Response, error) {
			return nil, nil
		}
		_, err = source.Fetch(context.Background(), enginecoretools.WebFetchRequest{URL: "https://example.com"})
		require.ErrorIs(t, err, enginecoretools.ErrWebFetchConnection)
	})

	t.Run("body read and close errors surface directly", func(t *testing.T) {
		t.Setenv("TESTING", "true")
		resetEnginecoreWebFetchHooks(t)
		doEnginecoreWebFetchRequest = func(*http.Client, *http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: http.StatusOK, Body: enginecoreWebFetchBody{readErr: errors.New("read failed")}, Header: http.Header{}}, nil
		}

		_, err := source.Fetch(context.Background(), enginecoretools.WebFetchRequest{URL: "https://example.com"})
		require.ErrorContains(t, err, "read failed")

		doEnginecoreWebFetchRequest = func(*http.Client, *http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: http.StatusOK, Body: enginecoreWebFetchBody{closeErr: errors.New("close failed")}, Header: http.Header{}}, nil
		}

		_, err = source.Fetch(context.Background(), enginecoretools.WebFetchRequest{URL: "https://example.com"})
		require.ErrorContains(t, err, "close failed")
	})

	t.Run("rejects oversized streamed responses", func(t *testing.T) {
		t.Setenv("TESTING", "true")
		resetEnginecoreWebFetchHooks(t)
		doEnginecoreWebFetchRequest = func(*http.Client, *http.Request) (*http.Response, error) {
			body := io.NopCloser(io.LimitReader(&infiniteEnginecoreWebFetchReader{}, enginecoreWebFetchMaxResponseBytes+1))
			return &http.Response{StatusCode: http.StatusOK, Body: body, Header: http.Header{}}, nil
		}

		_, err := source.Fetch(context.Background(), enginecoretools.WebFetchRequest{URL: "https://example.com"})
		require.ErrorContains(t, err, "response exceeds")
	})

	t.Run("dial-time validation blocks dns rebinding", func(t *testing.T) {
		t.Setenv("GO_ENV", "production")
		t.Setenv("TESTING", "false")
		resetEnginecoreWebFetchHooks(t)
		lookupEnginecoreWebFetchIPAddr = func(context.Context, string) ([]net.IPAddr, error) {
			return []net.IPAddr{{IP: net.ParseIP("127.0.0.1")}}, nil
		}
		dialed := false
		dialEnginecoreWebFetchContext = func(context.Context, string, string) (net.Conn, error) {
			dialed = true
			return nil, errors.New("unexpected dial")
		}

		_, err := dialValidatedEnginecoreWebFetchAddress(context.Background(), "tcp", "attacker.example:443")
		require.ErrorIs(t, err, enginecoretools.ErrWebFetchPrivateAddress)
		assert.False(t, dialed)
	})

	t.Run("dial-time validation pins the resolved public address", func(t *testing.T) {
		resetEnginecoreWebFetchHooks(t)
		lookupEnginecoreWebFetchIPAddr = func(context.Context, string) ([]net.IPAddr, error) {
			return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
		}
		var dialAddress string
		dialEnginecoreWebFetchContext = func(_ context.Context, _, address string) (net.Conn, error) {
			dialAddress = address
			return nil, errors.New("stop after capture")
		}

		_, err := dialValidatedEnginecoreWebFetchAddress(context.Background(), "tcp", "example.com:443")
		require.ErrorContains(t, err, "stop after capture")
		assert.Equal(t, "93.184.216.34:443", dialAddress)
	})

	t.Run("dial-time validation rejects invalid and unresolved addresses", func(t *testing.T) {
		resetEnginecoreWebFetchHooks(t)
		_, err := dialValidatedEnginecoreWebFetchAddress(context.Background(), "tcp", "missing-port")
		require.ErrorIs(t, err, enginecoretools.ErrWebFetchPrivateAddress)

		lookupEnginecoreWebFetchIPAddr = func(context.Context, string) ([]net.IPAddr, error) {
			return nil, errors.New("lookup failed")
		}
		_, err = dialValidatedEnginecoreWebFetchAddress(context.Background(), "tcp", "example.com:443")
		require.ErrorIs(t, err, enginecoretools.ErrWebFetchPrivateAddress)

		lookupEnginecoreWebFetchIPAddr = func(context.Context, string) ([]net.IPAddr, error) {
			return nil, nil
		}
		_, err = dialValidatedEnginecoreWebFetchAddress(context.Background(), "tcp", "example.com:443")
		require.ErrorIs(t, err, enginecoretools.ErrWebFetchPrivateAddress)
	})

	t.Run("dial-time validation returns the first successful connection", func(t *testing.T) {
		resetEnginecoreWebFetchHooks(t)
		lookupEnginecoreWebFetchIPAddr = func(context.Context, string) ([]net.IPAddr, error) {
			return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
		}
		clientConn, serverConn := net.Pipe()
		t.Cleanup(func() {
			_ = clientConn.Close()
			_ = serverConn.Close()
		})
		dialEnginecoreWebFetchContext = func(context.Context, string, string) (net.Conn, error) {
			return clientConn, nil
		}

		conn, err := dialValidatedEnginecoreWebFetchAddress(context.Background(), "tcp", "example.com:443")
		require.NoError(t, err)
		assert.Same(t, clientConn, conn)
	})

	t.Run("redirect validation blocks private and excessive redirects", func(t *testing.T) {
		t.Setenv("GO_ENV", "production")
		t.Setenv("TESTING", "false")
		resetEnginecoreWebFetchHooks(t)
		lookupEnginecoreWebFetchIPAddr = func(context.Context, string) ([]net.IPAddr, error) {
			return []net.IPAddr{{IP: net.ParseIP("127.0.0.1")}}, nil
		}

		req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, "https://example.com", nil)
		require.NoError(t, err)
		require.ErrorIs(t, validateEnginecoreWebFetchRedirect(context.Background(), req), enginecoretools.ErrWebFetchPrivateAddress)

		lookupEnginecoreWebFetchIPAddr = func(context.Context, string) ([]net.IPAddr, error) {
			return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
		}
		doEnginecoreWebFetchRequest = func(client *http.Client, req *http.Request) (*http.Response, error) {
			return nil, client.CheckRedirect(req, []*http.Request{{}, {}, {}, {}, {}})
		}
		_, err = source.Fetch(context.Background(), enginecoretools.WebFetchRequest{URL: "https://example.com"})
		require.ErrorIs(t, err, enginecoretools.ErrWebFetchConnection)

		doEnginecoreWebFetchRequest = func(client *http.Client, req *http.Request) (*http.Response, error) {
			if err := client.CheckRedirect(req, []*http.Request{{}}); err != nil {
				return nil, err
			}
			return &http.Response{StatusCode: http.StatusOK, Body: enginecoreWebFetchBody{}, Header: http.Header{}}, nil
		}
		_, err = source.Fetch(context.Background(), enginecoretools.WebFetchRequest{URL: "https://example.com"})
		require.NoError(t, err)
	})

	t.Run("url and host privacy helpers", func(t *testing.T) {
		t.Setenv("GO_ENV", "production")
		t.Setenv("TESTING", "false")
		resetEnginecoreWebFetchHooks(t)
		assert.True(t, isPrivateEnginecoreWebFetchURL(context.Background(), "://bad-url"))

		lookupEnginecoreWebFetchIPAddr = func(context.Context, string) ([]net.IPAddr, error) {
			return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
		}
		assert.False(t, isPrivateEnginecoreWebFetchHost(context.Background(), "example.com:443"))
		req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, "https://example.com", nil)
		require.NoError(t, err)
		require.NoError(t, validateEnginecoreWebFetchRedirect(context.Background(), req))
	})
}

type infiniteEnginecoreWebFetchReader struct{}

func (*infiniteEnginecoreWebFetchReader) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 'x'
	}
	return len(p), nil
}
