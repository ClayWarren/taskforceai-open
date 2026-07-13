package authtoken

import (
	"math"
	"net"
	"net/http"
	"net/url"
	"strings"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	authpkg "github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/golang-jwt/jwt/v5"
)

var sessionCookieNames = []string{"__Secure-session_token", "session_token"}

var (
	verifyToken            = authpkg.VerifyToken
	buildAuthenticatedUser = adapterhandler.BuildAuthenticatedUser
)

// Handler extracts and validates the session token from cookies.
func Handler(w http.ResponseWriter, r *http.Request) {
	if handler.HandleCORS(w, r) {
		return
	}

	if r.Method != http.MethodGet {
		handler.JSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if !isAllowedTokenOrigin(r) {
		handler.GetLogger().Warn("Token handler: blocked cross-origin token read", map[string]any{
			"origin": r.Header.Get("Origin"),
			"host":   r.Host,
		})
		handler.JSONError(w, http.StatusForbidden, "Forbidden")
		return
	}

	rawToken := sessionTokenCookie(r)
	if rawToken == "" {
		handler.GetLogger().Warn("Token handler: no session cookie found", map[string]any{
			"cookies_present": len(r.Cookies()),
			"cookie_names":    getCookieNames(r.Cookies()),
		})

		handler.JSONError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	authUser, err := authenticatedTokenUser(rawToken)
	if err != nil {
		handler.JSONError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	q, err := handler.ResolveQueries(r.Context(), nil)
	if err != nil {
		handler.GetLogger().Error("Token handler: failed to initialize database", map[string]any{
			"error": err.Error(),
		})
		handler.JSONError(w, http.StatusServiceUnavailable, "Service unavailable")
		return
	}
	if authUser.ID <= 0 || authUser.ID > math.MaxInt32 {
		handler.JSONError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}
	authUserID := int32(authUser.ID) // #nosec G115 -- bounded by math.MaxInt32 above.
	dbUser, err := q.GetUserByID(r.Context(), authUserID)
	if err != nil || dbUser.Disabled {
		handler.JSONError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	if !tokenIsActive(w, r, rawToken) {
		return
	}

	handler.JSON(w, http.StatusOK, map[string]string{
		"accessToken": rawToken,
	})
}

func sessionTokenCookie(r *http.Request) string {
	for _, name := range sessionCookieNames {
		cookie, err := r.Cookie(name)
		if err == nil && cookie.Value != "" {
			return cookie.Value
		}
	}
	return ""
}

func authenticatedTokenUser(rawToken string) (*adapterauth.AuthenticatedUser, error) {
	token, err := verifyToken(rawToken)
	if err != nil || token == nil || !token.Valid {
		errorMessage := ""
		if err != nil {
			errorMessage = err.Error()
		}
		handler.GetLogger().Warn("Token handler: invalid session token", map[string]any{"error": errorMessage})
		return nil, authpkg.ErrInvalidToken
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || adapterhandler.IsMFAPendingClaims(claims) {
		return nil, authpkg.ErrInvalidToken
	}
	return buildAuthenticatedUser(claims)
}

func tokenIsActive(w http.ResponseWriter, r *http.Request, rawToken string) bool {
	rc := handler.GetRedisClient()
	if rc == nil {
		return true
	}
	revoked, err := adapterauth.IsTokenRevoked(r.Context(), rc, rawToken)
	if err != nil {
		handler.GetLogger().Error("Token handler: failed to check token revocation", map[string]any{"error": err.Error()})
		handler.JSONError(w, http.StatusServiceUnavailable, "Service unavailable")
		return false
	}
	if revoked {
		handler.JSONError(w, http.StatusUnauthorized, "Unauthorized")
		return false
	}
	return true
}

func getCookieNames(cookies []*http.Cookie) []string {
	names := make([]string, len(cookies))
	for i, c := range cookies {
		names[i] = c.Name
	}
	return names
}

func isAllowedTokenOrigin(r *http.Request) bool {
	if r == nil {
		return false
	}
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return false
	}
	originScheme := strings.ToLower(parsed.Scheme)
	originHost, originPort, ok := normalizeHostPort(parsed.Host, originScheme)
	if !ok {
		return false
	}

	proto := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto"))
	if idx := strings.Index(proto, ","); idx >= 0 {
		proto = strings.TrimSpace(proto[:idx])
	}
	if proto == "" {
		if r.TLS != nil {
			proto = "https"
		} else {
			proto = "http"
		}
	}
	proto = strings.ToLower(proto)
	if originScheme != proto {
		return false
	}

	hostCandidates := []string{
		strings.TrimSpace(r.Header.Get("X-Forwarded-Host")),
		strings.TrimSpace(r.Host),
	}
	for _, candidate := range hostCandidates {
		if candidate == "" {
			continue
		}
		canonical := candidate
		if idx := strings.Index(canonical, ","); idx >= 0 {
			canonical = strings.TrimSpace(canonical[:idx])
		}
		candidateHost, candidatePort, candidateOK := normalizeHostPort(canonical, proto)
		if !candidateOK {
			continue
		}
		if candidateHost == originHost && candidatePort == originPort {
			return true
		}
	}
	return false
}

func normalizeHostPort(rawHost, scheme string) (host string, port string, ok bool) {
	candidate := strings.TrimSpace(rawHost)
	if candidate == "" {
		return "", "", false
	}

	parsedHost := ""
	parsedPort := ""
	if strings.Count(candidate, ":") > 1 && !strings.HasPrefix(candidate, "[") {
		parsedHost = candidate
	} else if h, p, err := net.SplitHostPort(candidate); err == nil {
		parsedHost = h
		parsedPort = p
	} else {
		parsedHost = candidate
	}

	if parsedHost == "" {
		return "", "", false
	}

	normalizedScheme := strings.ToLower(strings.TrimSpace(scheme))
	if parsedPort == "" {
		switch normalizedScheme {
		case "https":
			parsedPort = "443"
		case "http":
			parsedPort = "80"
		default:
			return "", "", false
		}
	}

	return strings.ToLower(strings.TrimSuffix(parsedHost, ".")), parsedPort, true
}
