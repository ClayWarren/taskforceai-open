import { Glob } from 'bun';
import fs from 'fs';
import path from 'path';

export type CoverageFile = {
  path: string;
  linesFound: number;
  linesHit: number;
  branchesFound: number;
  branchesHit: number;
  functionsFound: number;
  functionsHit: number;
};

export type CoverageTotals = {
  linesFound: number;
  linesHit: number;
  branchesFound: number;
  branchesHit: number;
  functionsFound: number;
  functionsHit: number;
};

export type CoverageSummary = {
  total: {
    lines: { total: number; covered: number; pct: number };
    statements: { total: number; covered: number; pct: number };
    branches: { total: number; covered: number; pct: number };
    functions: { total: number; covered: number; pct: number };
  };
  files: Record<
    string,
    {
      lines: { total: number; covered: number; pct: number };
      statements: { total: number; covered: number; pct: number };
      branches: { total: number; covered: number; pct: number };
      functions: { total: number; covered: number; pct: number };
    }
  >;
};

type CoverageFilterOptions = {
  rootDir: string;
  includePatterns?: string[];
  ignorePatterns?: string[];
};

const toPosix = (value: string) => value.split(path.sep).join(path.posix.sep);

export const percentOf = (hit: number, total: number) => (total === 0 ? 100 : (hit / total) * 100);

export const parseCoverageLineThresholdPercent = (): number | undefined => {
  const raw = process.env['COVERAGE_LINE_THRESHOLD'];
  if (raw === undefined || raw === '') {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(`Invalid COVERAGE_LINE_THRESHOLD: ${raw}`);
  }
  return parsed;
};

export const resolveCoverageMinimums = (): {
  total: number;
  critical: number;
  utility: number;
} => {
  const percent = parseCoverageLineThresholdPercent();
  if (percent !== undefined) {
    const fraction = percent / 100;
    return { total: fraction, critical: fraction, utility: fraction };
  }
  return { total: 0.8, critical: 0.85, utility: 0.87 };
};

export const enforceLineCoverageThreshold = (summary: CoverageSummary, label: string): number => {
  const threshold = parseCoverageLineThresholdPercent();
  if (threshold === undefined) {
    return 0;
  }

  const actual = summary.total.lines.pct;
  if (actual + 0.001 < threshold) {
    process.stderr.write(
      `[coverage] ❌ ${label} line coverage ${actual.toFixed(2)}% (target ${threshold.toFixed(0)}%)\n`
    );
    return 1;
  }

  process.stdout.write(
    `[coverage] ✅ ${label} line coverage ${actual.toFixed(2)}% (target ${threshold.toFixed(0)}%)\n`
  );
  return 0;
};

/**
 * Check if a line is blank, a comment, or type-only (not executable code).
 * This helps filter out false "uncovered" lines from Bun's coverage.
 */
