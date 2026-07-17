package handler

import (
	"context"
	"crypto/tls"
	"io"
	"mime/multipart"
	"net/url"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/danielgtaylor/huma/v2"
)

type testHumaContext struct {
	ctx    context.Context
	writer io.Writer
}

func (t testHumaContext) Operation() *huma.Operation                 { return nil }
func (t testHumaContext) Context() context.Context                   { return t.ctx }
func (t testHumaContext) TLS() *tls.ConnectionState                  { return nil }
func (t testHumaContext) Version() huma.ProtoVersion                 { return huma.ProtoVersion{} }
func (t testHumaContext) Method() string                             { return "" }
func (t testHumaContext) Host() string                               { return "" }
func (t testHumaContext) RemoteAddr() string                         { return "" }
func (t testHumaContext) URL() url.URL                               { return url.URL{} }
func (t testHumaContext) Param(string) string                        { return "" }
func (t testHumaContext) Query(string) string                        { return "" }
func (t testHumaContext) Header(string) string                       { return "" }
func (t testHumaContext) EachHeader(func(string, string))            {}
func (t testHumaContext) BodyReader() io.Reader                      { return nil }
func (t testHumaContext) GetMultipartForm() (*multipart.Form, error) { return nil, nil }
func (t testHumaContext) SetReadDeadline(time.Time) error            { return nil }
func (t testHumaContext) SetStatus(int)                              {}
func (t testHumaContext) Status() int                                { return 0 }
func (t testHumaContext) SetHeader(string, string)                   {}
func (t testHumaContext) AppendHeader(string, string)                {}
func (t testHumaContext) BodyWriter() io.Writer {
	if t.writer != nil {
		return t.writer
	}
	return io.Discard
}

func TestAuthContextResolve(t *testing.T) {
	user := &auth.AuthenticatedUser{ID: 42}
	ctx := context.WithValue(context.Background(), UserContextKey, user)
	ctx = context.WithValue(ctx, OrgIDContextKey, 7)

	var authCtx AuthContext
	errs := authCtx.Resolve(testHumaContext{ctx: ctx})
	if len(errs) != 0 {
		t.Fatalf("unexpected errors: %v", errs)
	}
	if authCtx.User != user || authCtx.OrgID != 7 {
		t.Fatalf("resolved context = %#v", authCtx)
	}
}

func TestAuthContextResolveMissingUser(t *testing.T) {
	var authCtx AuthContext
	errs := authCtx.Resolve(testHumaContext{ctx: context.Background()})
	if len(errs) != 1 {
		t.Fatalf("expected unauthorized error, got %v", errs)
	}
}

func TestOptionalAuthContextResolve(t *testing.T) {
	user := &auth.AuthenticatedUser{ID: 42}
	ctx := context.WithValue(context.Background(), UserContextKey, user)
	ctx = context.WithValue(ctx, OrgIDContextKey, 7)

	var authCtx OptionalAuthContext
	errs := authCtx.Resolve(testHumaContext{ctx: ctx})
	if len(errs) != 0 {
		t.Fatalf("unexpected errors: %v", errs)
	}
	if authCtx.User != user || authCtx.OrgID != 7 {
		t.Fatalf("resolved context = %#v", authCtx)
	}

	var missing OptionalAuthContext
	errs = missing.Resolve(testHumaContext{ctx: context.Background()})
	if len(errs) != 0 || missing.User != nil {
		t.Fatalf("missing optional auth should not error: %#v %v", missing, errs)
	}
}

func TestSessionAuthContextRejectsAPIKeyAuth(t *testing.T) {
	user := &auth.AuthenticatedUser{ID: 42}
	ctx := context.WithValue(context.Background(), UserContextKey, user)
	ctx = context.WithValue(ctx, AuthMethodContextKey, AuthMethodAPIKey)

	var authCtx SessionAuthContext
	errs := authCtx.Resolve(testHumaContext{ctx: ctx})
	if len(errs) != 1 {
		t.Fatalf("expected forbidden error, got %v", errs)
	}
}

func TestSessionAuthContextReturnsAuthErrors(t *testing.T) {
	var authCtx SessionAuthContext
	errs := authCtx.Resolve(testHumaContext{ctx: context.Background()})
	if len(errs) != 1 {
		t.Fatalf("expected unauthorized error, got %v", errs)
	}
}

func TestSessionAuthContextAllowsSessionAuth(t *testing.T) {
	user := &auth.AuthenticatedUser{ID: 42}
	ctx := context.WithValue(context.Background(), UserContextKey, user)
	ctx = context.WithValue(ctx, AuthMethodContextKey, AuthMethodSession)

	var authCtx SessionAuthContext
	errs := authCtx.Resolve(testHumaContext{ctx: ctx})
	if len(errs) != 0 {
		t.Fatalf("unexpected errors: %v", errs)
	}
	if authCtx.User != user {
		t.Fatalf("resolved user = %#v", authCtx.User)
	}
}

func TestAdminAuthContextResolve(t *testing.T) {
	admin := &auth.AuthenticatedUser{ID: 42, IsAdmin: true}
	ctx := context.WithValue(context.Background(), UserContextKey, admin)

	var authCtx AdminAuthContext
	errs := authCtx.Resolve(testHumaContext{ctx: ctx})
	if len(errs) != 0 {
		t.Fatalf("unexpected errors: %v", errs)
	}
	if authCtx.User != admin {
		t.Fatalf("resolved user = %#v", authCtx.User)
	}

	nonAdmin := &auth.AuthenticatedUser{ID: 43}
	ctx = context.WithValue(context.Background(), UserContextKey, nonAdmin)
	errs = authCtx.Resolve(testHumaContext{ctx: ctx})
	if len(errs) != 1 {
		t.Fatalf("expected forbidden error, got %v", errs)
	}
}

func TestAdminAuthContextReturnsAuthErrors(t *testing.T) {
	var authCtx AdminAuthContext
	errs := authCtx.Resolve(testHumaContext{ctx: context.Background()})
	if len(errs) != 1 {
		t.Fatalf("expected unauthorized error, got %v", errs)
	}
}
