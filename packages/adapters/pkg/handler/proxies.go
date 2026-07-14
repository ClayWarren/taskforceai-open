package handler

import (
	"net/http"
	"slices"
	"strings"

	"github.com/TaskForceAI/adapters/pkg/server/topology"
)

type ProxyRoute struct {
	PathPrefixes []string
	ExactPaths   []string
	Handler      http.HandlerFunc
}

var CoreServiceProxyRoutes = []ProxyRoute{
	{PathPrefixes: []string{"/api/auth/", "/api/v1/auth/"}, ExactPaths: []string{"/api/v1/auth"}, Handler: ProxyAuthHandler},
	{PathPrefixes: []string{"/api/v1/sync/"}, ExactPaths: []string{"/api/v1/sync"}, Handler: ProxySyncHandler},
	{
		PathPrefixes: []string{"/api/v1/payments/", "/api/v1/checkout/", "/api/v1/billing/"},
		ExactPaths:   []string{"/api/v1/payments", "/api/v1/checkout", "/api/v1/billing"},
		Handler:      ProxyBillingHandler,
	},
	{
		PathPrefixes: []string{"/api/v1/run/", "/api/v1/integrations/", "/api/v1/stream/"},
		ExactPaths:   []string{"/api/v1/run", "/api/v1/integrations", "/api/v1/stream"},
		Handler:      ProxyEngineHandler,
	},
	{PathPrefixes: []string{"/api/v1/developer/"}, ExactPaths: []string{"/api/v1/developer"}, Handler: ProxyDeveloperHandler},
}

func ProxyCoreServiceRoute(w http.ResponseWriter, r *http.Request) bool {
	for _, route := range CoreServiceProxyRoutes {
		if route.matches(r.URL.Path) {
			route.Handler(w, r)
			return true
		}
	}
	return false
}

func (r ProxyRoute) matches(path string) bool {
	if slices.Contains(r.ExactPaths, path) {
		return true
	}
	for _, prefix := range r.PathPrefixes {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}
	return false
}

type LimitedRoute struct {
	Path  string
	Limit func(http.Handler) http.Handler
	Func  http.HandlerFunc
}

type MethodRoute struct {
	Method string
	Path   string
	Func   http.HandlerFunc
}

func RegisterLimitedRoutes(mux interface{ Handle(string, http.Handler) }, routes []LimitedRoute) {
	for _, route := range routes {
		mux.Handle(route.Path, route.Limit(route.Func))
	}
}

func RegisterMethodRoutes(mux interface {
	MethodFunc(string, string, http.HandlerFunc)
}, routes []MethodRoute) {
	for _, route := range routes {
		mux.MethodFunc(route.Method, route.Path, route.Func)
	}
}

var (
	ProxyAuthHandler      = ProxyServiceHandler(topology.Auth, "auth service")
	ProxyBillingHandler   = ProxyServiceHandler(topology.Billing, "billing service")
	ProxyDeveloperHandler = ProxyServiceHandler(topology.Developer, "developer service")
	ProxyEngineHandler    = ProxyServiceHandler(topology.Engine, "engine service")
	ProxySyncHandler      = ProxyServiceHandler(topology.Sync, "sync service")
)

func ProxyServiceHandler(service topology.Service, label string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		definition := topology.Get(service)
		ProxyToService(w, r, definition.ServiceURLVar, definition.ProductionURL, definition.LocalURL, label)
	}
}