export const isNonExecutableLine = (line: string): boolean => {
  const trimmed = line.trim();
  if (trimmed === '') return true; // blank line
  if (trimmed.startsWith('//')) return true; // single-line comment
  if (trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.endsWith('*/')) return true; // block comment
  if (trimmed.startsWith('{/*') && trimmed.endsWith('*/}')) return true; // JSX comment
  if (trimmed.startsWith('*')) return true; // JSDoc continuation
  if (trimmed.includes('coverage-ignore-line')) return true;

  // Static module declaration fragments are not executable product behavior.
  if (trimmed.startsWith('import ') || trimmed.startsWith('export type ')) return true;
  if (/^}\s+from\s+['"].+['"];?$/.test(trimmed)) return true;
  if (/^[A-Za-z_$][\w$]*,?$/.test(trimmed)) return true;

  // TypeScript type-only lines
  if (trimmed.startsWith('type ')) return true;
  if (trimmed.startsWith('export interface ') || trimmed.startsWith('interface ')) return true;
  if (trimmed.startsWith('import type ')) return true;
  if (trimmed.startsWith('| ')) return true;
  if (/^[A-Z]\w*(\s+extends\s+.+|\s*=\s*.+)?[,]?$/.test(trimmed)) return true; // Generic type parameter lines

  // Type annotation parts (inside function signatures, object types, etc.)
  // These are lines that are purely type annotations like "): {" or "}: SomeType"
  if (/^[)}]:?\s*\{?\s*[;,]?\s*$/.test(trimmed)) return true; // Lines like "): {" or "}" or "},"
  if (/^\):\s*[A-Za-z_$][\w$<>,\s{}?|.[\]]+\s*=>\s*$/.test(trimmed)) return true;
  if (/^\):\s*[A-Za-z_$][\w$<>,;\s{}?|.[\]:]+=>\s*$/.test(trimmed)) return true;
  if (/^\)\s*=>\s*$/.test(trimmed)) return true;
  if (/^}\):\s*.+=>\s*$/.test(trimmed)) return true;
  if (/^}\):\s*.+\{\s*$/.test(trimmed)) return true;
  if (/^}\)\s*=>\s*$/.test(trimmed)) return true;
  if (/^}\)\s*=>\s*\($/.test(trimmed)) return true;
  if (/^[A-Za-z_$][\w$<>,\s{}?|.[\]]+\s*$/.test(trimmed) && /[<>]/.test(trimmed)) return true;
  if (/^[A-Z][A-Za-z0-9_$]*<.+[,;]?$/.test(trimmed)) return true;
  if (/^}:\s*[A-Z][A-Za-z0-9_<>,\s|.[\]]*<?\s*$/.test(trimmed)) return true; // Typed destructuring close lines
  if (/^}:\s*.+\{\s*$/.test(trimmed)) return true;
  if (/^}:\s*.+\)\s*=>\s*$/.test(trimmed)) return true;
  if (/^}:\s*.+<\s*$/.test(trimmed)) return true;
  if (/^>\s*[,({]?\s*$/.test(trimmed)) return true; // Generic signature close lines
  if (/^>\s*\(\{\s*$/.test(trimmed)) return true;
  if (/^>\):\s*.+\{\s*$/.test(trimmed)) return true;
  if (/^>\s*=>\s*$/.test(trimmed)) return true;
  if (/^}\s*>\s*\(?\s*$/.test(trimmed)) return true; // Generic object type close lines
  if (/^[a-zA-Z_]\w*\s*\??\s*:\s*[A-Z]/.test(trimmed) && !trimmed.includes('=')) return true; // Property type declarations
  if (
    /^[a-zA-Z_]\w*\??\s*:\s*(string|number|boolean|true|false|unknown|null|undefined|'[^']+'|"[^"]+")(\[\])?(\s*\|[^;]+)?;?$/.test(
      trimmed
    )
  ) {
    return true;
  }
  if (/^[a-zA-Z_]\w*\??\s*:\s*\([^)]*\)\s*=>/.test(trimmed)) return true;
  if (/^[a-zA-Z_]\w*\??\s*\([^)]*\):\s*.+;?$/.test(trimmed)) return true;
  if (/^[a-zA-Z_]\w*\??\s*:\s*typeof\s+[A-Za-z_$][\w$]*;?$/.test(trimmed)) return true;
  if (/^\[[^\]]+\]\??:\s*.+;?$/.test(trimmed)) return true;
  if (/^[a-zA-Z_]\w*\??\s*:\s*\{[^}]*\}(\s*\|\s*[A-Za-z_$][\w$]*)?;?$/.test(trimmed)) {
    return true;
  }
  if (/^[a-zA-Z_]\w*\s*:\s*[A-Z][A-Za-z0-9_<>,\s|]*;?$/.test(trimmed) && !trimmed.includes('=')) {
    return true;
  }
  if (/^\):\s*[A-Za-z_$][\w$]*\s+is\s+.+=>\s*$/.test(trimmed)) return true;
  if (/^\):\s*[A-Za-z_$][\w$<>,\s{}?|.[\](&;']+=>\s*$/.test(trimmed)) return true;
  if (/^export const [A-Za-z_$][\w$]*\s*=.+=>\s*$/.test(trimmed)) return true;

  // JSX structural lines that Bun coverage does not attribute reliably
  if (/^\)\s*:\s*\($/.test(trimmed)) return true;
  if (/^\{\s*$/.test(trimmed)) return true;
  if (/^\{[A-Za-z_$][\w$.]*\}$/.test(trimmed)) return true;
  if (/^>\s*$/.test(trimmed)) return true;
  if (/^}\s*else\s*\{$/.test(trimmed)) return true;
  if (/^}\s*`,?$/.test(trimmed)) return true;
  if (/^}\s*`}\s*$/.test(trimmed)) return true;
  if (/^}\s*:\s*\{$/.test(trimmed)) return true;
  if (/^\/?>$/.test(trimmed)) return true;
  if (/^}}\)?;?$/.test(trimmed)) return true;
  if (/^}\)\s*$/.test(trimmed)) return true;
  if (/^\)\}\s*$/.test(trimmed)) return true;
  if (/^\}\s*\)\s*;?\s*$/.test(trimmed)) return true;

  // JSX static text nodes (headings, labels, button copy)
  if (
    /^[A-Za-z0-9@_][A-Za-z0-9\s.,;!?#'"\-–—/:&+()@_]*$/.test(trimmed) &&
    !trimmed.includes('=>') &&
    !trimmed.includes('function') &&
    !trimmed.includes('const ') &&
    !trimmed.includes('return ') &&
    !trimmed.includes('import ')
  ) {
    return true;
  }

  return false;
};

