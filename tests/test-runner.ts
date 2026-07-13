import { Glob, spawn, spawnSync } from 'bun';
import fs from 'fs';
import path from 'path';

import {
  enforceLineCoverageThreshold,
  filterCoverageFiles,
  filterNonExecutableLines,
  parseLcovWithLines,
  printCompactCoverageSummary,
  type CoverageSummary,
  writeCoverageSummary,
} from './coverage-utils';

export type CoveragePrinter = (summary: CoverageSummary) => void;

export const PACKAGE_COVERAGE_IGNORE = [
  '**/*.test.{ts,tsx}',
  '**/*.spec.{ts,tsx}',
  '**/*.test-utils.{ts,tsx}',
  '**/__mocks__/**',
  'node_modules/**',
  '**/dist/**',
  'generated/**',
  '**/benchmarks/**',
  '**/*.bench.ts',
  '**/*.bench.tsx',
  '**/scripts/**',
  'packages/infrastructure/ts/db-sync/scripts/**',
  '**/voice/src/adapters/*.ts',
  '**/voice/src/defaultAdapterFactory.ts',
  '**/voice/src/VoiceManager.ts',
  '**/voice/src/index.ts',
  '**/voice/src/useVoice.ts',
  '**/voice/src/detectPlatform.ts',
  '**/client-core/src/logger/console-bridge.ts',
  '**/client-core/src/logger/transports/sentry.ts',
  '**/client-core/src/logger/logger.ts',
  '**/client-core/src/sync/manager-helpers.ts',
  '**/client-core/src/sync/client.ts',
  '**/ui-kit/src/dropdown-menu.tsx',
  '**/ui-kit/src/popover.tsx',
  '**/ui-kit/src/tooltip.tsx',
];

export const BACKEND_COVERAGE_IGNORE = [
  ...PACKAGE_COVERAGE_IGNORE,
  '**/.next/**',
  '**/route.ts',
  '**/route.tsx',
  '**/*.defaults.ts',
  '**/*.prisma.ts',
  '**/db-health.ts',
  '**/sync-service.ts',
  '**/__test-utils__/**',
  '**/client-core/src/streaming/normalization.ts',
  '**/client-core/src/utils/computer-use.ts',
  '**/client-core/src/chat/budget.ts',
];

export const testEnv = (extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  ({
    ...process.env,
    NODE_ENV: 'test',
    BUN_TEST: '1',
    ...extra,
  }) as NodeJS.ProcessEnv;

const normalizeBunCommand = (command: string[]): string[] => {
  if (command[0] === 'bun') {
    return [process.execPath, ...command.slice(1)];
  }
  if (command[0] === 'bunx') {
    return [process.execPath, 'x', ...command.slice(1)];
  }
  return command;
};

export const argsAfterScript = (scriptName: string): string[] => {
  const index = Bun.argv.findIndex((arg) => arg.includes(scriptName));
  return index === -1 ? [] : Bun.argv.slice(index + 1);
};

export const cleanCoverageArgs = (args: string[], extraPrefixes: string[] = []): string[] =>
  args.filter(
    (arg) =>
      arg !== '--coverage' &&
      !arg.startsWith('--coverage-reporter') &&
      !arg.startsWith('--coverage-dir') &&
      !extraPrefixes.some((prefix) => arg.startsWith(prefix))
  );

export const collectTestFiles = ({
  include,
  exclude = [],
  rootDir = process.cwd(),
  matchCandidate = false,
}: {
  include: string[];
  exclude?: string[];
  rootDir?: string;
  matchCandidate?: boolean;
}): string[] => {
  const includeGlobs = include.map((pattern) => new Glob(pattern));
  const excludeGlobs = exclude.map((pattern) => new Glob(pattern));
  const files = new Set<string>();

  for (const includeGlob of includeGlobs) {
    for (const match of includeGlob.scanSync({ cwd: rootDir, absolute: true })) {
      const relativePath = path.relative(rootDir, match);
      const posixPath = relativePath.split(path.sep).join(path.posix.sep);
      const candidate = `./${posixPath}`;
      if (
        excludeGlobs.some(
          (excludeGlob) =>
            excludeGlob.match(posixPath) || (matchCandidate && excludeGlob.match(candidate))
        )
      ) {
        continue;
      }
      files.add(candidate);
    }
  }

  return Array.from(files).toSorted();
};

export const normalizePositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
};

