import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dir, '../..');

type CopyTarget = {
  from: string;
  to: string[];
};

const targets: CopyTarget[] = [
  {
    from: 'config/public-assets/manifest.json',
    to: [
      'apps/console/public/manifest.json',
      'apps/docs/public/manifest.json',
      'apps/web/public/manifest.json',
    ],
  },
  {
    from: 'config/public-assets/marketing-manifest.json',
    to: ['apps/marketing/public/manifest.json'],
  },
  {
    from: 'config/public-assets/security.txt',
    to: [
      'apps/console/public/.well-known/security.txt',
      'apps/web/public/.well-known/security.txt',
    ],
  },
  {
    from: 'apps/tui/install.sh',
    to: ['apps/web/public/install.sh'],
  },
  {
    from: 'apps/tui/install.ps1',
    to: ['apps/web/public/install.ps1'],
  },
];

for (const target of targets) {
  const sourcePath = path.join(rootDir, target.from);
  const source = fs.readFileSync(sourcePath);
  for (const destination of target.to) {
    const destinationPath = path.join(rootDir, destination);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.writeFileSync(destinationPath, source);
    console.log(`Synced ${destination} from ${target.from}`);
  }
}
