'use client';

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { getRuntimeEnv } from '@taskforceai/config/app-env';
import { Button } from '@taskforceai/ui-kit/button';
import { Input } from '@taskforceai/ui-kit/input';
import { setConversationSharing } from '../../lib/api/conversations';
import { logger } from '../../lib/logger';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId: number;
  initialIsPublic?: boolean;
  initialShareId?: string;
}

const resolveShareBaseUrl = (): string => {
  const configuredSiteUrl = getRuntimeEnv('VITE_SITE_URL')?.trim();
  if (configuredSiteUrl) {
    return configuredSiteUrl.replace(/\/+$/, '');
  }

  if (typeof window !== 'undefined' && window.location.origin) {
    return window.location.origin;
  }

  return 'https://taskforceai.chat';
};

const buildShareUrl = (shareId: string): string => `${resolveShareBaseUrl()}/share/${shareId}`;

const ShareModal: React.FC<ShareModalProps> = ({
  isOpen,
  onClose,
  conversationId,
  initialIsPublic = false,
  initialShareId = '',
}) => {
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [shareUrl, setShareId] = useState(initialShareId ? buildShareUrl(initialShareId) : '');
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guard against concurrent handleShare calls (bug #12)
  const isHandlingShareRef = React.useRef(false);

  React.useEffect(() => {
    setIsPublic(initialIsPublic);
    setShareId(initialShareId ? buildShareUrl(initialShareId) : '');
  }, [initialIsPublic, initialShareId, conversationId]);

  const copiedTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current !== null) {
        clearTimeout(copiedTimeoutRef.current);
      }
    };
  }, []);

  if (!isOpen) return null;

  const handleShare = async () => {
    // Prevent concurrent executions from rapid double-clicks (bug #12)
    if (isHandlingShareRef.current) return;
    isHandlingShareRef.current = true;
    setIsLoading(true);
    setError(null);
    try {
      const res = await setConversationSharing(conversationId, !isPublic);
      setIsPublic(res.isPublic);
      setShareId(res.url);
    } catch (err) {
      logger.error('Failed to share conversation', { error: err });
      setError('Failed to update sharing settings. Please try again.');
    } finally {
      setIsLoading(false);
      isHandlingShareRef.current = false;
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      if (copiedTimeoutRef.current !== null) {
        clearTimeout(copiedTimeoutRef.current);
      }
      copiedTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      logger.error('Failed to copy share URL to clipboard', { error: err });
    }
  };

  const modalContent = (
    <>
      <div className="profile-modal-overlay" onClick={onClose} />
      <div className="profile-modal !max-w-md" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="profile-modal__close" aria-label="Close">
          ×
        </button>

        <div className="profile-modal__header">
          <h2>Share link to conversation</h2>
          <p>Messages you send after sharing won't be visible to others.</p>
        </div>

        <div className="space-y-6">
          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-center text-xs text-rose-400">
              {error}
            </div>
          )}
          {!isPublic ? (
            <div className="flex flex-col gap-4 text-center">
              <p className="text-left text-sm text-muted-foreground">
                Sharing is currently disabled for this conversation. Enable it to get a public link.
              </p>
              <Button
                onClick={() => {
                  void handleShare();
                }}
                disabled={isLoading}
              >
                {isLoading ? 'Enabling...' : 'Create public link'}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex gap-2">
                <Input value={shareUrl} readOnly className="flex-1 bg-white/5" />
                <Button
                  onClick={() => {
                    void copyToClipboard();
                  }}
                  variant="outline"
                  className="min-w-[80px]"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </Button>
              </div>
              <Button
                variant="ghost"
                className="w-full text-xs text-muted-foreground hover:text-destructive"
                onClick={() => {
                  void handleShare();
                }}
                disabled={isLoading}
              >
                {isLoading ? 'Disabling...' : 'Disable public link'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : null;
};

export default ShareModal;
