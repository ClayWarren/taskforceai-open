import { describe, expect, it } from 'bun:test';
import path from 'node:path';

const installerPaths = [
  path.resolve(process.cwd(), 'apps/web/public/install.cmd'),
  path.resolve(process.cwd(), 'apps/tui/install.cmd'),
];

describe('Windows installers', () => {
  for (const installerPath of installerPaths) {
    it(`updates the user PATH without setx in ${path.relative(process.cwd(), installerPath)}`, async () => {
      const installer = await Bun.file(installerPath).text();

      expect(installer.toLowerCase()).not.toContain('setx path');
      expect(installer).toContain("[Environment]::GetEnvironmentVariable('Path', 'User')");
      expect(installer).toContain(
        "[Environment]::SetEnvironmentVariable('Path', $nextPath, 'User')"
      );
    });
  }
});
