import { useVoice } from '@taskforceai/voice';
import { Download, ExternalLink } from 'lucide-react';
import React, {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { withCsrf } from '@taskforceai/contracts/auth/csrf';
import { formatMessageTime } from '@taskforceai/shared/time/display-format';
import { mergeSources } from '@taskforceai/shared/utils/source-extraction';
import { logger } from '../../lib/logger';
import { safeExternalHref } from '../../lib/safe-url';
import type { Message, SourceReference, ToolUsageEvent } from '../../lib/types';
import ChunkedMarkdown from '../markdown/ChunkedMarkdown';
import AgentExecutionPanel from './AgentExecutionPanel';
import { MessageActionBar, UserMessageActionBar } from './MessageActionBar';

const SourcesSidebar = lazy(() => import('./SourcesSidebar'));

interface MessageBubbleProps {
  message: Message;
  isUser: boolean;
  timestamp?: string;
  canShare?: boolean;
  onShare?: () => void;
  isLatestMessage?: boolean;
}

const AUTO_SCROLL_THRESHOLD_PX = 120;
const ASSISTANT_SCROLL_MARGIN_PX = 96;
type GeneratedFileArtifact = NonNullable<ToolUsageEvent['generatedFile']>;

const getScrollableAncestor = (element: HTMLElement): HTMLElement | null => {
  let current: HTMLElement | null = element.parentElement;
  while (current) {
    const { overflowY } = window.getComputedStyle(current);
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
      return current;
    }
    current = current.parentElement;
  }
  return null;
};

const scrollAssistantReplyToTop = (bubble: HTMLElement, scrollParent: HTMLElement | null) => {
  if (scrollParent) {
    const parentRect = scrollParent.getBoundingClientRect();
    const bubbleRect = bubble.getBoundingClientRect();
    const top =
      scrollParent.scrollTop + bubbleRect.top - parentRect.top - ASSISTANT_SCROLL_MARGIN_PX;

    if (typeof scrollParent.scrollTo === 'function') {
      scrollParent.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
    } else {
      scrollParent.scrollTop = Math.max(0, top);
    }
    return;
  }

  const top = window.scrollY + bubble.getBoundingClientRect().top - ASSISTANT_SCROLL_MARGIN_PX;
  window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
};

