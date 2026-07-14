import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { isNonExecutableLine } from '../../../tests/coverage-utils';
import { mergeLcovRecords, parseLcov, toLcov, type LcovRecord } from './lcov';

const rootDir = path.resolve(import.meta.dir, '..');
const bunLcovPath = path.join(rootDir, 'coverage', 'bun', 'lcov.info');
const jestLcovPath = path.join(rootDir, 'coverage', 'lcov.info');
const mergedLcovPath = path.join(rootDir, 'coverage', 'merged', 'lcov.info');
const parsedThreshold = Number(
  process.env['COVERAGE_LINE_THRESHOLD'] ?? process.env['COVERAGE_THRESHOLD'] ?? '100'
);
const COVERAGE_THRESHOLD = Number.isFinite(parsedThreshold) ? parsedThreshold : 100;
const LOGIC_COVERAGE_THRESHOLD = 100;

// Native/runtime boundaries are verified with focused mocks and device/E2E tests. Their LCOV
// attribution is not stable enough to include in the merged line denominator.
const NATIVE_COVERAGE_EXCLUSIONS = [
  // Native adapters - require device
  'src/observability/metrics.ts',      // Sentry wrapper - requires native SDK
  'src/storage/database/encryption.ts',         // expo-secure-store - requires device keychain/keystore
  'src/storage/database/encryption-migration.ts', // SQLCipher/native migration path
  'src/storage/database/manager.ts',   // expo-sqlite + SQLCipher - requires native SQLite
  'src/voice/mobileAdapter.ts',        // expo-speech + @react-native-voice - requires device
  'src/auth/token-store.ts',           // expo-secure-store - requires native keychain/keystore
  'src/streaming/useStreamingStore.ts', // React Native AppState integration
  'src/mcp/approval.ts',               // Server approval POST + live MCP execution boundary
  'src/mcp/local-command.ts',          // Local MCP execution + chat persistence integration
  // Coverage tooling gaps
  'src/security/certificate-pinning.ts', // Tests exist but Bun coverage misses dynamic imports
  // Screens - navigation, native modules, E2E territory
  'src/screens/AppRoot.tsx',           // expo-router, deep linking
  'src/screens/ChatScreen.tsx',        // FlashList, streaming, complex state
  'src/screens/LoginScreen.tsx',       // expo-auth-session, web browser
  'src/screens/SettingsScreen.tsx',    // expo-notifications, alerts, native APIs
  'src/features/desktop-work/DesktopWorkScreen.tsx', // native modal screen and remote navigation orchestration
  // Hooks with native dependencies
  'src/hooks/usePurchases.ts',         // RevenueCat native SDK
  'src/hooks/useNotificationsBootstrap.ts', // expo-notifications
  'src/hooks/usePromptAttachments.ts', // expo-image-picker, expo-document-picker
  'src/hooks/useMessageVoice.ts',      // expo-speech
  'src/hooks/usePromptVoice.ts',       // expo-speech
  'src/theme/useTypography.ts',        // expo-font + React Native Text renderer patch
  'src/components/PromptInput/internal.ts', // expo-file-system attachment metadata
  // Providers with native dependencies
  'src/providers/QueryProvider.tsx',   // NetInfo, AppState, SQLite persister
];

function isExcluded(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return NATIVE_COVERAGE_EXCLUSIONS.some((pattern) => normalized.endsWith(pattern));
}

function isInMobileSrc(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.startsWith('src/')) return true;
  if (normalized.includes('/apps/mobile/src/')) return true;
  return false;
}

function resolveSourcePath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(rootDir, filePath);
}

