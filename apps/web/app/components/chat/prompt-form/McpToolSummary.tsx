import type { McpRuntimeToolDescriptor } from '@taskforceai/shared';

interface McpToolSummaryProps {
  summary: string | null;
  items: McpRuntimeToolDescriptor[];
  onInsertTool: (_serverName: string, _toolName: string) => void;
}

export function McpToolSummary({ summary, items, onInsertTool }: McpToolSummaryProps) {
  if (!summary) {
    return null;
  }

  return (
    <div className="mb-2 space-y-2" aria-live="polite">
      <p className="text-xs text-sky-200/80">{summary}</p>
      {items.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {items.slice(0, 6).map((item) => (
            <button
              key={`${item.serverName}:${item.toolName}`}
              type="button"
              onClick={() => onInsertTool(item.serverName, item.toolName)}
              className="rounded-full border border-sky-400/30 bg-sky-500/10 px-2.5 py-1 text-[11px] text-sky-100 transition-colors hover:bg-sky-500/20"
            >
              {item.serverName}/{item.toolName}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
