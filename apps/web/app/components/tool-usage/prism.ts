import type { CodeExecutionArgs } from './types';
import Prism from 'prismjs';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-yaml';

export interface PrismLike {
  languages: Record<string, unknown>;
  highlight: (code: string, grammar: unknown, language: string) => string;
}

type PrismStatic = typeof import('prismjs');
let prismLoader: Promise<PrismStatic> | null = null;

export const loadPrism = async (): Promise<PrismStatic> => {
  if (!prismLoader) {
    prismLoader = Promise.resolve(Prism as unknown as PrismStatic);
  }
  return prismLoader;
};

type SupportedLanguage =
  | 'python'
  | 'javascript'
  | 'typescript'
  | 'bash'
  | 'json'
  | 'go'
  | 'rust'
  | 'yaml';

const normalizeLanguage = (language?: string): SupportedLanguage | null => {
  const normalized = language?.trim().toLowerCase();
  if (normalized === 'javascript' || normalized === 'js' || normalized === 'nodejs') {
    return 'javascript';
  }
  if (normalized === 'typescript' || normalized === 'ts') {
    return 'typescript';
  }
  if (normalized === 'python' || normalized === 'py') {
    return 'python';
  }
  if (normalized === 'bash' || normalized === 'sh' || normalized === 'shell') {
    return 'bash';
  }
  if (normalized === 'json') {
    return 'json';
  }
  if (normalized === 'go' || normalized === 'golang') {
    return 'go';
  }
  if (normalized === 'rust' || normalized === 'rs') {
    return 'rust';
  }
  if (normalized === 'yaml' || normalized === 'yml') {
    return 'yaml';
  }
  return null;
};

export const formatLanguageLabel = (language?: string): string => {
  if (!language) {
    return 'Code';
  }
  const normalized = language.trim().toLowerCase();
  if (!normalized) {
    return 'Code';
  }
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)} code`;
};

export const highlightCode = (
  args: Pick<CodeExecutionArgs, 'code' | 'language'>,
  prismInstance?: PrismLike | null
): { html: string | null; languageClass: string } => {
  if (!args.code) {
    return { html: null, languageClass: 'language-none' };
  }
  const lang = normalizeLanguage(args.language);
  if (!lang) {
    return { html: null, languageClass: 'language-none' };
  }
  if (!prismInstance) {
    return { html: null, languageClass: `language-${lang}` };
  }
  const grammar = prismInstance.languages[lang];
  if (!grammar) {
    return { html: null, languageClass: `language-${lang}` };
  }
  const html = prismInstance.highlight(args.code, grammar, lang);
  return { html, languageClass: `language-${lang}` };
};

export type { PrismStatic };
