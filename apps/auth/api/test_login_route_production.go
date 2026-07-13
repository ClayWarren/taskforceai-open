//go:build production

package handler

import (
	"net/http"

	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
)

func appendTestLoginRoutes(
	routes []adapterhandler.LimitedRoute,
	_ func(http.Handler) http.Handler,
) []adapterhandler.LimitedRoute {
	return routes
}
