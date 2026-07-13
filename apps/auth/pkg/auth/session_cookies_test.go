package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

type discardCookieWriter struct {
	header http.Header
}

func newDiscardCookieWriter() *discardCookieWriter {
	return &discardCookieWriter{header: make(http.Header)}
}

func (w *discardCookieWriter) Header() http.Header {
	return w.header
}

func (w *discardCookieWriter) Write([]byte) (int, error) {
	return 0, nil
}

func (w *discardCookieWriter) WriteHeader(int) {}

func (w *discardCookieWriter) Reset() {
	for key := range w.header {
		delete(w.header, key)
	}
}

func TestApplySessionCookies_CustomMaxAgeNonSecure(t *testing.T) {
	w := httptest.NewRecorder()
	user := SessionUser{ID: "1", Email: "test@example.com"}
	ApplySessionCookies(w, "token_value", user, false, 7200)

	cookies := w.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("expected one cookie without secure mode, got %d", len(cookies))
	}
	if cookies[0].Name != SessionCookieName {
		t.Fatalf("unexpected cookie name: %s", cookies[0].Name)
	}
	if cookies[0].MaxAge != 7200 {
		t.Fatalf("expected custom max age 7200, got %d", cookies[0].MaxAge)
	}
	if cookies[0].Secure {
		t.Fatal("expected non-secure session cookie")
	}
}

func TestApplySessionCookies_EnterpriseTTL(t *testing.T) {
	w := httptest.NewRecorder()
	orgID := "org-ent"
	user := SessionUser{ID: "2", Email: "ent@example.com", OrgID: &orgID}
	ApplySessionCookies(w, "ent_token", user, true)

	cookies := w.Result().Cookies()
	if len(cookies) != 2 {
		t.Fatalf("expected secure + session cookies, got %d", len(cookies))
	}
}

func BenchmarkApplySessionCookiesSecure(b *testing.B) {
	w := newDiscardCookieWriter()
	user := SessionUser{ID: "2", Email: "ent@example.com"}

	b.ReportAllocs()
	for b.Loop() {
		w.Reset()
		ApplySessionCookies(w, "session-token-value", user, true)
	}
}

func BenchmarkApplySessionCookiesNonSecure(b *testing.B) {
	w := newDiscardCookieWriter()
	user := SessionUser{ID: "1", Email: "test@example.com"}

	b.ReportAllocs()
	for b.Loop() {
		w.Reset()
		ApplySessionCookies(w, "session-token-value", user, false)
	}
}