const formatGeneratedFileSize = (bytes?: number): string | null => {
  if (!bytes || bytes <= 0) {
    return null;
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const generatedFileKey = (file: GeneratedFileArtifact): string =>
  file.fileId || file.downloadUrl || `${file.filename}:${file.bytes ?? 0}`;

const extractGeneratedFiles = (events?: ToolUsageEvent[]): GeneratedFileArtifact[] => {
  const files = (events ?? [])
    .map((event) => event.generatedFile)
    .filter((file): file is GeneratedFileArtifact => Boolean(file?.filename));
  const seen = new Set<string>();
  return files.filter((file) => {
    const key = generatedFileKey(file);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const GeneratedFileList: React.FC<{ files: GeneratedFileArtifact[] }> = ({ files }) => {
  if (files.length === 0) {
    return null;
  }
  return (
    <div className="mt-4 flex flex-col gap-2" aria-label="Generated files">
      {files.map((file) => {
        const size = formatGeneratedFileSize(file.bytes);
        const downloadUrl = safeExternalHref(file.downloadUrl);
        return (
          <div
            key={generatedFileKey(file)}
            className="flex items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-300"
          >
            <div className="min-w-0">
              <div className="truncate font-medium text-slate-100">{file.filename}</div>
              <div className="truncate text-xs text-slate-500">
                {[file.mimeType, size].filter(Boolean).join(' · ')}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {file.artifactId && (
                <a
                  href={`/artifacts/${encodeURIComponent(file.artifactId)}`}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-700 bg-slate-900 text-slate-200 transition hover:border-blue-500/60 hover:text-blue-300"
                  aria-label={`Open ${file.filename}`}
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </a>
              )}
              {downloadUrl && (
                <a
                  href={downloadUrl}
                  download={file.filename}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-700 bg-slate-900 text-slate-200 transition hover:border-blue-500/60 hover:text-blue-300"
                  aria-label={`Download ${file.filename}`}
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  isUser,
  timestamp,
  canShare,
  onShare,
  isLatestMessage = false,
}) => {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const hasMountedRef = useRef(false);
  const previousStreamingRef = useRef(Boolean(message.isStreaming));
  const anchorTimerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { manager: voice, status: voiceStatus } = useVoice();
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rating, setRating] = useState<number>(message.rating ?? 0);
  const resolvedSources = useMemo(() => {
    const explicitSources = message.sources ?? [];
    if (explicitSources.length > 0) {
      return explicitSources;
    }
    const toolSources = (message.toolEvents ?? []).flatMap((event) => event.sources ?? []);
    return mergeSources([], toolSources);
  }, [message.sources, message.toolEvents]);
  const [sourcesModalSources, setSourcesModalSources] =
    useState<SourceReference[]>(resolvedSources);
  const generatedFiles = useMemo(
    () => extractGeneratedFiles(message.toolEvents),
    [message.toolEvents]
  );

  const handleRating = async (value: number) => {
    const newRating = rating === value ? 0 : value;
    const previousRating = rating;
    setRating(newRating);

    try {
      const requestInit = await withCsrf({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: newRating }),
      });
      const response = await fetch(
        `/api/v1/messages/${encodeURIComponent(message.id)}/feedback`,
        requestInit
      );

      if (!response.ok) {
        if (response.status === 403 || response.status === 404) {
          setRating(previousRating);
          return;
        }
        throw new Error(`Failed to submit feedback: ${response.statusText}`);
      }
    } catch (error) {
      setRating(previousRating);
      logger.error('Failed to submit feedback', { error, messageId: message.id });
    }
  };

  const userMaxWidthStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: 'var(--chat-bubble-max-width, 94%)',
    boxSizing: 'border-box',
  };
  const sourceCount = resolvedSources.length;
  const hasSources = sourceCount > 0;
  const showAssistantActions = !isUser && !message.isLocalCommandOutput;
  const timestampLabel = formatMessageTime(timestamp ?? message.createdAt);

  const handleSpeak = async () => {
    if (!message.content.trim() || voiceStatus === 'error') {
      return;
    }

    setIsSpeaking(true);
    try {
      await voice.init();
      await voice.speak(message.content);
    } catch (error) {
      logger.error('Failed to speak message', { error });
    } finally {
      setIsSpeaking(false);
    }
  };

  const handleStop = async () => {
    try {
      await voice.cancel();
    } catch (error) {
      logger.error('Failed to stop speaking', { error });
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      logger.error('Failed to copy message', { error });
    }
  };

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      anchorTimerRefs.current.forEach((timer) => clearTimeout(timer));
      anchorTimerRefs.current = [];
    };
  }, []);

  const voiceRef = useRef(voice);
  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);

  useEffect(() => {
    return () => {
      try {
        const promise = voiceRef.current.cancel();
        if (promise && typeof promise.catch === 'function') {
          promise.catch((error: unknown) => {
            logger.error('Failed to cancel voice on unmount', { error });
          });
        }
      } catch (error) {
        logger.error('Failed to cancel voice on unmount', { error });
      }
    };
  }, []);

  useEffect(() => {
    if (!isUser && bubbleRef.current) {
      const bubble = bubbleRef.current;
      const scrollParent = getScrollableAncestor(bubble);
      const firstMountAllowance = hasMountedRef.current ? 0 : bubble.offsetHeight;
      const threshold = AUTO_SCROLL_THRESHOLD_PX + firstMountAllowance;
      const distanceFromBottom = scrollParent
        ? scrollParent.scrollHeight - scrollParent.scrollTop - scrollParent.clientHeight
        : document.documentElement.scrollHeight - window.scrollY - window.innerHeight;

      const shouldAnchorLatestAssistant =
        isLatestMessage && !hasMountedRef.current && !message.isStreaming;
      const completedLatestStreamingMessage =
        isLatestMessage && previousStreamingRef.current && !message.isStreaming;

      if (
        !message.isStreaming &&
        (shouldAnchorLatestAssistant ||
          completedLatestStreamingMessage ||
          distanceFromBottom <= threshold)
      ) {
        scrollAssistantReplyToTop(bubble, scrollParent);
        anchorTimerRefs.current.forEach((timer) => clearTimeout(timer));
        anchorTimerRefs.current = [80, 180].map((delay) =>
          setTimeout(() => {
            if (bubbleRef.current) {
              scrollAssistantReplyToTop(
                bubbleRef.current,
                getScrollableAncestor(bubbleRef.current)
              );
            }
          }, delay)
        );
      } else if (distanceFromBottom <= threshold) {
        bubble.scrollIntoView({
          behavior: 'smooth',
          block: 'end',
        });
      }
      hasMountedRef.current = true;
      previousStreamingRef.current = Boolean(message.isStreaming);
    }
  }, [isLatestMessage, message.content, message.isStreaming, isUser]);

  useEffect(() => {
    setSourcesModalSources(resolvedSources);
  }, [resolvedSources]);

  useEffect(() => {
    setRating(message.rating ?? 0);
  }, [message.rating]);

  const openSourcesPanel = useCallback(
    (override?: SourceReference[]) => {
      const resolved = override && override.length > 0 ? override : resolvedSources;
      if (resolved.length === 0) {
        return;
      }
      setSourcesModalSources(resolved);
      setIsModalOpen(true);
    },
    [resolvedSources]
  );

  const userLines = isUser ? message.content.split('\n') : null;

  const hasStoredExecutionMetadata =
    (message.agentStatuses?.length ?? 0) > 0 || (message.toolEvents?.length ?? 0) > 0;

  // Show AgentExecutionPanel for live status messages and persisted assistant messages with run metadata.
  const showAgentExecutionPanel =
    !isUser &&
    (message.isAgentStatus || (hasStoredExecutionMetadata && generatedFiles.length === 0));

  // Show final message bubble for non-agent-status messages with content
  const showFinalMessage =
    !isUser &&
    !message.isAgentStatus &&
    (message.content.trim().length > 0 || generatedFiles.length > 0);

  if (!showAgentExecutionPanel && !showFinalMessage && !isUser) {
    return null;
  }

  return (
    <>
      {showAgentExecutionPanel && (
        <div className="message-bubble bot mb-6 flex justify-start">
          <div className="chat-aligned chat-edge-left flex flex-col gap-2">
            <AgentExecutionPanel message={message} onShowSources={openSourcesPanel} />
          </div>
        </div>
      )}
      {(isUser || showFinalMessage) && (
        <>
          <div
            ref={bubbleRef}
            className={`message-bubble ${isUser ? 'user' : 'bot'} flex ${isUser ? 'justify-end' : 'justify-start'} mb-6`}
            style={!isUser ? { scrollMarginBlockStart: '96px' } : undefined}
          >
            <div
              className={`${!isUser ? 'chat-aligned chat-edge-left border-l-2 border-slate-800 pl-4' : ''} transition-all duration-200 ${
                isUser
                  ? 'rounded-3xl bg-gray-800 p-4 text-white shadow-sm'
                  : 'bg-transparent text-gray-100'
              }`}
              style={isUser ? userMaxWidthStyle : undefined}
            >
              <div className="message-content prose prose-sm dark:prose-invert max-w-none">
                {isUser ? (
                  userLines?.map((line, index) => (
                    <React.Fragment key={index}>
                      {line}
                      {index < (userLines?.length ?? 0) - 1 && <br />}
                    </React.Fragment>
                  ))
                ) : (
                  <ChunkedMarkdown content={message.content} />
                )}
              </div>
              {!isUser && <GeneratedFileList files={generatedFiles} />}
              {isUser && timestampLabel && (
                <div
                  className={`mt-3 text-xs ${isUser ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'}`}
                >
                  {timestampLabel}
                </div>
              )}
            </div>
          </div>
          {isUser && <UserMessageActionBar copied={copied} onCopy={() => void handleCopy()} />}
          {showAssistantActions && (
            <MessageActionBar
              copied={copied}
              isSpeaking={isSpeaking}
              voiceStatus={voiceStatus}
              canShare={canShare}
              hasSources={hasSources}
              sourceCount={sourceCount}
              rating={rating}
              timestampLabel={timestampLabel}
              onCopy={() => void handleCopy()}
              onSpeakToggle={() => {
                if (isSpeaking) {
                  void handleStop();
                } else {
                  void handleSpeak();
                }
              }}
              onShare={onShare}
              onOpenSources={() => openSourcesPanel()}
              onRate={(value) => void handleRating(value)}
            />
          )}
        </>
      )}
      {isModalOpen && (
        <Suspense fallback={null}>
          <SourcesSidebar
            sources={sourcesModalSources}
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
};

export default memo(MessageBubble);
