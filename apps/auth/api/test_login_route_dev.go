//go:build !production

package handler

import (
	"net/http"
	"os"
	"strings"

	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	authhandlers "github.com/TaskForceAI/auth-service/pkg/handlers/auth"
)

func appendTestLoginRoutes(
	routes []adapterhandler.LimitedRoute,
	strictLimit func(http.Handler) http.Handler,
) []adapterhandler.LimitedRoute {
	if adapterhandler.IsProductionEnv() || !isTestLoginRouteEnabled() {
		return routes
	}

	return append(routes, adapterhandler.LimitedRoute{
		Path:  "/api/v1/auth/test-login",
		Limit: strictLimit,
		Func:  authhandlers.TestLoginHandler,
	})
}

func isTestLoginRouteEnabled() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("GO_ENV")), "test") &&
		strings.EqualFold(strings.TrimSpace(os.Getenv("ENABLE_TEST_LOGIN")), "true")
}
