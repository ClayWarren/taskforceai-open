import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

type DocsConfig = {
  navigation?: {
    groups?: Array<{
      pages?: string[];
    }>;
  };
};

const root = process.cwd();
const docsBaseUrl = 'https://docs.taskforceai.chat';
const errors: string[] = [];

const readText = (path: string): string => readFileSync(path, 'utf8');

const requireFile = (relativePath: string): string => {
  const path = join(root, relativePath);
  if (!existsSync(path)) {
    errors.push(`Missing required file: ${relativePath}`);
    return '';
  }
  if (!statSync(path).isFile()) {
    errors.push(`Expected a file: ${relativePath}`);
    return '';
  }
  return readText(path);
};

const pageUrl = (page: string): string => {
  if (page === 'docs/index') return `${docsBaseUrl}/docs`;
  return `${docsBaseUrl}/${page}`;
};

const assertFrontmatter = (relativePath: string, text: string): void => {
  if (!text.startsWith('---\n')) {
    errors.push(`${relativePath} is missing frontmatter`);
    return;
  }
  const end = text.indexOf('\n---', 4);
  if (end === -1) {
    errors.push(`${relativePath} has unterminated frontmatter`);
    return;
  }
  const frontmatter = text.slice(4, end);
  if (!/^title:\s*['"]?.+['"]?\s*$/m.test(frontmatter)) {
    errors.push(`${relativePath} frontmatter is missing title`);
  }
  if (!/^description:\s*['"]?.+['"]?\s*$/m.test(frontmatter)) {
    errors.push(`${relativePath} frontmatter is missing description`);
  }
};

const docsJsonText = requireFile('docs.json');
let config: DocsConfig = {};
try {
  config = JSON.parse(docsJsonText) as DocsConfig;
} catch (error) {
  errors.push(`docs.json is not valid JSON: ${(error as Error).message}`);
}

const pages = (config.navigation?.groups ?? []).flatMap((group) => group.pages ?? []);
if (pages.length === 0) {
  errors.push('docs.json navigation does not list any pages');
}

for (const page of pages) {
  const relativePath = `${page}.mdx`;
  const text = requireFile(relativePath);
  if (text) assertFrontmatter(relativePath, text);
}

const llms = requireFile('public/llms.txt');
const sitemap = requireFile('public/sitemap.xml');
for (const page of pages) {
  const url = pageUrl(page);
  if (!llms.includes(url)) {
    errors.push(`public/llms.txt is missing ${url}`);
  }
  if (!sitemap.includes(`<loc>${url}</loc>`)) {
    errors.push(`public/sitemap.xml is missing ${url}`);
  }
}

for (const relativePath of ['CHANGELOG.md', 'public/openapi.yaml']) {
  const text = requireFile(relativePath);
  if (text.trim().length === 0) {
    errors.push(`${relativePath} is empty`);
  }
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}

console.log(`Validated ${pages.length} docs pages.`);
