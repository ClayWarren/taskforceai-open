import { Glob, spawn } from 'bun';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dir, '..');
const coverageDir = path.join(rootDir, 'coverage', 'bun');
const tempCoverageDir = path.join(coverageDir, '.tmp');

const INCLUDE = [
  'src/__tests__/logic/*.test.ts',
  'src/storage/__tests__/*.test.ts',
  'src/qa/__tests__/*.test.ts',
];

interface LcovRecord {
  sourceFile: string;
  functionName: string;
  functionFound: number;
  functionHit: number;
  lineData: Map<number, number>;
}

function parseLcov(content: string): Map<string, LcovRecord> {
  const records = new Map<string, LcovRecord>();
  let currentRecord: LcovRecord | null = null;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const [prefix, ...rest] = trimmed.split(':');
    const value = rest.join(':');

    switch (prefix) {
      case 'SF':
        currentRecord = {
          sourceFile: value,
          functionName: '',
          functionFound: 0,
          functionHit: 0,
          lineData: new Map(),
        };
        records.set(value, currentRecord);
        break;
      case 'FN':
        if (currentRecord) {
          currentRecord.functionName = value.split(',')[1] || value;
        }
        break;
      case 'FNF':
        if (currentRecord) currentRecord.functionFound = Number.parseInt(value, 10) || 0;
        break;
      case 'FNH':
        if (currentRecord) currentRecord.functionHit = Number.parseInt(value, 10) || 0;
        break;
      case 'DA': {
        if (currentRecord) {
          const [lineNumberRaw, hitCountRaw] = value.split(',');
          const lineNumber = Number.parseInt(lineNumberRaw ?? '', 10);
          const hitCount = Number.parseInt(hitCountRaw ?? '', 10);
          if (Number.isFinite(lineNumber) && Number.isFinite(hitCount)) {
            currentRecord.lineData.set(
              lineNumber,
              (currentRecord.lineData.get(lineNumber) ?? 0) + hitCount
            );
          }
        }
        break;
      }
    }
  }

  return records;
}

function mergeRecords(target: Map<string, LcovRecord>, source: Map<string, LcovRecord>): void {
  for (const [sourceFile, record] of source) {
    const existing = target.get(sourceFile);
    if (!existing) {
      target.set(sourceFile, {
        ...record,
        lineData: new Map(record.lineData),
      });
      continue;
    }

    for (const [lineNumber, hitCount] of record.lineData) {
      existing.lineData.set(lineNumber, (existing.lineData.get(lineNumber) ?? 0) + hitCount);
    }
    existing.functionFound = Math.max(existing.functionFound, record.functionFound);
    existing.functionHit = Math.max(existing.functionHit, record.functionHit);
    if (!existing.functionName) {
      existing.functionName = record.functionName;
    }
  }
}

function toLcov(records: Map<string, LcovRecord>): string {
  const lines: string[] = [];

  for (const record of Array.from(records.values()).toSorted((a, b) =>
    a.sourceFile.localeCompare(b.sourceFile)
  )) {
    const sortedLines = Array.from(record.lineData.entries()).toSorted(([a], [b]) => a - b);
    const linesHit = sortedLines.filter(([, hitCount]) => hitCount > 0).length;

    lines.push('TN:');
    lines.push(`SF:${record.sourceFile}`);
    if (record.functionName) {
      lines.push(`FN:0,${record.functionName}`);
    }
    lines.push(`FNF:${record.functionFound}`);
    lines.push(`FNH:${record.functionHit}`);
    for (const [lineNumber, hitCount] of sortedLines) {
      lines.push(`DA:${lineNumber},${hitCount}`);
    }
    lines.push(`LF:${sortedLines.length}`);
    lines.push(`LH:${linesHit}`);
    lines.push('end_of_record');
  }

  return `${lines.join('\n')}\n`;
}

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
    mergeRecords(merged, parseLcov(readFileSync(lcovPath, 'utf-8')));
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
writeFileSync(lcovPath, toLcov(merged));
rmSync(tempCoverageDir, { recursive: true, force: true });
console.log(`\nCoverage written to ${lcovPath}`);
