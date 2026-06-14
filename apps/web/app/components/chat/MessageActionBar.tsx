import { Check, Copy, ThumbsDown, ThumbsUp } from 'lucide-react';

interface MessageActionBarProps {
  copied: boolean;
  isSpeaking: boolean;
  voiceStatus: string;
  canShare?: boolean;
  hasSources: boolean;
  sourceCount: number;
  rating: number;
  timestampLabel?: string;
  onCopy: () => void;
  onSpeakToggle: () => void;
  onShare?: () => void;
  onOpenSources: () => void;
  onRate: (_value: number) => void;
}

const buttonClass =
  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-gray-400 transition-colors hover:bg-white/5 hover:text-white';

export function UserMessageActionBar(props: Pick<MessageActionBarProps, 'copied' | 'onCopy'>) {
  return (
    <div className="mt-2 flex items-center justify-end gap-1">
      <button type="button" className={buttonClass} onClick={props.onCopy} title="Copy message">
        {props.copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {props.copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export function MessageActionBar(props: MessageActionBarProps) {
  return (
    <div className="chat-aligned chat-edge-left mt-3 flex flex-wrap items-center gap-1">
      <button type="button" className={buttonClass} onClick={props.onCopy} title="Copy response">
        {props.copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {props.copied ? 'Copied' : 'Copy'}
      </button>

      <button
        type="button"
        className={buttonClass}
        onClick={props.onSpeakToggle}
        disabled={props.voiceStatus === 'error'}
        title={props.isSpeaking ? 'Stop listening' : 'Listen to response'}
      >
        {props.isSpeaking ? (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10h6v4H9z" />
          </svg>
        ) : (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
            />
          </svg>
        )}
        {props.isSpeaking ? 'Stop' : 'Listen'}
      </button>

      {props.canShare && props.onShare && (
        <button
          type="button"
          className={buttonClass}
          onClick={props.onShare}
          title="Share conversation"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
            />
          </svg>
          Share
        </button>
      )}

      {props.hasSources && (
        <button
          type="button"
          className={buttonClass}
          onClick={props.onOpenSources}
          title="View sources"
          data-testid="sources"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
            />
          </svg>
          {props.sourceCount} source{props.sourceCount === 1 ? '' : 's'}
        </button>
      )}

      {props.timestampLabel && (
        <time className="px-2 py-1.5 text-xs text-gray-500 dark:text-gray-400">
          {props.timestampLabel}
        </time>
      )}

      <div className="ml-1 flex items-center border-l border-white/10 pl-1">
        <button
          type="button"
          className={`${buttonClass} ${props.rating === 1 ? 'text-emerald-500' : ''}`}
          onClick={() => props.onRate(1)}
          title="Helpful"
          aria-label={props.rating === 1 ? 'Rated positive' : 'Rate positive'}
        >
          <ThumbsUp className="h-4 w-4" fill={props.rating === 1 ? 'currentColor' : 'none'} />
        </button>
        <button
          type="button"
          className={`${buttonClass} ${props.rating === -1 ? 'text-rose-500' : ''}`}
          onClick={() => props.onRate(-1)}
          title="Not helpful"
          aria-label={props.rating === -1 ? 'Rated negative' : 'Rate negative'}
        >
          <ThumbsDown className="h-4 w-4" fill={props.rating === -1 ? 'currentColor' : 'none'} />
        </button>
      </div>
    </div>
  );
}
