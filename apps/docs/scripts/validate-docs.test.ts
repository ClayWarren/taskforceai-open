import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'bun:test';

import { runValidateDocsCli, validateDocs } from './validate-docs';

const docsBaseUrl = 'https://docs.taskforceai.chat';
let tempRoots: string[] = [];

const createFixtureRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'taskforceai-docs-'));
  tempRoots.push(root);
  return root;
};

const writeFixtureFile = (root: string, relativePath: string, contents: string) => {
  const absolutePath = join(root, relativePath);
  mkdirSync(resolve(absolutePath, '..'), { recursive: true });
  writeFileSync(absolutePath, contents);
};

const writeValidDocsFixture = (root: string) => {
  const files = {
    'docs.json': JSON.stringify({
      navigation: {
        groups: [{ pages: ['docs/index', 'docs/getting-started'] }],
      },
    }),
    'docs/index.mdx': `---
title: Overview
description: Start here
---

# Overview
`,
    'docs/getting-started.mdx': `---
title: Getting Started
description: Build with TaskForceAI
---

# Getting Started
`,
    'public/llms.txt': `${docsBaseUrl}/docs\n${docsBaseUrl}/docs/getting-started\n`,
    'public/sitemap.xml': `<urlset><url><loc>${docsBaseUrl}/docs</loc></url><url><loc>${docsBaseUrl}/docs/getting-started</loc></url></urlset>`,
    'CHANGELOG.md': '# Changelog\n',
    'public/openapi.yaml': 'openapi: 3.1.0\n',
  };
  for (const [path, contents] of Object.entries(files)) writeFixtureFile(root, path, contents);
};

afterEach(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
  tempRoots = [];
});

describe('validate-docs script', () => {
  it('accepts a complete docs fixture', () => {
    const root = createFixtureRoot();
    writeValidDocsFixture(root);

    const result = validateDocs(root);

    expect(result.errors).toEqual([]);
    expect(result.pages).toEqual(['docs/index', 'docs/getting-started']);
  });

  it('reports missing frontmatter, llms, sitemap, and required artifact errors', () => {
    const root = createFixtureRoot();
    writeValidDocsFixture(root);
    writeFixtureFile(root, 'docs/getting-started.mdx', '# Missing frontmatter\n');
    writeFixtureFile(root, 'public/llms.txt', `${docsBaseUrl}/docs\n`);
    writeFixtureFile(
      root,
      'public/sitemap.xml',
      `<urlset><url><loc>${docsBaseUrl}/docs</loc></url></urlset>`
    );
    writeFixtureFile(root, 'public/openapi.yaml', '');

    const result = validateDocs(root);

    expect(result.errors).toContain('docs/getting-started.mdx is missing frontmatter');
    expect(result.errors).toContain(
      `public/llms.txt is missing ${docsBaseUrl}/docs/getting-started`
    );
    expect(result.errors).toContain(
      `public/sitemap.xml is missing ${docsBaseUrl}/docs/getting-started`
    );
    expect(result.errors).toContain('public/openapi.yaml is empty');
  });

  it('reports invalid docs.json and missing navigation pages', () => {
    const root = createFixtureRoot();
    writeFixtureFile(root, 'docs.json', '{bad json');
    writeFixtureFile(root, 'public/llms.txt', '');
    writeFixtureFile(root, 'public/sitemap.xml', '');
    writeFixtureFile(root, 'CHANGELOG.md', '# Changelog\n');
    writeFixtureFile(root, 'public/openapi.yaml', 'openapi: 3.1.0\n');

    const result = validateDocs(root);

    expect(result.errors.some((error) => error.startsWith('docs.json is not valid JSON:'))).toBe(
      true
    );
    expect(result.errors).toContain('docs.json navigation does not list any pages');
    expect(result.pages).toEqual([]);
  });

  it('reports missing files, directories where files are expected, and incomplete frontmatter', () => {
    const root = createFixtureRoot();
    writeValidDocsFixture(root);
    writeFixtureFile(
      root,
      'docs.json',
      JSON.stringify({
        navigation: {
          groups: [{ pages: ['docs/index', 'docs/getting-started', 'docs/no-title'] }],
        },
      })
    );
    rmSync(join(root, 'public/llms.txt'));
    rmSync(join(root, 'public/openapi.yaml'));
    mkdirSync(join(root, 'public/openapi.yaml'));
    writeFixtureFile(
      root,
      'docs/getting-started.mdx',
      `---
description: Missing title
`
    );
    writeFixtureFile(
      root,
      'docs/index.mdx',
      `---
title: Overview
---

# Missing description
`
    );
    writeFixtureFile(
      root,
      'docs/no-title.mdx',
      `---
description: Missing title
---

# Missing title
`
    );

    const result = validateDocs(root);

    expect(result.errors).toContain('Missing required file: public/llms.txt');
    expect(result.errors).toContain('Expected a file: public/openapi.yaml');
    expect(result.errors).toContain('docs/getting-started.mdx has unterminated frontmatter');
    expect(result.errors).toContain('docs/index.mdx frontmatter is missing description');
    expect(result.errors).toContain('docs/no-title.mdx frontmatter is missing title');
  });

  it('formats CLI success and failure output with injectable process hooks', () => {
    const validRoot = createFixtureRoot();
    writeValidDocsFixture(validRoot);
    const log = vi.fn();
    const error = vi.fn();
    const exit = vi.fn((code: number) => {
      throw new Error(`exit ${code}`);
    }) as unknown as (code: number) => never;

    runValidateDocsCli({ root: validRoot, log, error, exit });

    expect(log).toHaveBeenCalledWith('Validated 2 docs pages.');
    expect(error).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();

    const invalidRoot = createFixtureRoot();
    writeValidDocsFixture(invalidRoot);
    writeFixtureFile(invalidRoot, 'public/openapi.yaml', '');

    expect(() => runValidateDocsCli({ root: invalidRoot, log, error, exit })).toThrow('exit 1');
    expect(error).toHaveBeenCalledWith('- public/openapi.yaml is empty');
    expect(exit).toHaveBeenCalledWith(1);
  });
});
