#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = dirname(scriptDir);
const easConfigPath = join(appDir, 'eas.json');
const easCliVersion = '20.5.1';

const readEasConfig = () => JSON.parse(readFileSync(easConfigPath, 'utf8'));

const readOption = (args, name) => {
  const equalsPrefix = `--${name}=`;
  const equalsIndex = args.findIndex((arg) => arg.startsWith(equalsPrefix));
  if (equalsIndex >= 0) {
    const value = args[equalsIndex].slice(equalsPrefix.length);
    return {
      value,
      args: args.filter((_, index) => index !== equalsIndex),
    };
  }

  const index = args.indexOf(`--${name}`);
  if (index < 0) {
    return { value: null, args };
  }

  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Expected a value after --${name}`);
  }

  return {
    value,
    args: args.filter((_, argIndex) => argIndex !== index && argIndex !== index + 1),
  };
};

const initialArgs = process.argv.slice(2);
const profileOption = readOption(initialArgs, 'profile');
const channelOption = readOption(profileOption.args, 'channel');

const profileName = profileOption.value ?? process.env.EAS_BUILD_PROFILE ?? 'production';
const easConfig = readEasConfig();
const profile = easConfig.build?.[profileName];

if (!profile) {
  const availableProfiles = Object.keys(easConfig.build ?? {}).join(', ') || 'none';
  throw new Error(
    `Unknown EAS build profile "${profileName}". Available profiles: ${availableProfiles}`
  );
}

const channel = channelOption.value ?? profile.channel ?? profileName;
const profileEnv = profile.env ?? {};
const env = {
  ...profileEnv,
  ...process.env,
  EAS_BUILD_PROFILE: profileName,
};
const commandArgs = [
  `eas-cli@${easCliVersion}`,
  'update',
  '--channel',
  channel,
  ...channelOption.args,
];

console.log(`Publishing Expo update with profile "${profileName}" on channel "${channel}".`);
console.log(`Loaded ${Object.keys(profileEnv).length} profile env key(s) from eas.json.`);

const result = spawnSync('bunx', commandArgs, {
  cwd: appDir,
  env,
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
