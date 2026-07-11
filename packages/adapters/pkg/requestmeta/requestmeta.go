package requestmeta

import (
	"net"
	"net/http"
	"os"
	"strings"
)

var cloudflareProxies = []string{
	"103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "104.16.0.0/13", "104.24.0.0/14",
	"108.162.192.0/18", "131.0.72.0/22", "141.101.64.0/18", "162.158.0.0/15", "172.64.0.0/13",
	"173.245.48.0/20", "188.114.96.0/20", "190.93.240.0/20", "197.234.240.0/22", "198.41.128.0/17",
	"2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32",
	"2a06:98c0::/29", "2c0f:f248::/32",
}

var trustedProxies = append([]string{}, append(cloudflareProxies,
	"76.76.21.0/24",
)...)

func isTrustedProxyIP(ip net.IP) bool {
	return ipInCIDRs(ip, trustedProxies)
}

func isCloudflareProxyIP(ip net.IP) bool {
	return ipInCIDRs(ip, cloudflareProxies)
}

func ipInCIDRs(ip net.IP, cidrs []string) bool {
	if ip == nil {
		return false
	}

	for _, cidr := range cidrs {
		_, network, err := net.ParseCIDR(cidr)
		if err == nil && network.Contains(ip) {
			return true
		}
	}

	return false
}

func parseRemoteIP(remoteAddr string) net.IP {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	return net.ParseIP(strings.TrimSpace(host))
}

func productionEnv() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("NODE_ENV")), "production") ||
		strings.EqualFold(strings.TrimSpace(os.Getenv("GO_ENV")), "production") ||
		strings.TrimSpace(os.Getenv("VERCEL")) != ""
}

func remoteHost(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil || host == "" {
		return remoteAddr
	}
	return host
}

func forwardedClientIP(value string) string {
	parts := strings.Split(value, ",")
	for i := len(parts) - 1; i >= 0; i-- {
		candidate := strings.TrimSpace(parts[i])
		if candidate == "" {
			continue
		}
		ip := net.ParseIP(candidate)
		if ip == nil || !isTrustedProxyIP(ip) {
			return candidate
		}
	}
	return ""
}

func GetClientIP(r *http.Request) *string {
	remoteIP := parseRemoteIP(r.RemoteAddr)
	production := productionEnv()
	if production && !isTrustedProxyIP(remoteIP) {
		host := remoteHost(r.RemoteAddr)
		return &host
	}

	headers := []string{}
	if !production || isCloudflareProxyIP(remoteIP) {
		headers = append(headers, "CF-Connecting-IP")
	}
	headers = append(headers,
		"X-Vercel-Forwarded-For",
		"X-Forwarded-For",
		"X-Real-IP",
	)

	for _, header := range headers {
		if value := r.Header.Get(header); value != "" {
			ip := forwardedClientIP(value)
			if ip != "" {
				return &ip
			}
		}
	}

	return nil
}

func GetUserAgent(r *http.Request) *string {
	if ua := r.Header.Get("User-Agent"); ua != "" {
		return &ua
	}
	return nil
}
