package pkg

// Feature Flag Constants
const (
	// Modes & Capabilities
	ModeComputerUse = "mode-computer-use"
	ModeAutonomy    = "mode-autonomy"
	ModeQuick       = "mode-quick"
	ModeImageGen    = "mode-image-gen"

	EnableLatexRenderingWeb    = "enable-latex-rendering-web"
	EnableLatexRenderingMobile = "enable-latex-rendering-mobile"

	// Billing & Entitlements
	EnablePayments    = "enable-payments"
	EnableProFeatures = "enable-pro-features"

	// Infrastructure
	OtelTracingHigh    = "otel-tracing-high"
	FlagRedisCacheSkip = "redis-cache-skip"
)

// FeatureFlagDefaults provides the default value for each flag.
var FeatureFlagDefaults = map[string]bool{
	ModeComputerUse:            false,
	ModeAutonomy:               false,
	ModeQuick:                  true,
	ModeImageGen:               false,
	EnableLatexRenderingWeb:    true,
	EnableLatexRenderingMobile: false,
	EnablePayments:             true,
	EnableProFeatures:          false,
	OtelTracingHigh:            false,
	FlagRedisCacheSkip:         false,
}
