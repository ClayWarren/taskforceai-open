import { renderMarkdownToSafeHtml } from '@/lib/safe-markdown';

export default function MarkdownRenderer({ content }: { content: string }) {
  const html = renderMarkdownToSafeHtml(content);

  return (
    <div
      className="prose prose-invert prose-headings:text-slate-900 dark:prose-headings:text-white prose-p:text-slate-700 dark:prose-p:text-slate-300 prose-a:text-blue-400 prose-a:no-underline hover:prose-a:text-blue-300 prose-strong:text-slate-900 dark:prose-strong:text-white prose-code:text-blue-300 prose-pre:bg-slate-100 dark:prose-pre:bg-slate-900/50 prose-pre:border prose-pre:border-slate-200 dark:prose-pre:border-white/10 prose-li:text-slate-700 dark:prose-li:text-slate-300 prose-ul:list-disc prose-ol:list-decimal max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
