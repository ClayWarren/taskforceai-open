import { Check, Copy, MoreHorizontal, Square, ThumbsDown, ThumbsUp, Volume2 } from 'lucide-react';
import { useState } from 'react';

interface MessageActionBarProps {
  copied: boolean;
  isSpeaking: boolean;
  listenDisabled: boolean;
  canShare?: boolean;
  hasSources: boolean;
  sourceCount: number;
  rating: number;
  timestampLabel?: string;
  compact?: boolean;
  hideListen?: boolean;
  hideFeedback?: boolean;
  onCopy: () => void;
  onSpeakToggle: () => void;
  onShare?: () => void;
  onOpenSources: () => void;
  onRate: (_value: number) => void;
}

const buttonClass =
  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-gray-400 transition-colors hover:bg-white/5 hover:text-white';
const iconButtonClass =
  'flex h-8 w-8 items-center justify-center rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-white/5 hover:text-white';

type FeedbackButtonsProps = Pick<MessageActionBarProps, 'rating' | 'onRate'> & {
  className: string;
};

const FeedbackButtons = ({ className, rating, onRate }: FeedbackButtonsProps) => (
  <>
    <button
      type="button"
      className={`${className} ${rating === 1 ? 'text-emerald-500' : ''}`}
      onClick={() => onRate(1)}
      title="Helpful"
      aria-label={rating === 1 ? 'Rated positive' : 'Rate positive'}
    >
      <ThumbsUp className="h-4 w-4" fill={rating === 1 ? 'currentColor' : 'none'} />
    </button>
    <button
      type="button"
      className={`${className} ${rating === -1 ? 'text-rose-500' : ''}`}
      onClick={() => onRate(-1)}
      title="Not helpful"
      aria-label={rating === -1 ? 'Rated negative' : 'Rate negative'}
    >
      <ThumbsDown className="h-4 w-4" fill={rating === -1 ? 'currentColor' : 'none'} />
    </button>
  </>
);

export function UserMessageActionBar(
  props: Pick<MessageActionBarProps, 'copied' | 'onCopy'> & { compact?: boolean }
) {
  return (
    <div
      className={
        props.compact
          ? 'mt-2 flex items-center justify-end gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100'
          : 'mt-2 flex items-center justify-end gap-1'
      }
    >
      <button
        type="button"
        className={props.compact ? iconButtonClass : buttonClass}
        onClick={props.onCopy}
        title="Copy message"
        aria-label={props.copied ? 'Copied message' : 'Copy message'}
      >
        {props.copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {!props.compact && (props.copied ? 'Copied' : 'Copy')}
      </button>
    </div>
  );
}

const CompactMessageActionBar = (props: MessageActionBarProps) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const copyLabel = props.copied ? 'Copied response' : 'Copy response';
  return (
    <div className="chat-aligned chat-edge-left mt-2 flex items-center gap-1">
      <button
        type="button"
        className={iconButtonClass}
        onClick={props.onCopy}
        title="Copy response"
        aria-label={copyLabel}
      >
        {props.copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </button>
      {!props.hideFeedback && <FeedbackButtons className={iconButtonClass} {...props} />}
      {props.timestampLabel && (
        <div className="relative">
          <button
            type="button"
            className={iconButtonClass}
            onClick={() => setIsMenuOpen((current) => !current)}
            title="More options"
            aria-label="More options"
            aria-expanded={isMenuOpen}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {isMenuOpen && (
            <div
              role="menu"
              className="absolute top-full left-0 z-20 mt-1 min-w-28 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-xs text-gray-300 shadow-xl"
            >
              <time>{props.timestampLabel}</time>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export function MessageActionBar(props: MessageActionBarProps) {
  if (props.compact) {
    return <CompactMessageActionBar {...props} />;
  }

  return (
    <div className="chat-aligned chat-edge-left mt-3 flex flex-wrap items-center gap-1">
      <button type="button" className={buttonClass} onClick={props.onCopy} title="Copy response">
        {props.copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {props.copied ? 'Copied' : 'Copy'}
      </button>

      {!props.hideListen && (
        <button
          type="button"
          className={buttonClass}
          onClick={props.onSpeakToggle}
          disabled={props.listenDisabled}
          title={props.isSpeaking ? 'Stop listening' : 'Listen to response'}
        >
          {props.isSpeaking ? <Square className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          {props.isSpeaking ? 'Stop' : 'Listen'}
        </button>
      )}

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

      {!props.hideFeedback && (
        <div className="ml-1 flex items-center border-l border-white/10 pl-1">
          <FeedbackButtons className={buttonClass} {...props} />
        </div>
      )}
    </div>
  );
}
