#!/usr/bin/env bun

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Generator, getConfig } from '@tanstack/router-generator';

type RouteApp = {
  name: string;
  routeFileIgnorePattern?: string;
};

const testRouteFileIgnorePattern = String.raw`\.(test|spec)\.[tj]sx?$`;

const routeApps: Array<RouteApp> = [
  { name: 'admin' },
  {
    name: 'console',
    routeFileIgnorePattern: testRouteFileIgnorePattern,
  },
  {
    name: 'marketing',
    routeFileIgnorePattern: testRouteFileIgnorePattern,
  },
  { name: 'status' },
  { name: 'web' },
];

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requestedApps = new Set(process.argv.slice(2));

const selectedApps =
  requestedApps.size === 0 ? routeApps : routeApps.filter((app) => requestedApps.has(app.name));

const unknownApps = [...requestedApps].filter(
  (name) => !routeApps.some((app) => app.name === name)
);

if (unknownApps.length > 0) {
  throw new Error(`Unknown route app(s): ${unknownApps.join(', ')}`);
}

for (const app of selectedApps) {
  const appDirectory = path.join(repoRoot, 'apps', app.name);
  const config = getConfig(
    {
      disableLogging: true,
      generatedRouteTree: './app/routeTree.gen.ts',
      routeTreeFileFooter: [
        "import type { getRouter } from './router.tsx'",
        "import type { createStart } from '@tanstack/react-start'",
        "declare module '@tanstack/react-start' {",
        '  interface Register {',
        '    ssr: true',
        '    router: Awaited<ReturnType<typeof getRouter>>',
        '  }',
        '}',
      ],
      routeFileIgnorePattern: app.routeFileIgnorePattern ?? testRouteFileIgnorePattern,
      routesDirectory: './app/routes',
    },
    appDirectory
  );

  await new Generator({ config, root: appDirectory }).run();
  console.log(`Generated ${path.relative(repoRoot, config.generatedRouteTree)}`);
}
