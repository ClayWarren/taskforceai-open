package identity

import (
	"strings"
)

const (
	DeviceLoginExpirySeconds               = 10 * 60
	DeviceLoginPollIntervalSeconds         = 5
	DeviceLoginUserCodeAlphabet            = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	DeviceLoginCodeGenerationMaxAttempts   = 5
	deviceLoginNormalizedUserCodeLength    = 8
	deviceLoginFormattedUserCodeChunkWidth = 4
)

func NormalizeDeviceLoginUserCode(userCode string) string {
	var normalized strings.Builder
	for _, r := range userCode {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			normalized.WriteRune(r)
		}
	}
	raw := strings.ToUpper(normalized.String())
	if len(raw) == deviceLoginNormalizedUserCodeLength {
		return raw[:deviceLoginFormattedUserCodeChunkWidth] + "-" + raw[deviceLoginFormattedUserCodeChunkWidth:]
	}
	return raw
}
