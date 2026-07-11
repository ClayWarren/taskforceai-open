#!/usr/bin/env bun

import { copyFile, mkdir, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'bun';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..', '..');
const APP_SERVER_MANIFEST = join(ROOT, 'apps/app-server/Cargo.toml');
const DESKTOP_BINARIES_DIR = join(ROOT, 'apps/desktop/binaries');
const SIDECAR_NAME = 'taskforceai-app-server';

type Environment = Record<string, string | undefined>;
type RustcOutput = (args: string[]) => Promise<string>;

export function cargoTargetDir(env: Environment = process.env, root = ROOT): string {
  const configured = env['CARGO_TARGET_DIR'];
  return configured ? resolve(configured) : join(root, 'apps/app-server/target');
}

export function sidecarSourcePath(targetDir: string, target: string): string {
  const extension = target.includes('windows') ? '.exe' : '';
  return join(targetDir, target, 'release', `${SIDECAR_NAME}${extension}`);
}

export function sidecarDestinationPath(target: string): string {
  const extension = target.includes('windows') ? '.exe' : '';
  return join(DESKTOP_BINARIES_DIR, `${SIDECAR_NAME}-${target}${extension}`);
}

export function parseTargetCandidate(
  argv: string[] = process.argv,
  env: Environment = process.env
): string | undefined {
  const argTarget = argv.find((arg) => arg.startsWith('--target='))?.replace('--target=', '');
  const splitArgTarget = argv
    .map((arg, index, args) => (arg === '--target' ? args[index + 1] : undefined))
    .find(Boolean);

  return (
    argTarget ??
    splitArgTarget ??
    env['TARGET'] ??
    env['CARGO_BUILD_TARGET'] ??
    env['TAURI_TARGET_TRIPLE']
  );
}

async function rustcOutput(args: string[]): Promise<string> {
  return (await $`rustc ${args}`.text()).trim();
}

async function hostTriple(resolveRustcOutput: RustcOutput): Promise<string> {
  const output = await resolveRustcOutput(['-vV']);
  const hostLine = output.split('\n').find((line) => line.startsWith('host: '));
  if (!hostLine) {
    throw new Error('Failed to resolve host Rust target from rustc -vV');
  }
  return hostLine.replace('host: ', '').trim();
}

async function isKnownRustTarget(
  target: string,
  resolveRustcOutput: RustcOutput
): Promise<boolean> {
  const output = await resolveRustcOutput(['--print', 'target-list']);
  return output.split('\n').includes(target);
}

export async function resolveTarget({
  argv = process.argv,
  env = process.env,
  resolveRustcOutput = rustcOutput,
}: {
  argv?: string[];
  env?: Environment;
  resolveRustcOutput?: RustcOutput;
} = {}): Promise<string> {
  const candidate = parseTargetCandidate(argv, env);

  if (candidate && (await isKnownRustTarget(candidate, resolveRustcOutput))) {
    return candidate;
  }

  return hostTriple(resolveRustcOutput);
}

async function main(): Promise<void> {
  const target = await resolveTarget();
  const cargoArgs = [
    'build',
    '--manifest-path',
    APP_SERVER_MANIFEST,
    '--release',
    '--target',
    target,
  ];

  await $`cargo ${cargoArgs}`;

  const source = sidecarSourcePath(cargoTargetDir(), target);
  const destination = sidecarDestinationPath(target);

  await stat(source);
  await mkdir(DESKTOP_BINARIES_DIR, { recursive: true });
  await copyFile(source, destination);
  console.log(`Prepared ${basename(destination)} for Tauri externalBin.`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
