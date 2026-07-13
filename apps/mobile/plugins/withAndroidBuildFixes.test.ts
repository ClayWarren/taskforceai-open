import { describe, expect, it } from 'bun:test';

const { appendAndroidxResolutionStrategy } = require('./withAndroidBuildFixes.js') as {
  appendAndroidxResolutionStrategy: (contents: string) => string;
};

describe('withAndroidBuildFixes', () => {
  it('appends the AndroidX strategy at project scope exactly once', () => {
    const buildGradle = 'android {\n}\n\ndependencies {\n}\n';

    const once = appendAndroidxResolutionStrategy(buildGradle);
    const twice = appendAndroidxResolutionStrategy(once);

    expect(once.indexOf('configurations.all')).toBeGreaterThan(once.lastIndexOf('dependencies'));
    expect(once.match(/TaskForceAI AndroidX resolution pins/g)).toHaveLength(1);
    expect(twice).toBe(once);
  });

  it('does not duplicate an existing legacy resolution strategy', () => {
    const buildGradle = "dependencies {\n  force 'androidx.core:core:1.13.1'\n}\n";

    expect(appendAndroidxResolutionStrategy(buildGradle)).toBe(buildGradle);
  });
});