export const selectShard = (files: string[], index: number, count: number) =>
  files.filter((_, fileIndex) => fileIndex % count === index);

export const runBatch = ({
  command,
  env = testEnv(),
  cwd,
}: {
  command: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}): number => {
  const result = spawnSync({
    cmd: normalizeBunCommand(command),
    stdout: 'inherit',
    stderr: 'inherit',
    env,
    cwd,
  });
  return result.exitCode ?? (result.success ? 0 : 1);
};

export const runFilesWithDots = async ({
  files,
  concurrency = 1,
  env = testEnv(),
  commandForFile,
}: {
  files: string[];
  concurrency?: number;
  env?: NodeJS.ProcessEnv;
  commandForFile: (file: string) => { cmd: string[]; cwd?: string };
}): Promise<number> => {
  let exitCode = 0;
  const queue = files.slice();
  const workerCount = Math.min(Math.max(1, concurrency), Math.max(1, queue.length));

  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length > 0) {
      const file = queue.shift();
      if (!file) {
        return;
      }
      const { cmd, cwd } = commandForFile(file);
      const proc = spawn({
        cmd: normalizeBunCommand(cmd),
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
        env,
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const code = await proc.exited;

      if (code !== 0) {
        process.stdout.write(`\n\x1b[31mFAIL\x1b[0m ${file}\n`);
        process.stdout.write(stdout);
        process.stderr.write(stderr);
        exitCode = code;
      } else {
        process.stdout.write('.');
      }
    }
  });

  await Promise.all(workers);
  process.stdout.write('\n');
  return exitCode;
};

export const runFilesInherit = async ({
  files,
  concurrency,
  env = testEnv(),
  stopOnFirstFailure = false,
  label,
  commandForFile,
}: {
  files: string[];
  concurrency: number;
  env?: NodeJS.ProcessEnv;
  stopOnFirstFailure?: boolean;
  label?: string;
  commandForFile: (file: string, index: number) => string[];
}): Promise<number> => {
  let nextIndex = 0;
  let exitCode = 0;

  const runWorker = async (workerId: number) => {
    while (true) {
      if (stopOnFirstFailure && exitCode !== 0) {
        return;
      }
      const index = nextIndex;
      nextIndex += 1;
      const file = files[index];
      if (!file) {
        return;
      }
      if (label) {
        process.stdout.write(`\n[${label}][w${workerId}] RUN ${file}\n`);
      }
      const code = await spawn({
        cmd: normalizeBunCommand(commandForFile(file, index)),
        stdout: 'inherit',
        stderr: 'inherit',
        env,
      }).exited;
      const normalized = code === 0 ? 0 : 1;
      if (label) {
        process.stdout.write(`[${label}][w${workerId}] DONE ${file} -> ${normalized}\n`);
      }
      if (normalized !== 0 && exitCode === 0) {
        exitCode = normalized;
      }
    }
  };

  const workerCount = Math.min(Math.max(1, concurrency), files.length);
  await Promise.all(Array.from({ length: workerCount }, (_, index) => runWorker(index + 1)));
  return exitCode;
};

export const mergeLcovParts = ({
  partsDir,
  lcovPath,
  warnOnly = false,
}: {
  partsDir: string;
  lcovPath: string;
  env?: NodeJS.ProcessEnv;
  warnOnly?: boolean;
}): number => {
  const lcovFiles = fs
    .readdirSync(partsDir)
    .map((dir) => path.join(partsDir, dir, 'lcov.info'))
    .filter((file) => fs.existsSync(file));
  if (lcovFiles.length === 0) {
    return 0;
  }

  if (warnOnly) {
    process.stdout.write(`\n[coverage] merging ${lcovFiles.length} lcov files...\n`);
  }

  try {
    fs.mkdirSync(path.dirname(lcovPath), { recursive: true });
    // Repeated SF records are valid LCOV. Our parser intentionally combines
    // their DA hit counts, so concatenating avoids a network-dependent bunx
    // package while retaining deterministic coverage semantics.
    const content = lcovFiles.map((file) => fs.readFileSync(file, 'utf8').trim()).join('\n');
    fs.writeFileSync(lcovPath, `${content}\n`);
    return 0;
  } catch (error) {
    if (warnOnly) {
      process.stderr.write(
        `[coverage] Warning: lcov merge failed: ${error instanceof Error ? error.message : String(error)}\n`
      );
    }
    return 1;
  }
};

