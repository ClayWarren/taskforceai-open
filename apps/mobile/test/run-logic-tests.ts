import { Glob, spawn } from 'bun';
import path from 'path';

const INCLUDE = ['src/__tests__/logic/*.test.ts', 'src/storage/__tests__/*.test.ts', 'src/qa/__tests__/*.test.ts'];
const rootDir = path.resolve(import.meta.dir, '..');

const collectTests = (): string[] => {
  const files = new Set<string>();
  for (const pattern of INCLUDE) {
    const glob = new Glob(pattern);
    for (const match of glob.scanSync({ cwd: rootDir, absolute: true })) {
      files.add(match);
    }
  }
  return Array.from(files).toSorted();
};

const tests = collectTests();

if (tests.length === 0) {
  console.log('No logic tests found.');
  process.exit(0);
}

const scriptIndex = Bun.argv.findIndex((arg) => arg.includes('run-logic-tests'));
const passthroughArgs = scriptIndex === -1 ? [] : Bun.argv.slice(scriptIndex + 1);
const preloadArgs = ['--preload', './test/bun-setup.ts'];
let exitCode = 0;

const runFile = async (file: string): Promise<number> => {
  const relativePath = path.relative(rootDir, file);
  const proc = spawn({
    cmd: ['bun', 'test', ...preloadArgs, ...passthroughArgs, file],
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
    cwd: rootDir,
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;

  if (code !== 0) {
    process.stdout.write(`\n\x1b[31mFAIL\x1b[0m ${relativePath}\n`);
    process.stdout.write(stdout);
    process.stderr.write(stderr);
  } else {
    process.stdout.write('.');
  }
  return code;
};

process.stdout.write(`Running ${tests.length} logic tests: `);

for (const file of tests) {
  const code = await runFile(file);
  if (code !== 0) {
    exitCode = code;
  }
}

process.stdout.write('\n');
process.exit(exitCode);
