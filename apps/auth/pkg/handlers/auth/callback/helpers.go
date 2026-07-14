package callback

import (
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/TaskForceAI/auth-service/pkg/auth"
	authhandler "github.com/TaskForceAI/auth-service/pkg/handler"
	stateutil "github.com/TaskForceAI/auth-service/pkg/handlers/auth/state"
)

const undefinedStr = "undefined"

// isAllowedRedirect validates that a redirect URL is safe (relative path or same-origin).
func isAllowedRedirect(rawURL string) bool {
	return authhandler.IsAllowedRedirect(rawURL)
}

func verifyState(w http.ResponseWriter, r *http.Request) (string, error) {
	fullState := r.URL.Query().Get("state")
	if fullState == "" {
		return "", fmt.Errorf("missing state")
	}
	stateParts := strings.SplitN(fullState, "|", 2)
	stateParam := stateParts[0]
	stateTarget := ""
	if len(stateParts) > 1 {
		stateTarget = stateParts[1]
	}

	stateCookie, err := r.Cookie("oauth_state")
	if err != nil || stateCookie == nil || strings.TrimSpace(stateCookie.Value) == "" {
		return "", fmt.Errorf("oauth_state cookie missing")
	}
	cookieValue := stateCookie.Value

	cookieMatches := subtle.ConstantTimeCompare([]byte(cookieValue), []byte(stateParam)) == 1
	if !cookieMatches {
		return "", fmt.Errorf("state mismatch")
	}

	secret := strings.TrimSpace(os.Getenv("AUTH_SECRET"))
	if secret == "" && authhandler.IsProductionEnv() {
		return "", fmt.Errorf("AUTH_SECRET is required for OAuth state verification")
	}
	if secret != "" && !stateutil.VerifySignedState(stateParam, stateTarget, secret) {
		return "", fmt.Errorf("invalid state signature")
	}

	// Clear state cookie after successful validation to prevent replay.
	domain := auth.GetCookieDomain()
	http.SetCookie(w, &http.Cookie{ //nolint:gosec // clearing an OAuth state cookie requires matching the original provider cookie attributes.
		Name:     "oauth_state",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteNoneMode,
		Domain:   domain,
	})

	// Return the original full state (or parts) for redirect logic
	return stateTarget, nil
}

func isValidCandidate(s string) bool {
	return s != undefinedStr && !strings.Contains(s, "/"+undefinedStr) && isAllowedRedirect(s)
}

func maybeConvertToAppURL(target string) string {
	if !strings.HasPrefix(target, "/") || strings.HasPrefix(target, "//") {
		return target
	}

	appURL := strings.TrimSpace(os.Getenv("APP_URL"))
	if appURL == "" {
		appURL = strings.TrimSpace(os.Getenv("WEB_URL"))
	}
	if appURL == "" {
		appURL = strings.TrimSpace(os.Getenv("NEXT_PUBLIC_APP_URL"))
	}
	if appURL == "" {
		allowedDomain := strings.TrimSpace(os.Getenv("ALLOWED_REDIRECT_DOMAIN"))
		if allowedDomain == "" {
			return target
		}
		cleanDomain := strings.TrimPrefix(strings.TrimSpace(strings.ToLower(allowedDomain)), "https://")
		cleanDomain = strings.TrimPrefix(cleanDomain, "http://")
		cleanDomain = strings.Trim(cleanDomain, "/")
		if cleanDomain == "" {
			return target
		}
		if strings.HasPrefix(cleanDomain, "www.") {
			appURL = "https://" + cleanDomain
		} else {
			appURL = "https://www." + cleanDomain
		}
	}

	return strings.TrimSuffix(appURL, "/") + target
}

func determineRedirectTarget(r *http.Request, stateTarget string) string {
	// Priority 1: State parameter
	if stateTarget != "" {
		if decoded, err := base64.URLEncoding.DecodeString(stateTarget); err == nil {
			if candidate := string(decoded); isValidCandidate(candidate) {
				return maybeConvertToAppURL(candidate)
			}
		}
	}

	// Priority 2: Cookie fallback
	redirectCookie, err := r.Cookie("oauth_redirect")
	if err != nil || redirectCookie.Value == "" {
		return "/"
	}

	if unescaped, uErr := url.QueryUnescape(redirectCookie.Value); uErr == nil {
		if isValidCandidate(unescaped) {
			return maybeConvertToAppURL(unescaped)
		}
	} else if isValidCandidate(redirectCookie.Value) {
		return maybeConvertToAppURL(redirectCookie.Value)
	}

	return maybeConvertToAppURL("/")
}
