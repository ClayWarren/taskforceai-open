/// <reference types="vite/client" />

// Vite asset imports with query strings
declare module '*?url' {
  const url: string;
  export default url;
}

/**
 * Vite environment variable types.
 *
 * This extends Vite's ImportMetaEnv to include our VITE_* variables
 * so TypeScript knows about them when accessed via import.meta.env.
 */
interface ImportMetaEnv {
  readonly VITE_SITE_URL?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_MOBILE_IOS_APP_URL?: string;
  readonly VITE_MOBILE_ANDROID_APP_URL?: string;
  readonly VITE_APP_VERSION?: string;
  readonly VITE_VERCEL_GIT_COMMIT_SHA?: string;
  readonly VITE_STATSIG_CLIENT_KEY?: string;
  readonly VITE_STREAMING_DEBUG?: string;
  readonly VITE_TAURI_FORCE_READY?: string;
  readonly VITE_ENABLE_TEST_LOGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