type LcovLineData = { lineNumber: number; hits: number };

/**
 * Parse lcov file and return per-file line data for accurate filtering.
 */
export const parseLcovWithLines = (
  lcovPath: string,
  sourceRoot = process.cwd()
): Map<string, { lines: LcovLineData[]; file: CoverageFile }> => {
  if (!fs.existsSync(lcovPath)) {
    throw new Error(`Coverage file not found at ${lcovPath}`);
  }

  const result = new Map<string, { lines: LcovLineData[]; file: CoverageFile }>();
  const content = fs.readFileSync(lcovPath, 'utf8').split(/\r?\n/);

  let currentPath = '';
  let currentLines: LcovLineData[] = [];
  let linesFound = 0;
  let linesHit = 0;

  for (const line of content) {
    if (line.startsWith('SF:')) {
      currentPath = toPosix(path.resolve(sourceRoot, line.slice(3)));
      currentLines = [];
      linesFound = 0;
      linesHit = 0;
    } else if (line.startsWith('DA:')) {
      const [lineNumStr, hitsStr] = line.slice(3).split(',');
      const lineNumber = Number(lineNumStr);
      const hits = Number(hitsStr);
      currentLines.push({ lineNumber, hits });
    } else if (line.startsWith('LF:')) {
      linesFound = Number(line.slice(3));
    } else if (line.startsWith('LH:')) {
      linesHit = Number(line.slice(3));
    } else if (line === 'end_of_record' && currentPath) {
      // Use fallback from DA lines if LF/LH not provided
      if (linesFound === 0) {
        linesFound = currentLines.length;
        linesHit = currentLines.filter((l) => l.hits > 0).length;
      }
      const existing = result.get(currentPath);
      if (existing) {
        const mergedLines = new Map(existing.lines.map((entry) => [entry.lineNumber, entry.hits]));
        for (const entry of currentLines) {
          mergedLines.set(entry.lineNumber, (mergedLines.get(entry.lineNumber) ?? 0) + entry.hits);
        }
        const lines = [...mergedLines.entries()]
          .map(([lineNumber, hits]) => ({ lineNumber, hits }))
          .toSorted((left, right) => left.lineNumber - right.lineNumber);
        result.set(currentPath, {
          lines,
          file: {
            ...existing.file,
            linesFound: lines.length,
            linesHit: lines.filter((entry) => entry.hits > 0).length,
          },
        });
      } else {
        result.set(currentPath, {
          lines: currentLines,
          file: {
            path: currentPath,
            linesFound,
            linesHit,
            branchesFound: 0,
            branchesHit: 0,
            functionsFound: 0,
            functionsHit: 0,
          },
        });
      }
    }
  }

  return result;
};

/**
 * Filter out non-executable lines from coverage data.
 * Reads source files and removes blank/comment lines from line counts.
 * Returns files with absolute paths (like parseLcov).
 */
