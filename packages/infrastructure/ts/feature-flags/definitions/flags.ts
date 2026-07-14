/**
 * Feature Flag Definitions
 *
 * TypeScript feature flag definitions for TaskForceAI.
 * Go definitions are mirrored in packages/infrastructure/feature-flags/pkg/flags.go
 * and guarded by package tests.
 */

export const FEATURE_FLAGS = {
  // Modes & Capabilities
  MODE_COMPUTER_USE: 'mode-computer-use',
  MODE_AUTONOMY: 'mode-autonomy',
  MODE_QUICK: 'mode-quick',
  MODE_IMAGE_GEN: 'mode-image-gen',
  ENABLE_LATEX_RENDERING_WEB: 'enable-latex-rendering-web',
  ENABLE_LATEX_RENDERING_MOBILE: 'enable-latex-rendering-mobile',

  // Billing & Entitlements
  ENABLE_PAYMENTS: 'enable-payments',
  ENABLE_PRO_FEATURES: 'enable-pro-features',

  // Infrastructure
  OTEL_TRACING_HIGH: 'otel-tracing-high',
  FLAG_REDIS_CACHE_SKIP: 'redis-cache-skip',
} as const;

export type FeatureFlagKey = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];

/**
 * Default values for each feature flag when the provider is unavailable.
 */
export const FEATURE_FLAG_DEFAULTS: Record<FeatureFlagKey, boolean> = {
  [FEATURE_FLAGS.MODE_COMPUTER_USE]: false,
  [FEATURE_FLAGS.MODE_AUTONOMY]: false,
  [FEATURE_FLAGS.MODE_QUICK]: true,
  [FEATURE_FLAGS.MODE_IMAGE_GEN]: false,
  [FEATURE_FLAGS.ENABLE_LATEX_RENDERING_WEB]: true,
  [FEATURE_FLAGS.ENABLE_LATEX_RENDERING_MOBILE]: false,
  [FEATURE_FLAGS.ENABLE_PAYMENTS]: true,
  [FEATURE_FLAGS.ENABLE_PRO_FEATURES]: false,
  [FEATURE_FLAGS.OTEL_TRACING_HIGH]: false,
  [FEATURE_FLAGS.FLAG_REDIS_CACHE_SKIP]: false,
};
