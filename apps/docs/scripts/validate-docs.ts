import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

type DocsConfig = {
  navigation?: {
    groups?: Array<{
      pages?: string[];
    }>;
  };
};

const docsBaseUrl = 'https://docs.taskforceai.chat';

const readText = (path: string): string => readFileSync(path, 'utf8');

const requireFile = (root: string, errors: string[], relativePath: string): string => {
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

const assertFrontmatter = (errors: string[], relativePath: string, text: string): void => {
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

export const validateDocs = (root = process.cwd()): { errors: string[]; pages: string[] } => {
  const errors: string[] = [];
  const docsJsonText = requireFile(root, errors, 'docs.json');
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
    const text = requireFile(root, errors, relativePath);
    if (text) assertFrontmatter(errors, relativePath, text);
  }

  const llms = requireFile(root, errors, 'public/llms.txt');
  const sitemap = requireFile(root, errors, 'public/sitemap.xml');
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
    const text = requireFile(root, errors, relativePath);
    if (text.trim().length === 0) {
      errors.push(`${relativePath} is empty`);
    }
  }

  return { errors, pages };
};

export const runValidateDocsCli = ({
  root = process.cwd(),
  log = (message: string) => console.log(message),
  error = (message: string) => console.error(message),
  exit = (code: number) => process.exit(code),
}: {
  root?: string;
  log?: (message: string) => void;
  error?: (message: string) => void;
  exit?: (code: number) => never;
} = {}): void => {
  const result = validateDocs(root);
  if (result.errors.length > 0) {
    error(result.errors.map((message) => `- ${message}`).join('\n'));
    exit(1);
    return;
  }

  log(`Validated ${result.pages.length} docs pages.`);
};

if (import.meta.main) {
  runValidateDocsCli();
}
