/**
 * Component barrel exports for cleaner imports
 * Usage: import { ConversationList, ProfileModal } from '@taskforceai/web/components';
 */

// Chat
export { default as ConversationList } from './chat/ConversationList';
export { default as ConversationItem } from './chat/ConversationItem';
export { default as PromptForm } from './chat/PromptForm';
export { default as AgentExecutionPanel } from './chat/AgentExecutionPanel';
export { default as AgentProgress } from './chat/AgentProgress';
export { default as MessageBubble } from './chat/MessageBubble';
export { default as RateLimitError } from './chat/RateLimitError';
export { default as ToolUsageList } from './chat/ToolUsageList';

// Shell
export { default as Sidebar } from './shell/Sidebar';
export { default as ThemeToggle } from './shell/ThemeToggle';
export { default as LanguageSwitcher } from './shell/LanguageSwitcher';
export { default as OfflineIndicator } from './shell/OfflineIndicator';
export { SyncStatusIndicator } from './shell/SyncStatusIndicator';
export { ErrorBoundary } from './shell/ErrorBoundary';
export { CookieBanner } from '@taskforceai/ui-kit/CookieBanner';

// UI
export { Skeleton } from '@taskforceai/ui-kit/SkeletonScreen';

// Lib / Providers (re-exports)
export { default as ProfileModal } from '../lib/profile/ProfileModal';
export { useAuth, AuthProvider } from '../lib/providers/AuthProvider';
export { useStreaming, StreamingProvider } from '../lib/providers/StreamingProvider';
