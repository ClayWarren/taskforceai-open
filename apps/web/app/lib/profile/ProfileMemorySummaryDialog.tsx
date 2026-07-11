'use client';

import type { Memory } from '@taskforceai/contracts/contracts';
import { sortedCopy } from '@taskforceai/client-core';
import { ArrowUp, X } from 'lucide-react';
import React from 'react';

import { Button } from '@taskforceai/ui-kit/button';

const formatMemoryUpdatedLabel = (memories: Memory[]) => {
  const latest = memories.map((memory) => Date.parse(memory.updated_at)).filter(Number.isFinite);
  const latestMemoryTimestamp = sortedCopy(latest, (a, b) => b - a)[0];
  if (!latestMemoryTimestamp) {
    return 'No saved memories';
  }

  const ageMs = Date.now() - latestMemoryTimestamp;
  if (ageMs < 60_000) {
    return 'Updated just now';
  }
  if (ageMs < 3_600_000) {
    const minutes = Math.max(1, Math.floor(ageMs / 60_000));
    return `Updated ${minutes}m ago`;
  }
  return `Updated ${new Date(latestMemoryTimestamp).toLocaleDateString()}`;
};

export function MemorySummaryDialog(props: {
  open: boolean;
  memories: Memory[];
  loading: boolean;
  error: string | null;
  actionId: number | 'new' | null;
  onOpenChange: (_open: boolean) => void;
  onRefresh: () => void;
  onCreate: (_content: string, _type: string) => Promise<boolean>;
  onUpdate: (_id: number, _content: string, _type: string) => Promise<boolean>;
  onDelete: (_id: number) => Promise<boolean>;
}) {
  const [draft, setDraft] = React.useState('');
  const [draftType, setDraftType] = React.useState('preference');
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [editingContent, setEditingContent] = React.useState('');
  const [editingType, setEditingType] = React.useState('preference');

  React.useEffect(() => {
    if (!props.open) {
      setDraft('');
      setDraftType('preference');
      setEditingId(null);
      setEditingContent('');
      setEditingType('preference');
    }
  }, [props.open]);

  if (!props.open) {
    return null;
  }

  const submitDraft = async () => {
    const content = draft.trim();
    if (!content) {
      return;
    }
    const saved = await props.onCreate(content, draftType);
    if (saved) {
      setDraft('');
      setDraftType('preference');
    }
  };

  const startEditing = (memory: Memory) => {
    setEditingId(memory.id);
    setEditingContent(memory.content);
    setEditingType(memory.type);
  };

  const submitEdit = async (id: number) => {
    const content = editingContent.trim();
    if (!content) {
      return;
    }
    const saved = await props.onUpdate(id, content, editingType);
    if (saved) {
      setEditingId(null);
    }
  };

  const updatedLabel = formatMemoryUpdatedLabel(props.memories);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/65 p-4">
      <section
        aria-modal="true"
        aria-labelledby="memory-summary-title"
        role="dialog"
        className="flex max-h-[min(780px,92vh)] w-[min(780px,96vw)] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <h3 id="memory-summary-title" className="truncate text-2xl font-semibold">
              Memory summary
            </h3>
            <span className="shrink-0 text-sm text-muted-foreground">{updatedLabel}</span>
          </div>
          <button
            type="button"
            aria-label="Close memory summary"
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => props.onOpenChange(false)}
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {props.loading ? (
            <p className="text-sm text-muted-foreground">Loading memories...</p>
          ) : props.error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800/60 dark:bg-red-900/30 dark:text-red-100">
              <p>{props.error}</p>
              <Button className="mt-3" size="sm" variant="outline" onClick={props.onRefresh}>
                Retry
              </Button>
            </div>
          ) : props.memories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No saved memories yet. Add a fact or preference below.
            </p>
          ) : (
            <ul className="space-y-3">
              {props.memories.map((memory) => (
                <li key={memory.id} className="rounded-lg border border-border p-4">
                  {editingId === memory.id ? (
                    <div className="space-y-3">
                      <textarea
                        aria-label={`Edit memory ${memory.id}`}
                        className="min-h-24 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring"
                        value={editingContent}
                        onInput={(event) => setEditingContent(event.currentTarget.value)}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          aria-label={`Memory ${memory.id} type`}
                          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                          value={editingType}
                          onChange={(event) => setEditingType(event.target.value)}
                        >
                          <option value="preference">Preference</option>
                          <option value="fact">Fact</option>
                          <option value="finance">Finance</option>
                        </select>
                        <Button
                          size="sm"
                          onClick={() => void submitEdit(memory.id)}
                          disabled={props.actionId === memory.id}
                        >
                          {props.actionId === memory.id ? 'Saving...' : 'Save'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm leading-6 whitespace-pre-wrap">{memory.content}</p>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="rounded-full border border-border px-2 py-0.5 capitalize">
                            {memory.type}
                          </span>
                          <span>{new Date(memory.updated_at).toLocaleDateString()}</span>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => startEditing(memory)}>
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void props.onDelete(memory.id)}
                            disabled={props.actionId === memory.id}
                          >
                            {props.actionId === memory.id ? 'Deleting...' : 'Delete'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-border p-5">
          <div className="flex items-end gap-3 rounded-full bg-black p-2 dark:bg-black">
            <textarea
              aria-label="Add or update memory"
              placeholder="Add or update"
              className="min-h-12 flex-1 resize-none rounded-full bg-transparent px-4 py-3 text-sm text-white outline-none placeholder:text-white/60"
              value={draft}
              onInput={(event) => setDraft(event.currentTarget.value)}
            />
            <select
              aria-label="New memory type"
              className="mb-1 hidden rounded-full border border-white/20 bg-black px-3 py-2 text-xs text-white sm:block"
              value={draftType}
              onChange={(event) => setDraftType(event.target.value)}
            >
              <option value="preference">Preference</option>
              <option value="fact">Fact</option>
              <option value="finance">Finance</option>
            </select>
            <button
              type="button"
              aria-label="Save memory"
              className="mb-0.5 flex size-11 shrink-0 items-center justify-center rounded-full bg-white text-xl leading-none text-black disabled:opacity-50"
              disabled={!draft.trim() || props.actionId === 'new'}
              onClick={() => void submitDraft()}
            >
              <ArrowUp className="size-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
