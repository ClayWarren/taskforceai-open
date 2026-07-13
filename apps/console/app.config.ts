// @ts-nocheck
import { defineConfig } from '@tanstack/react-start/config';

export default defineConfig({
  tsr: {
    appDirectory: 'app',
    routeFileIgnorePattern: '\\.(test|spec)\\.(ts|tsx)$',
  },
  server: {
    // Use node preset - custom build script handles Vercel-specific output
    preset: 'node',
  },
});
