#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

type RootPackageJson = {
  packageManager?: string;
};

const findRepoRoot = (startDir: string): string => {
  let current = path.resolve(startDir);

  while (true) {
    const packageJsonPath = path.join(current, 'package.json');
    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as RootPackageJson;
      if (packageJson.packageManager?.startsWith('bun@')) {
        return current;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error('Could not find repository root with a Bun packageManager pin.');
    }
    current = parent;
  }
};

const repoRoot = findRepoRoot(process.cwd());
const packageJson = JSON.parse(
  readFileSync(path.join(repoRoot, 'package.json'), 'utf8')
) as RootPackageJson;
const bunVersion = packageJson.packageManager?.match(/^bun@(.+)$/)?.[1];

if (!bunVersion) {
  throw new Error('Root package.json must pin packageManager as bun@<version>.');
}

const result = spawnSync(
  'bunx',
  [
    '--no-save',
    `bun@${bunVersion}`,
    'install',
    '--cwd',
    repoRoot,
    '--frozen-lockfile',
    '--os=*',
    '--cpu=*',
  ],
  {
    cwd: tmpdir(),
    env: { ...process.env, NODE_ENV: 'development' },
    stdio: 'inherit',
  }
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