function ignoredLineNumbers(sourceLines: string[]): Set<number> {
  const ignored = new Set<number>();
  let ignoreBlock = false;
  let ignoreNext = false;

  sourceLines.forEach((sourceLine, index) => {
    const lineNumber = index + 1;
    const trimmed = sourceLine.trim();
    if (ignoreBlock || ignoreNext || trimmed.includes('coverage-ignore-line')) {
      ignored.add(lineNumber);
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

  return ignored;
}

function executableLineData(record: LcovRecord): Array<[number, number]> {
  const sourcePath = resolveSourcePath(record.sourceFile);
  if (!existsSync(sourcePath)) {
    return Array.from(record.lineData.entries());
  }

  const sourceLines = readFileSync(sourcePath, 'utf-8').split(/\r?\n/);
  const ignored = ignoredLineNumbers(sourceLines);
  return Array.from(record.lineData.entries()).filter(([lineNumber]) => {
    const sourceLine = sourceLines[lineNumber - 1];
    return (
      sourceLine !== undefined &&
      !ignored.has(lineNumber) &&
      !isNonExecutableLine(sourceLine)
    );
  });
}

function main() {
  const files: { path: string; name: string }[] = [];

  if (existsSync(bunLcovPath)) {
    files.push({ path: bunLcovPath, name: 'Bun' });
  }

  if (existsSync(jestLcovPath)) {
    files.push({ path: jestLcovPath, name: 'Jest' });
  }

  if (files.length === 0) {
    console.error('No lcov files found');
    process.exit(1);
  }

  console.log('\n\x1b[1mMerging coverage reports...\x1b[0m');
  console.log('━'.repeat(60));

  const merged = new Map<string, LcovRecord>();

  for (const file of files) {
    const content = readFileSync(file.path, 'utf-8');
    const records = parseLcov(content, file.name);
    mergeLcovRecords(merged, records, 'combined');
    console.log(`  ${file.name}: ${records.size} source files`);
  }

  const mergedDir = path.dirname(mergedLcovPath);
  if (!existsSync(mergedDir)) {
    mkdirSync(mergedDir, { recursive: true });
  }

  const output = toLcov(merged, 'combined');
  writeFileSync(mergedLcovPath, output);

  console.log(`\n\x1b[1mMerged output:\x1b[0m ${mergedLcovPath}`);
  console.log('━'.repeat(70));

  interface FileCoverage {
    file: string;
    linesHit: number;
    linesFound: number;
    pct: number;
    sources: string;
  }

  const allFiles: FileCoverage[] = [];
  let totalLinesFound = 0;
  let totalLinesHit = 0;

  for (const record of merged.values()) {
    if (
      !isInMobileSrc(record.sourceFile) ||
      isExcluded(record.sourceFile) ||
      record.sourceFile.includes('__tests__') ||
      record.sourceFile.includes('.test.') ||
      record.sourceFile.includes('.spec.') ||
      record.sourceFile.includes('test/bun-setup')
    ) {
      continue;
    }

    const lines = executableLineData(record);
    const found = lines.length;
    if (found === 0) {
      continue;
    }
    const hit = lines.filter(([, hits]) => hits > 0).length;
    const pct = found > 0 ? (hit / found) * 100 : 0;
    const sources = Array.from(record.sources).toSorted().join('+');

    allFiles.push({
      file: record.sourceFile,
      linesHit: hit,
      linesFound: found,
      pct,
      sources,
    });

    totalLinesFound += found;
    totalLinesHit += hit;
  }

  const bunFiles = allFiles.filter((f) => f.sources === 'Bun').toSorted((a, b) => b.pct - a.pct);
  const jestFiles = allFiles.filter((f) => f.sources === 'Jest').toSorted((a, b) => b.pct - a.pct);
  const bothFiles = allFiles.filter((f) => f.sources.includes('+')).toSorted((a, b) => b.pct - a.pct);

  const printFileTable = (title: string, fileList: FileCoverage[]): { hit: number; found: number } => {
    if (fileList.length === 0) return { hit: 0, found: 0 };

    let suiteHit = 0;
    let suiteFound = 0;
    for (const f of fileList) {
      suiteHit += f.linesHit;
      suiteFound += f.linesFound;
    }
    const suitePct = suiteFound > 0 ? (suiteHit / suiteFound) * 100 : 0;

    console.log(`\n\x1b[1m${title}\x1b[0m (${fileList.length} files)`);
    console.log('─'.repeat(70));
    for (const f of fileList) {
      const pctColor = f.pct >= 80 ? '\x1b[32m' : f.pct >= 50 ? '\x1b[33m' : '\x1b[31m';
      const fileDisplay = f.file.length > 50 ? '...' + f.file.slice(-47) : f.file;
      console.log(`  ${fileDisplay.padEnd(50)} ${String(f.linesHit).padStart(4)}/${String(f.linesFound).padStart(4)}  ${pctColor}${f.pct.toFixed(0).padStart(3)}%\x1b[0m`);
    }

    const pctColor = suitePct >= 80 ? '\x1b[32m' : suitePct >= 50 ? '\x1b[33m' : '\x1b[31m';
    console.log('─'.repeat(70));
    console.log(`  \x1b[1mSubtotal\x1b[0m                                        ${String(suiteHit).padStart(4)}/${String(suiteFound).padStart(4)}  ${pctColor}${suitePct.toFixed(1).padStart(5)}%\x1b[0m`);

    return { hit: suiteHit, found: suiteFound };
  };

  const bunCoverage = printFileTable('Bun Test Suite', bunFiles);
  printFileTable('Jest Test Suite', jestFiles);
  const bothCoverage = printFileTable('Both Suites', bothFiles);

  const logicLinesFound = bunCoverage.found + bothCoverage.found;
  const logicLinesHit = bunCoverage.hit + bothCoverage.hit;
  const logicPct = logicLinesFound > 0 ? (logicLinesHit / logicLinesFound) * 100 : 0;

  const totalPct = totalLinesFound > 0 ? (totalLinesHit / totalLinesFound) * 100 : 0;
  const totalColor = totalPct >= 80 ? '\x1b[32m' : totalPct >= 50 ? '\x1b[33m' : '\x1b[31m';

  console.log('\n' + '━'.repeat(70));
  console.log(`\x1b[1mTotal Coverage: ${totalLinesHit}/${totalLinesFound} lines  ${totalColor}${totalPct.toFixed(1)}%\x1b[0m\x1b[0m`);
  console.log('━'.repeat(70));

  if (logicPct + 0.001 < LOGIC_COVERAGE_THRESHOLD) {
    console.log(
      `\n\x1b[31m✗ Deterministic logic coverage below ${LOGIC_COVERAGE_THRESHOLD}% ` +
        `(${logicPct.toFixed(1)}%)\x1b[0m\n`
    );
    process.exit(1);
  }

  if (totalPct + 0.001 < COVERAGE_THRESHOLD) {
    console.log(`\n\x1b[33m⚠ Coverage below ${COVERAGE_THRESHOLD}% threshold (${totalPct.toFixed(1)}%)\x1b[0m\n`);
    process.exit(1);
  } else {
    console.log(`\n\x1b[32m✓ Coverage meets ${COVERAGE_THRESHOLD}% threshold (${totalPct.toFixed(1)}%)\x1b[0m\n`);
  }
}

main();
