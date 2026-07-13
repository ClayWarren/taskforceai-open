import path from 'path';

import { printPackageCoverageSummary } from './coverage-utils';
import {
  argsAfterScript,
  cleanCoverageArgs,
  collectTestFiles,
  PACKAGE_COVERAGE_IGNORE,
  runFilesWithDots,
  runLcovCoverage,
  testEnv,
} from './test-runner';

const INCLUDE_PATTERNS = ['packages/**/*.{test,spec}.{ts,tsx}', 'tests/coverage-loader.test.ts'];
const EXCLUDE_PATTERNS = ['packages/**/dist/**/*'];
const COVERAGE_INCLUDE = ['packages/**/*.{ts,tsx}'];

const testFiles = collectTestFiles({ include: INCLUDE_PATTERNS, exclude: EXCLUDE_PATTERNS });

if (testFiles.length === 0) {
  process.stdout.write('No package tests found.\n');
  process.exit(0);
}

const args = argsAfterScript('run-packages-bun');
const cleanedArgs = cleanCoverageArgs(args);
const env = testEnv();

if (args.includes('--coverage')) {
  const coverageRoot = path.resolve(process.cwd(), 'coverage/packages');
  process.exit(
    await runLcovCoverage({
      files: testFiles,
      coverageRoot,
      lcovPath: path.join(coverageRoot, 'lcov.info'),
      summaryPath: path.join(coverageRoot, 'coverage-summary.json'),
      cleanedArgs,
      includePatterns: COVERAGE_INCLUDE,
      ignorePatterns: PACKAGE_COVERAGE_IGNORE,
      thresholdLabel: 'packages',
      summaryLabel: 'summary',
      printSummary: printPackageCoverageSummary,
      env,
    })
  );
}

process.exit(
  await runFilesWithDots({
    files: testFiles,
    concurrency: 4,
    env,
    commandForFile: (file) => ({ cmd: ['bun', 'test', '--isolate', ...cleanedArgs, file] }),
  })
);
