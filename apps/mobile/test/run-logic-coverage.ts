import { Glob, spawn } from 'bun';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { mergeLcovRecords, parseLcov, toLcov, type LcovRecord } from './lcov';

const rootDir = path.resolve(import.meta.dir, '..');
const coverageDir = path.join(rootDir, 'coverage', 'bun');
const tempCoverageDir = path.join(coverageDir, '.tmp');

const INCLUDE = [
  'src/__tests__/logic/*.test.ts',
  'src/storage/__tests__/*.test.ts',
  'src/qa/__tests__/*.test.ts',
];

if (existsSync(coverageDir)) {
  rmSync(coverageDir, { recursive: true });
}
mkdirSync(tempCoverageDir, { recursive: true });

const testFiles: string[] = [];
for (const pattern of INCLUDE) {
  const glob = new Glob(pattern);
  for (const match of glob.scanSync({ cwd: rootDir, absolute: true })) {
    testFiles.push(match);
  }
}

if (testFiles.length === 0) {
  console.log('No logic tests found.');
  process.exit(0);
}

console.log(`Running ${testFiles.length} logic test files with coverage...`);

const merged = new Map<string, LcovRecord>();
let exitCode = 0;

for (const file of testFiles.toSorted()) {
  const relativePath = path.relative(rootDir, file);
  const fileCoverageDir = path.join(
    tempCoverageDir,
    relativePath.replaceAll(path.sep, '__').replace(/[^a-zA-Z0-9_.-]/g, '_')
  );

  const proc = spawn({
    cmd: [
      'bun',
      'test',
      file,
      '--preload',
      './test/bun-setup.ts',
      '--coverage',
      `--coverage-dir=${fileCoverageDir}`,
      '--coverage-reporter=lcov',
    ],
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, BUN_TEST: '1' },
    cwd: rootDir,
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;

  if (code !== 0) {
    process.stdout.write(`\n\x1b[31mFAIL\x1b[0m ${relativePath}\n`);
    process.stdout.write(stdout);
    process.stderr.write(stderr);
    exitCode = code;
    continue;
  }

  process.stdout.write('.');
  const lcovPath = path.join(fileCoverageDir, 'lcov.info');
  if (existsSync(lcovPath)) {
    mergeLcovRecords(
      merged,
      parseLcov(readFileSync(lcovPath, 'utf-8'), undefined, true),
      'logic'
    );
  }
}

process.stdout.write('\n');

if (exitCode !== 0) {
  process.exit(exitCode);
}

if (merged.size === 0) {
  console.error('No coverage data generated');
  process.exit(1);
}

const lcovPath = path.join(coverageDir, 'lcov.info');
writeFileSync(lcovPath, toLcov(merged, 'logic'));
rmSync(tempCoverageDir, { recursive: true, force: true });
console.log(`\nCoverage written to ${lcovPath}`);
