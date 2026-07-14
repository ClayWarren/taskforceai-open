// @ts-nocheck
import { defineConfig } from '@tanstack/react-start/config';

export default defineConfig({
  tsr: {
    appDirectory: 'app',
  },
  server: {
    preset: 'node',
  },
});
