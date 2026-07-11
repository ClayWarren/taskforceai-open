import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig, type PluginOption, type UserConfig } from 'vite';

type TanStackAppConfig = {
  plugins?: PluginOption[];
  start?: NonNullable<Parameters<typeof tanstackStart>[0]>;
  server?: UserConfig['server'];
  preview?: UserConfig['preview'];
  build?: UserConfig['build'];
  define?: UserConfig['define'];
  optimizeDeps?: UserConfig['optimizeDeps'];
};

export const defineTanStackAppConfig = ({
  plugins = [],
  start,
  server,
  preview,
  build,
  define,
  optimizeDeps,
}: TanStackAppConfig) => {
  const isProduction = process.env.NODE_ENV === 'production';

  return defineConfig({
    plugins: [
      ...plugins,
      tailwindcss(),
      tanstackStart({
        srcDirectory: 'app',
        ...start,
      }),
      viteReact(),
    ],
    resolve: {
      tsconfigPaths: true,
    },
    server,
    preview,
    envPrefix: ['NEXT_PUBLIC_', 'VITE_'],
    build: {
      chunkSizeWarningLimit: 2500,
      rollupOptions: {
        external: [/^node:/],
      },
      ...build,
    },
    define,
    ...(isProduction && {
      ssr: {
        noExternal: true,
      },
    }),
    optimizeDeps,
  });
};