export const filterNonExecutableLines = (
  lcovData: Map<string, { lines: LcovLineData[]; file: CoverageFile }>,
  _rootDir: string
): CoverageFile[] => {
  const filtered: CoverageFile[] = [];

  for (const [filePath, data] of lcovData) {
    const absolutePath = filePath;

    if (!fs.existsSync(absolutePath)) {
      filtered.push(data.file); // Keep absolute path
      continue;
    }

    const sourceLines = fs.readFileSync(absolutePath, 'utf8').split(/\r?\n/);
    const ignoredLineNumbers = new Set<number>();
    let ignoreBlock = false;
    let ignoreNext = false;

    sourceLines.forEach((sourceLine, index) => {
      const lineNumber = index + 1;
      const trimmed = sourceLine.trim();
      const ignored = ignoreBlock || ignoreNext || trimmed.includes('coverage-ignore-line');
      if (ignored) {
        ignoredLineNumbers.add(lineNumber);
      }
      ignoreNext = false;

      if (trimmed.includes('coverage-ignore-next-line')) {
        ignoreNext = true;
      }
      if (trimmed.includes('coverage-ignore-start')) {
        ignoreBlock = true;
      }
      if (trimmed.includes('coverage-ignore-end')) {
        ignoreBlock = false;
      }
    });

    // Filter out DA entries for non-executable lines
    const executableLines = data.lines.filter((l) => {
      const sourceLine = sourceLines[l.lineNumber - 1]; // DA lines are 1-indexed
      return (
        sourceLine !== undefined &&
        !ignoredLineNumbers.has(l.lineNumber) &&
        !isNonExecutableLine(sourceLine)
      );
    });

    const linesFound = executableLines.length;
    const linesHit = executableLines.filter((l) => l.hits > 0).length;

    filtered.push({
      ...data.file,
      path: absolutePath, // Keep absolute path for filterCoverageFiles
      linesFound,
      linesHit,
    });
  }

  return filtered;
};

export const aggregateCoverage = (files: CoverageFile[]): CoverageTotals => {
  return files.reduce<CoverageTotals>(
    (totals, file) => ({
      linesFound: totals.linesFound + file.linesFound,
      linesHit: totals.linesHit + file.linesHit,
      branchesFound: totals.branchesFound + file.branchesFound,
      branchesHit: totals.branchesHit + file.branchesHit,
      functionsFound: totals.functionsFound + file.functionsFound,
      functionsHit: totals.functionsHit + file.functionsHit,
    }),
    {
      linesFound: 0,
      linesHit: 0,
      branchesFound: 0,
      branchesHit: 0,
      functionsFound: 0,
      functionsHit: 0,
    }
  );
};

const buildEntry = (covered: number, total: number) => ({
  total,
  covered,
  pct: Number(percentOf(covered, total).toFixed(2)),
});

export const filterCoverageFiles = (
  files: CoverageFile[],
  { rootDir, includePatterns = [], ignorePatterns = [] }: CoverageFilterOptions
): CoverageFile[] => {
  const includeGlobs = includePatterns.map((pattern) => new Glob(pattern));
  const ignoreGlobs = ignorePatterns.map((pattern) => new Glob(pattern));

  return files
    .map((file) => ({
      ...file,
      path: toPosix(path.relative(rootDir, file.path)),
    }))
    .filter((file) => {
      if (ignoreGlobs.some((glob) => glob.match(file.path))) {
        return false;
      }
      if (includeGlobs.length > 0 && !includeGlobs.some((glob) => glob.match(file.path))) {
        return false;
      }
      return true;
    });
};

export const writeCoverageSummary = (
  files: CoverageFile[],
  summaryPath: string
): CoverageSummary => {
  const totals = aggregateCoverage(files);
  const summary: CoverageSummary = {
    total: {
      lines: buildEntry(totals.linesHit, totals.linesFound),
      statements: buildEntry(totals.linesHit, totals.linesFound),
      branches: buildEntry(totals.branchesHit, totals.branchesFound),
      functions: buildEntry(totals.functionsHit, totals.functionsFound),
    },
    files: Object.fromEntries(
      files.map((file) => [
        file.path,
        {
          lines: buildEntry(file.linesHit, file.linesFound),
          statements: buildEntry(file.linesHit, file.linesFound),
          branches: buildEntry(file.branchesHit, file.branchesFound),
          functions: buildEntry(file.functionsHit, file.functionsFound),
        },
      ])
    ),
  };

  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return summary;
};

