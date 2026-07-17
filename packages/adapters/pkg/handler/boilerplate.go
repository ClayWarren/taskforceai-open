package handler

import "net/http"

func ServiceHeader(serviceName string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-TaskForce-Service", serviceName)
			next.ServeHTTP(w, r)
		})
	}
}

// HandleNoContent responds with 204 No Content.
// Used to silence noise from browsers, bots, and crawlers requesting
// common paths like /, favicon.ico, sitemap.xml, etc.
func HandleNoContent(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusNoContent)
}

// HandleRobots responds with a robots.txt that disallows all crawling.
func HandleRobots(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain")
	_, _ = w.Write([]byte("User-agent: *\nDisallow: /\n"))
}

// CommonRoute represents a route path and its handler.
type CommonRoute struct {
	Pattern string
	Handler http.HandlerFunc
}

// CommonRoutes returns the standard set of noise-silencing routes
// that every service should register.
func CommonRoutes() []CommonRoute {
	return []CommonRoute{
		{"/", HandleNoContent},
		{"/api", HandleNoContent},
		{"/api/", HandleNoContent},
		{"/favicon.ico", HandleNoContent},
		{"/api/favicon.ico", HandleNoContent},
		{"/favicon.png", HandleNoContent},
		{"/api/favicon.png", HandleNoContent},
		{"/favicon-32x32.png", HandleNoContent},
		{"/api/favicon-32x32.png", HandleNoContent},
		{"/robots.txt", HandleRobots},
		{"/api/robots.txt", HandleRobots},
		{"/sitemap.xml", HandleNoContent},
		{"/api/sitemap.xml", HandleNoContent},
	}
}

func RegisterCommonRoutes(mux interface {
	HandleFunc(string, http.HandlerFunc)
}) {
	for _, route := range CommonRoutes() {
		mux.HandleFunc(route.Pattern, route.Handler)
	}
}

func RegisterNotFound(mux interface{ NotFound(http.HandlerFunc) }, serviceName, messagePrefix string) {
	mux.NotFound(func(w http.ResponseWriter, r *http.Request) {
		GetLogger().WarnContext(
			r.Context(),
			"Route not found in "+serviceName,
			"path", r.URL.Path,
			"method", r.Method,
			"__path", r.URL.Query().Get("__path"),
			"matched_path", r.Header.Get("X-Matched-Path"),
		)
		JSONError(w, http.StatusNotFound, messagePrefix+r.URL.Path)
	})
}
