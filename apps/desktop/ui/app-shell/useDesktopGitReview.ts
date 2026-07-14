import { useCallback, useEffect, useState } from 'react';

import { readDesktopCodeWorkspaceRoots } from '@taskforceai/web/app/lib/desktop/task-mode';
import { logger } from '@taskforceai/web/app/lib/logger';
import {
  addDesktopGitReviewComment,
  getDesktopGitReviewDiff,
  getDesktopGitReviewStatus,
  listDesktopGitReviewComments,
  resolveDesktopGitReviewComment,
  runDesktopGitReviewPullRequestAction,
  updateDesktopGitReviewStage,
  type AppServerAgentSession,
  type AppServerGitReviewComment,
  type AppServerGitReviewDiffResult,
  type AppServerGitReviewPullRequestAction,
  type AppServerGitReviewScope,
  type AppServerGitReviewStatusResult,
} from '../platform/app-server';

interface DesktopGitReviewOptions {
  enabled: boolean;
  open: boolean;
  sessions: AppServerAgentSession[];
}

export function useDesktopGitReview({ enabled, open, sessions }: DesktopGitReviewOptions) {
  const [workspace, setWorkspace] = useState('');
  const [workspaceRoots, setWorkspaceRoots] = useState<string[]>([]);
  const [scope, setScope] = useState<AppServerGitReviewScope>('uncommitted');
  const [status, setStatus] = useState<AppServerGitReviewStatusResult | null>(null);
  const [diff, setDiff] = useState<AppServerGitReviewDiffResult | null>(null);
  const [comments, setComments] = useState<AppServerGitReviewComment[]>([]);
  const [threadId, setThreadId] = useState('');
  const [commentPath, setCommentPath] = useState('');
  const [commentLine, setCommentLine] = useState('1');
  const [commentEndLine, setCommentEndLine] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [reviewBody, setReviewBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [reviewAttempted, setReviewAttempted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const roots = readDesktopCodeWorkspaceRoots();
    setWorkspaceRoots(roots);
    setWorkspace((current) => current || roots[0] || '');
  }, [open]);

  const loadReview = useCallback(
    async (nextScope: AppServerGitReviewScope, workspaceValue: string, codeThreadId: string) => {
      const trimmedWorkspace = workspaceValue.trim();
      const workspaceParams = trimmedWorkspace ? { workspace: trimmedWorkspace } : {};
      try {
        setReviewAttempted(true);
        setLoading(true);
        setMessage(null);
        const [nextStatus, nextDiff, nextComments] = await Promise.all([
          getDesktopGitReviewStatus(workspaceParams),
          getDesktopGitReviewDiff({
            ...workspaceParams,
            scope: nextScope,
            maxBytes: 256 * 1024,
            ...(nextScope === 'lastTurn' && codeThreadId ? { threadId: codeThreadId } : {}),
          }),
          listDesktopGitReviewComments(workspaceParams).catch(() => ({ comments: [] })),
        ]);
        setStatus(nextStatus);
        setDiff(nextDiff);
        setComments(nextComments.comments);
        setCommentPath((current) => current || nextStatus.files[0]?.path || '');
        if (!nextStatus.isGitRepository) {
          setMessage(nextStatus.message);
        } else if (nextDiff.truncated) {
          setMessage('Diff truncated to the first 256 KB.');
        }
      } catch (error) {
        logger.warn('Failed to refresh desktop git review state', { error });
        setMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const refresh = useCallback(
    () => loadReview(scope, workspace, threadId),
    [loadReview, scope, threadId, workspace]
  );

  useEffect(() => {
    if (!enabled || !open || reviewAttempted || status || loading) return;
    void refresh();
  }, [enabled, loading, open, refresh, reviewAttempted, status]);

  useEffect(() => {
    if (!open) setReviewAttempted(false);
  }, [open]);

  const runOperation = async <T>(operation: () => Promise<T>): Promise<T | null> => {
    try {
      setLoading(true);
      setMessage(null);
      const result = await operation();
      await refresh();
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setLoading(false);
    }
  };

  const workspaceParams = workspace.trim() ? { workspace: workspace.trim() } : {};

  const selectScope = (nextScope: AppServerGitReviewScope) => {
    setScope(nextScope);
    if (nextScope === 'lastTurn' && !threadId) {
      setDiff(null);
      setMessage('Select a Code thread to review its last turn.');
      return;
    }
    void loadReview(nextScope, workspace, threadId);
  };

  const selectThread = (nextThreadId: string) => {
    setThreadId(nextThreadId);
    void loadReview('lastTurn', workspace, nextThreadId);
  };

  const stageFile = (path: string, staged: boolean) =>
    runOperation(() =>
      updateDesktopGitReviewStage({
        ...workspaceParams,
        paths: [path],
        staged,
      })
    );

  const addComment = async () => {
    const line = Number.parseInt(commentLine, 10);
    const endLine = commentEndLine.trim() ? Number.parseInt(commentEndLine, 10) : undefined;
    if (!commentPath || !Number.isFinite(line) || line < 1 || !commentBody.trim()) return;
    await runOperation(async () => {
      await addDesktopGitReviewComment({
        ...workspaceParams,
        path: commentPath,
        line,
        ...(endLine ? { endLine } : {}),
        body: commentBody.trim(),
      });
      setCommentBody('');
    });
  };

  const toggleComment = (comment: AppServerGitReviewComment) =>
    runOperation(() =>
      resolveDesktopGitReviewComment({
        commentId: comment.id,
        resolved: !comment.resolved,
      })
    );

  const runPullRequestAction = async (action: AppServerGitReviewPullRequestAction) => {
    const result = await runOperation(() =>
      runDesktopGitReviewPullRequestAction({
        ...workspaceParams,
        action,
        ...(reviewBody.trim() ? { body: reviewBody.trim() } : {}),
      })
    );
    if (result) {
      setMessage(result.message);
      if (action !== 'markReady') setReviewBody('');
    }
  };

  return {
    addComment,
    commentBody,
    commentEndLine,
    commentLine,
    commentPath,
    comments,
    diff,
    loading,
    message,
    refresh,
    reviewBody,
    runPullRequestAction,
    scope,
    selectScope,
    selectThread,
    sessions,
    setCommentBody,
    setCommentEndLine,
    setCommentLine,
    setCommentPath,
    setReviewBody,
    setWorkspace,
    stageFile,
    status,
    threadId,
    toggleComment,
    workspace,
    workspaceRoots,
  };
}

export type DesktopGitReviewController = ReturnType<typeof useDesktopGitReview>;