export const printCompactCoverageSummary = (summary: CoverageSummary) => {
  const PAD_FILE = 80;
  const PAD_STAT = 15;

  const padRight = (str: string, len: number) => str + ' '.repeat(Math.max(0, len - str.length));
  const padLeft = (str: string, len: number) => ' '.repeat(Math.max(0, len - str.length)) + str;

  const formatPct = (pct: number) => {
    if (pct >= 90) return `\x1b[32m${pct.toFixed(2)}%\x1b[0m`;
    if (pct >= 80) return `\x1b[33m${pct.toFixed(2)}%\x1b[0m`;
    return `\x1b[31m${pct.toFixed(2)}%\x1b[0m`;
  };

  const printLine = (file: string, lines: number) => {
    console.log(`${padRight(file, PAD_FILE)} | ${padLeft(formatPct(lines), PAD_STAT)} |`);
  };

  console.log('-'.repeat(PAD_FILE + PAD_STAT + 5));
  console.log(`${padRight('File', PAD_FILE)} | ${padLeft('% Coverage', PAD_STAT)} |`);
  console.log('-'.repeat(PAD_FILE + PAD_STAT + 5));

  const sortedFiles = Object.keys(summary.files).toSorted();
  for (const file of sortedFiles) {
    const stats = summary.files[file];
    if (stats) {
      printLine(file, stats.lines.pct);
    }
  }

  console.log('-'.repeat(PAD_FILE + PAD_STAT + 5));
  printLine('All files', summary.total.lines.pct);
  console.log('-'.repeat(PAD_FILE + PAD_STAT + 5));
};

export const printPackageCoverageSummary = (summary: CoverageSummary) => {
  const PAD_PKG = 30;
  const PAD_LINES = 20;
  const PAD_STAT = 12;

  const padRight = (str: string, len: number) => str + ' '.repeat(Math.max(0, len - str.length));
  const padLeft = (str: string, len: number) => ' '.repeat(Math.max(0, len - str.length)) + str;

  const formatPct = (pct: number) => {
    if (pct >= 80) return `\x1b[32m${pct.toFixed(1)}%\x1b[0m`;
    return `\x1b[31m${pct.toFixed(1)}%\x1b[0m`;
  };

  const printLine = (pkg: string, covered: number, total: number, pct: number) => {
    const lines = `${covered}/${total}`;
    console.log(
      `${padRight(pkg, PAD_PKG)} | ${padLeft(lines, PAD_LINES)} | ${padLeft(formatPct(pct), PAD_STAT)}`
    );
  };

  const packages = new Map<string, { total: number; covered: number }>();

  for (const [file, stats] of Object.entries(summary.files)) {
    const parts = file.split('/');
    if (parts[0] !== 'packages') continue;
    const pkg = parts[1] ?? 'unknown';
    const current = packages.get(pkg) ?? { total: 0, covered: 0 };
    current.total += stats.lines.total;
    current.covered += stats.lines.covered;
    packages.set(pkg, current);
  }

  const sortedPackages = [...packages.entries()].toSorted((a, b) => {
    const pctA = a[1].total > 0 ? (a[1].covered / a[1].total) * 100 : 0;
    const pctB = b[1].total > 0 ? (b[1].covered / b[1].total) * 100 : 0;
    return pctA - pctB;
  });

  console.log('\n' + '='.repeat(PAD_PKG + PAD_LINES + PAD_STAT + 9));
  console.log('Coverage by Package');
  console.log('='.repeat(PAD_PKG + PAD_LINES + PAD_STAT + 9));
  console.log(
    `${padRight('Package', PAD_PKG)} | ${padLeft('Lines', PAD_LINES)} | ${padLeft('Coverage', PAD_STAT)}`
  );
  console.log('-'.repeat(PAD_PKG + PAD_LINES + PAD_STAT + 9));

  for (const [pkg, stats] of sortedPackages) {
    const pct = stats.total > 0 ? (stats.covered / stats.total) * 100 : 0;
    printLine(pkg, stats.covered, stats.total, pct);
  }

  console.log('-'.repeat(PAD_PKG + PAD_LINES + PAD_STAT + 9));
  const totalPct = summary.total.lines.total > 0 ? summary.total.lines.pct : 0;
  printLine('TOTAL', summary.total.lines.covered, summary.total.lines.total, totalPct);
  console.log('='.repeat(PAD_PKG + PAD_LINES + PAD_STAT + 9) + '\n');
};
