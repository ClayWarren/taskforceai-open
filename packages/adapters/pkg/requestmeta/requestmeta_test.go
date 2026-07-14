package requestmeta

import (
	"net/http/httptest"
	"testing"
)

func TestClientIPFromRemoteAddr(t *testing.T) {
	for remoteAddr, want := range map[string]string{
		"192.0.2.5:1234": "192.0.2.5",
		"bare-host":      "bare-host",
	} {
		got := ClientIPFromRemoteAddr(remoteAddr)
		if got == nil || *got != want {
			t.Errorf("ClientIPFromRemoteAddr(%q) = %v, want %q", remoteAddr, got, want)
		}
	}
	if got := ClientIPFromRemoteAddr("   "); got != nil {
		t.Errorf("ClientIPFromRemoteAddr(blank) = %v, want nil", *got)
	}
}

func TestGetClientIPRejectsForwardedHeadersFromUntrustedProductionRemote(t *testing.T) {
	t.Setenv("NODE_ENV", "production")

	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "203.0.113.10:1234"
	req.Header.Set("X-Forwarded-For", "198.51.100.9, 198.51.100.10")

	got := GetClientIP(req)
	if got == nil || *got != "203.0.113.10" {
		t.Fatalf("client ip = %v, want remote addr", got)
	}
}

func TestGetClientIPRejectsForwardedHeadersFromUntrustedProductionHost(t *testing.T) {
	t.Setenv("NODE_ENV", "production")

	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "203.0.113.10"
	req.Header.Set("X-Forwarded-For", "198.51.100.9")

	got := GetClientIP(req)
	if got == nil || *got != "203.0.113.10" {
		t.Fatalf("client ip = %v, want remote host", got)
	}
}

func TestGetClientIPIgnoresInvalidProxyRemote(t *testing.T) {
	t.Setenv("NODE_ENV", "production")

	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "not-an-ip"
	req.Header.Set("X-Forwarded-For", "198.51.100.9")

	got := GetClientIP(req)
	if got == nil || *got != "not-an-ip" {
		t.Fatalf("client ip = %v, want raw remote host", got)
	}
}

func TestGetClientIPUsesTrustedProxyHeaders(t *testing.T) {
	t.Setenv("NODE_ENV", "production")

	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "173.245.48.1:443"
	req.Header.Set("X-Forwarded-For", "198.51.100.9, 198.51.100.10")

	got := GetClientIP(req)
	if got == nil || *got != "198.51.100.10" {
		t.Fatalf("client ip = %v, want rightmost untrusted forwarded ip", got)
	}
}

func TestGetClientIPChecksHeaderPriorityAndTrims(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "173.245.48.1:1234"
	req.Header.Set("X-Real-IP", " 198.51.100.20 ")
	req.Header.Set("CF-Connecting-IP", "198.51.100.21")

	got := GetClientIP(req)
	if got == nil || *got != "198.51.100.21" {
		t.Fatalf("client ip = %v, want cf-connecting-ip", got)
	}
}

func TestGetClientIPTreatsVercelAsProduction(t *testing.T) {
	t.Setenv("VERCEL", "1")

	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "203.0.113.10:1234"
	req.Header.Set("CF-Connecting-IP", "198.51.100.9")

	got := GetClientIP(req)
	if got == nil || *got != "203.0.113.10" {
		t.Fatalf("client ip = %v, want remote addr", got)
	}
}

func TestGetClientIPPrefersCloudflareHeaderFromTrustedProxy(t *testing.T) {
	t.Setenv("GO_ENV", "production")

	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "173.245.48.1:443"
	req.Header.Set("X-Forwarded-For", "198.51.100.9, 198.51.100.10")
	req.Header.Set("CF-Connecting-IP", "198.51.100.20")

	got := GetClientIP(req)
	if got == nil || *got != "198.51.100.20" {
		t.Fatalf("client ip = %v, want cf-connecting-ip", got)
	}
}

func TestGetClientIPIgnoresCloudflareHeaderFromVercelProxy(t *testing.T) {
	t.Setenv("VERCEL", "1")

	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "76.76.21.42:443"
	req.Header.Set("CF-Connecting-IP", "198.51.100.66")
	req.Header.Set("X-Vercel-Forwarded-For", "198.51.100.30")
	req.Header.Set("X-Forwarded-For", "198.51.100.31")

	got := GetClientIP(req)
	if got == nil || *got != "198.51.100.30" {
		t.Fatalf("client ip = %v, want x-vercel-forwarded-for", got)
	}
}

func TestGetClientIPReturnsNilWithoutUsableAddress(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	req.Header.Set("X-Forwarded-For", " ")

	if got := GetClientIP(req); got != nil {
		t.Fatalf("client ip = %v, want nil", *got)
	}
}

func TestGetUserAgent(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	if got := GetUserAgent(req); got != nil {
		t.Fatalf("user agent = %v, want nil", *got)
	}

	req.Header.Set("User-Agent", "TaskForceAI-Test")
	got := GetUserAgent(req)
	if got == nil || *got != "TaskForceAI-Test" {
		t.Fatalf("user agent = %v, want header", got)
	}
}
