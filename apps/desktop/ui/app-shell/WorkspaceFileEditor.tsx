'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import ChunkedMarkdown from '@taskforceai/web/app/components/markdown/ChunkedMarkdown';
import {
  writeDesktopWorkspaceFile,
  type DesktopWorkspaceFileReadResult,
} from '../platform/app-server';

type SelectedRange = {
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  text: string;
};

type FileAnnotation = SelectedRange & {
  id: string;
  note: string;
};

interface WorkspaceFileEditorProps {
  file: DesktopWorkspaceFileReadResult | null;
  isLoading: boolean;
  onSaved: (file: DesktopWorkspaceFileReadResult) => void;
  onInsertIntoComposer?: (text: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export const selectedRangeFromText = (
  content: string,
  start: number,
  end: number
): SelectedRange | null => {
  const safeStart = Math.max(0, Math.min(start, content.length));
  const safeEnd = Math.max(safeStart, Math.min(end, content.length));
  if (safeStart === safeEnd) return null;
  const lineAt = (offset: number) => content.slice(0, offset).split('\n').length;
  return {
    start: safeStart,
    end: safeEnd,
    startLine: lineAt(safeStart),
    endLine: lineAt(Math.max(safeStart, safeEnd - 1)),
    text: content.slice(safeStart, safeEnd),
  };
};

export const buildWorkspaceRevisionPrompt = (
  path: string,
  selection: SelectedRange,
  annotations: FileAnnotation[]
) => {
  const lineLabel =
    selection.startLine === selection.endLine
      ? `line ${selection.startLine}`
      : `lines ${selection.startLine}-${selection.endLine}`;
  const notes = annotations.length
    ? `\n\nReview notes:\n${annotations
        .map((annotation) => {
          const annotationLines =
            annotation.startLine === annotation.endLine
              ? `line ${annotation.startLine}`
              : `lines ${annotation.startLine}-${annotation.endLine}`;
          return `- ${annotationLines}: ${annotation.note}`;
        })
        .join('\n')}`
    : '';
  return `Revise \`${path}\` ${lineLabel}:\n\n~~~~text\n${selection.text}\n~~~~${notes}`;
};

export function WorkspaceFileEditor({
  file,
  isLoading,
  onSaved,
  onInsertIntoComposer,
  onDirtyChange,
}: WorkspaceFileEditorProps) {
  const [draft, setDraft] = useState('');
  const [selection, setSelection] = useState<SelectedRange | null>(null);
  const [annotationNote, setAnnotationNote] = useState('');
  const [annotations, setAnnotations] = useState<FileAnnotation[]>([]);
  const [showMarkdownPreview, setShowMarkdownPreview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft(file?.content ?? '');
    setSelection(null);
    setAnnotationNote('');
    setAnnotations([]);
    setShowMarkdownPreview(false);
    setSaveMessage(null);
    setSaveError(null);
  }, [file?.content, file?.path]);

  const isDirty = Boolean(file && draft !== file.content);
  const isMarkdown = Boolean(file?.path.toLowerCase().match(/\.(md|mdx|markdown)$/));
  const lineCount = useMemo(() => (draft ? draft.split('\n').length : 1), [draft]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
    return () => onDirtyChange?.(false);
  }, [isDirty, onDirtyChange]);

