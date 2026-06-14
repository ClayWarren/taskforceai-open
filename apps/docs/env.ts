import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    VERCEL_URL: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
    // Allow empty string (will be treated as undefined due to emptyStringAsUndefined)
    NEXT_PUBLIC_MOBILE_IOS_APP_URL: z.union([z.string().url(), z.literal('')]).optional(),
    NEXT_PUBLIC_MOBILE_ANDROID_APP_URL: z.union([z.string().url(), z.literal('')]).optional(),
  },
  runtimeEnv: {
    NODE_ENV: process.env['NODE_ENV'],
    VERCEL_URL: process.env['VERCEL_URL'],
    NEXT_PUBLIC_SITE_URL: process.env['NEXT_PUBLIC_SITE_URL'],
    NEXT_PUBLIC_MOBILE_IOS_APP_URL: process.env['NEXT_PUBLIC_MOBILE_IOS_APP_URL'],
    NEXT_PUBLIC_MOBILE_ANDROID_APP_URL: process.env['NEXT_PUBLIC_MOBILE_ANDROID_APP_URL'],
  },
  skipValidation:
    process.env['NODE_ENV'] === 'test' || process.env['NEXT_PHASE'] === 'phase-production-build',
  emptyStringAsUndefined: true,
});
