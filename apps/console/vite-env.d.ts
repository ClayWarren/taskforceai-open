/// <reference types="vite/client" />

// Vite asset imports with query strings
declare module '*?url' {
  const url: string;
  export default url;
}

/**
 * Vite environment variable types.
 *
 * This extends Vite's ImportMetaEnv to include our NEXT_PUBLIC_* variables
 * so TypeScript knows about them when accessed via import.meta.env.
 */
interface ImportMetaEnv {
  readonly NEXT_PUBLIC_SITE_URL?: string;
  readonly NEXT_PUBLIC_API_URL?: string;
  readonly NEXT_PUBLIC_SENTRY_DSN?: string;
  readonly NEXT_PUBLIC_MOBILE_IOS_APP_URL?: string;
  readonly NEXT_PUBLIC_MOBILE_ANDROID_APP_URL?: string;
  readonly NEXT_PUBLIC_APP_VERSION?: string;
  readonly NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?: string;
  readonly NEXT_PUBLIC_STREAMING_DEBUG?: string;
  readonly NEXT_PUBLIC_TAURI_FORCE_READY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