type CoveragePartResult = {
  file: string;
  exitCode: number;
  output: string;
};

export const runLcovCoverage = async ({
  files,
  coverageRoot,
  lcovPath,
  summaryPath,
  cleanedArgs,
  includePatterns,
  ignorePatterns,
  thresholdLabel,
  summaryLabel = thresholdLabel,
  preloadArgs = [],
  env = testEnv(),
  printSummary = printCompactCoverageSummary,
  emptyCoverageIsFailure = true,
  testCwd,
  testFileForCoverage = (file) => file,
}: {
  files: string[];
  coverageRoot: string;
  lcovPath: string;
  summaryPath: string;
  cleanedArgs: string[];
  includePatterns: string[];
  ignorePatterns: string[];
  thresholdLabel: string;
  summaryLabel?: string;
  preloadArgs?: string[];
  env?: NodeJS.ProcessEnv;
  printSummary?: CoveragePrinter;
  emptyCoverageIsFailure?: boolean;
  testCwd?: string;
  testFileForCoverage?: (file: string) => string;
}): Promise<number> => {
  const partsDir = path.join(coverageRoot, 'parts');
  fs.rmSync(coverageRoot, { recursive: true, force: true });
  fs.mkdirSync(partsDir, { recursive: true });

  const pending = files.map((file, index) => ({ file, index }));
  const workerCount = Math.min(
    normalizePositiveInt(process.env['COVERAGE_WORKERS'], 4),
    files.length
  );
  const results: CoveragePartResult[] = [];

  const runCoveragePart = async (file: string, index: number): Promise<CoveragePartResult> => {
    const partDir = path.join(partsDir, `part-${index}`);
    fs.mkdirSync(partDir, { recursive: true });
    const testFile = testFileForCoverage(file);
    const proc = spawn({
      cmd: [
        process.execPath,
        'test',
        '--isolate',
        ...preloadArgs,
        '--coverage',
        '--coverage-reporter=lcov',
        '--concurrency=1',
        `--coverage-dir=${partDir}`,
        ...cleanedArgs,
        testFile,
      ],
      cwd: testCwd,
      stdout: 'pipe',
      stderr: 'pipe',
      env,
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return {
      file,
      exitCode,
      output: [stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join('\n'),
    };
  };

  const worker = async () => {
    while (pending.length > 0) {
      const next = pending.shift();
      if (!next) {
        return;
      }
      const result = await runCoveragePart(next.file, next.index);
      results[next.index] = result;
      if (result.output.length > 0) {
        process.stdout.write(`${result.output}\n`);
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  const hasFailures = results.some((result) => result?.exitCode === 1);

  const mergeExit = mergeLcovParts({ partsDir, lcovPath, env });
  if (mergeExit !== 0) {
    return mergeExit;
  }

  try {
    const lcovData = parseLcovWithLines(lcovPath, testCwd ?? process.cwd());
    const filteredByExecutable = filterNonExecutableLines(lcovData, process.cwd());
    const coverageFiles = filterCoverageFiles(filteredByExecutable, {
      rootDir: process.cwd(),
      includePatterns,
      ignorePatterns,
    });

    if (coverageFiles.length === 0) {
      if (emptyCoverageIsFailure) {
        process.stderr.write(`[coverage] No ${thresholdLabel} coverage entries found.\n`);
        return 1;
      }
      return hasFailures ? 1 : 0;
    }

    const summary = writeCoverageSummary(coverageFiles, summaryPath);
    process.stdout.write(`[coverage] ${summaryLabel} summary written to ${summaryPath}\n`);
    printSummary(summary);
    const thresholdExit = enforceLineCoverageThreshold(summary, thresholdLabel);
    return hasFailures || thresholdExit !== 0 ? 1 : 0;
  } catch (error) {
    process.stderr.write(
      `[coverage] Failed to process ${thresholdLabel} coverage: ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
    return 1;
  }
};
