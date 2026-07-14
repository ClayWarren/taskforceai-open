'use client';

import type { ReportIssueCategory } from '@taskforceai/client-core/support/reportIssues';
import {
  REPORT_ISSUE_MAX_LENGTH,
  REPORT_ISSUE_MIN_LENGTH,
} from '@taskforceai/client-core/support/reportIssues';
import { REPORT_ISSUE_CATEGORIES } from '@taskforceai/presenters/support/report-issue';
import { Button } from '@taskforceai/ui-kit/button';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

import { submitWebIssueReport } from '../../lib/api/issue-report';
import { logger } from '../../lib/logger';

interface ReportIssueModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context?: {
    conversationId?: string | null;
    lastMessagePreview?: string;
  };
}

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

const defaultDescription =
  'Please describe any issues, unexpected behavior, or feedback that would help us reproduce the problem.';

const fieldStyles =
  'w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-gray-400 focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-indigo-400/60';

const helperTextStyles = 'text-xs text-gray-400';

const statusBannerStyles =
  'flex items-center gap-2 rounded-xl px-3 py-2 text-sm border transition-colors';

const statusConfig = {
  success: {
    icon: CheckCircle2,
    className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    text: 'Thanks for the report — we will review it shortly.',
  },
  error: {
    icon: AlertCircle,
    className: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
    text: 'We could not send your report. Please try again.',
  },
};

const ReportIssueModal: React.FC<ReportIssueModalProps> = ({ open, onOpenChange, context }) => {
  const [category, setCategory] = useState<ReportIssueCategory | ''>('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<SubmitState>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const closeTimerRef = useRef<number | null>(null);

  const metadataContext = context;

  useEffect(() => {
    if (!open) {
      setCategory('');
      setDescription('');
      setStatus('idle');
      setErrorMessage('');
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    }
  }, [open]);

  useEffect(
    () => () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
      }
    },
    []
  );

  const charactersUsed = description.length;
  const canSubmit =
    Boolean(category) &&
    description.trim().length >= REPORT_ISSUE_MIN_LENGTH &&
    status !== 'submitting';

  const updateDescription = (value: string) => {
    setDescription(value.slice(0, REPORT_ISSUE_MAX_LENGTH));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || !category) {
      return;
    }

    setStatus('submitting');
    setErrorMessage('');

    try {
      const payload = {
        category,
        description: description.trim(),
        ...(metadataContext ? { context: metadataContext } : {}),
      };
      const result = await submitWebIssueReport(payload);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      setStatus('success');
      setDescription('');
      setCategory('');
      closeTimerRef.current = window.setTimeout(() => {
        onOpenChange(false);
        closeTimerRef.current = null;
      }, 1200);
    } catch (error) {
      logger.error('Failed to submit issue report', { error });
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Unable to submit report');
    }
  };

  if (!open) {
    return null;
  }

  return (
    <>
      <div className="profile-modal-overlay" onClick={() => onOpenChange(false)} />
      <div
        className="profile-modal report-issue-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-issue-title"
        aria-describedby="report-issue-description"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          onClick={() => onOpenChange(false)}
          className="profile-modal__close"
          aria-label="Close report issue modal"
          type="button"
        >
          ×
        </button>

        <div className="profile-modal__header">
          <h2 id="report-issue-title">Report an issue</h2>
          <p id="report-issue-description">
            These go straight to the TaskForceAI team. Add as much detail as you can so we can
            reproduce the problem quickly.
          </p>
        </div>

        <form
          className="report-issue-form space-y-6"
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
        >
          <div className="space-y-2">
            <label htmlFor="report-type" className="text-sm font-medium text-gray-200">
              Feedback type
            </label>
            <select
              id="report-type"
              value={category}
              onChange={(event) => {
                const value = event.target.value;
                // Validate that the value is a valid category
                const isValidCategory = REPORT_ISSUE_CATEGORIES.some((cat) => cat.value === value);
                if (isValidCategory) {
                  // Type assertion justified: validated that value exists in REPORT_ISSUE_CATEGORIES
                  setCategory(value as ReportIssueCategory);
                } else {
                  setCategory('');
                }
              }}
              className={`${fieldStyles} appearance-none`}
              required
            >
              <option value="" disabled>
                Select report type
              </option>
              {REPORT_ISSUE_CATEGORIES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <p className={helperTextStyles}>We route the report to the right team automatically.</p>
          </div>

          <div className="space-y-2">
            <label htmlFor="report-notes" className="text-sm font-medium text-gray-200">
              Your feedback
            </label>
            <textarea
              id="report-notes"
              value={description}
              onChange={(event) => updateDescription(event.target.value)}
              onInput={(event) => updateDescription(event.currentTarget.value)}
              placeholder={defaultDescription}
              rows={5}
              className={`${fieldStyles} resize-none`}
              minLength={REPORT_ISSUE_MIN_LENGTH}
              maxLength={REPORT_ISSUE_MAX_LENGTH}
              required
            />
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>Minimum {REPORT_ISSUE_MIN_LENGTH} characters.</span>
              <span>
                {charactersUsed}/{REPORT_ISSUE_MAX_LENGTH}
              </span>
            </div>
          </div>

          {status === 'success' || status === 'error' ? (
            <div className={statusBannerStyles + ` ${statusConfig[status].className}`}>
              {React.createElement(statusConfig[status].icon, { className: 'h-4 w-4' })}
              <span>
                {status === 'error' && errorMessage ? errorMessage : statusConfig[status].text}
              </span>
            </div>
          ) : null}

          <div className="report-issue-modal__actions">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={status === 'submitting'}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit}
              className="min-w-[96px] bg-white text-black hover:bg-white/90"
            >
              {status === 'submitting' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending
                </>
              ) : (
                'Send'
              )}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
};

export default ReportIssueModal;