  const captureSelection = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    setSelection(selectedRangeFromText(draft, textarea.selectionStart, textarea.selectionEnd));
  };

  const save = async () => {
    if (!file || !file.editable || !isDirty) return;
    setIsSaving(true);
    setSaveError(null);
    setSaveMessage(null);
    try {
      const saved = await writeDesktopWorkspaceFile({
        root: file.root,
        path: file.path,
        content: draft,
        expectedContent: file.content,
      });
      onSaved(saved);
      setSaveMessage('Saved.');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  const addAnnotation = () => {
    const note = annotationNote.trim();
    if (!selection || !note) return;
    setAnnotations((current) => [
      ...current,
      {
        ...selection,
        id: `${selection.start}:${selection.end}:${Date.now()}`,
        note,
      },
    ]);
    setAnnotationNote('');
  };

  if (!file) {
    return (
      <pre className="m-0 max-h-[34vh] overflow-auto p-4 text-xs leading-5 text-slate-200">
        <code>{isLoading ? 'Loading...' : 'No file selected.'}</code>
      </pre>
    );
  }

  if (!file.editable) {
    return (
      <div>
        <p className="border-b border-white/10 px-4 py-2 text-xs text-amber-200">
          {file.truncated
            ? 'This preview is truncated and cannot be edited safely.'
            : 'This file is not valid editable text.'}
        </p>
        <pre className="m-0 max-h-[34vh] overflow-auto p-4 text-xs leading-5 text-slate-200">
          <code>{file.content}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className="flex max-h-[52vh] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-2">
        <span className="mr-auto text-[11px] text-slate-400">{lineCount} lines</span>
        {isMarkdown ? (
          <button
            type="button"
            className={editorButtonClass}
            onClick={() => setShowMarkdownPreview((value) => !value)}
          >
            {showMarkdownPreview ? 'Edit Markdown' : 'Preview Markdown'}
          </button>
        ) : null}
        <button
          type="button"
          className={editorButtonClass}
          disabled={!isDirty || isSaving}
          onClick={() => setDraft(file.content)}
        >
          Discard
        </button>
        <button
          type="button"
          className={editorPrimaryButtonClass}
          disabled={!isDirty || isSaving}
          onClick={() => void save()}
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>

      {showMarkdownPreview ? (
        <div
          className="min-h-48 overflow-auto p-4 text-sm text-slate-200"
          aria-label="Markdown preview"
        >
          <ChunkedMarkdown content={draft} />
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          aria-label={`Edit ${file.path}`}
          className="min-h-56 flex-1 resize-y bg-slate-950/70 p-4 font-mono text-xs leading-5 text-slate-100 outline-none focus:ring-2 focus:ring-blue-400/40 focus:ring-inset"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setSelection(null);
            setSaveMessage(null);
          }}
          onSelect={captureSelection}
        />
      )}

      {selection ? (
        <div className="space-y-2 border-t border-white/10 px-4 py-3">
          <p className="text-xs text-slate-300">
            Selected lines {selection.startLine}-{selection.endLine}
          </p>
          <div className="flex gap-2">
            <input
              aria-label="Annotation note"
              className="min-w-0 flex-1 rounded-md border border-white/10 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-blue-400"
              placeholder="Add a review note"
              value={annotationNote}
              onChange={(event) => setAnnotationNote(event.target.value)}
            />
            <button
              type="button"
              className={editorButtonClass}
              disabled={!annotationNote.trim()}
              onClick={addAnnotation}
            >
              Annotate
            </button>
            {onInsertIntoComposer ? (
              <button
                type="button"
                className={editorPrimaryButtonClass}
                onClick={() =>
                  onInsertIntoComposer(
                    buildWorkspaceRevisionPrompt(file.path, selection, annotations)
                  )
                }
              >
                Revise in composer
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {annotations.length ? (
        <ul className="space-y-1 border-t border-white/10 px-4 py-3 text-xs text-slate-300">
          {annotations.map((annotation) => (
            <li key={annotation.id} className="flex items-start justify-between gap-2">
              <span>
                Lines {annotation.startLine}-{annotation.endLine}: {annotation.note}
              </span>
              <button
                type="button"
                className="text-slate-500 hover:text-slate-200"
                aria-label={`Remove annotation ${annotation.note}`}
                onClick={() =>
                  setAnnotations((current) => current.filter((item) => item.id !== annotation.id))
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {saveMessage ? <p className="px-4 py-2 text-xs text-emerald-200">{saveMessage}</p> : null}
      {saveError ? <p className="px-4 py-2 text-xs text-rose-200">{saveError}</p> : null}
    </div>
  );
}

const editorButtonClass =
  'rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40';
const editorPrimaryButtonClass =
  'rounded-md bg-blue-500 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-40';
