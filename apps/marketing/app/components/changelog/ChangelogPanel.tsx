import React, { useMemo } from 'react';

import ChunkedMarkdown from '@/components/markdown/ChunkedMarkdown';
import { Button } from '@taskforceai/ui-kit/button';

interface ChangelogPanelProps {
  content?: string;
  lastUpdated?: string | undefined;
  onStartChat?: () => void;
}

const EMPTY_CHANGELOG = `## 🚧 Updates in progress\nWe're preparing the latest release notes.`;

const formatDate = (value?: string): string | null => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
};

const ChangelogPanel: React.FC<ChangelogPanelProps> = ({ content, lastUpdated, onStartChat }) => {
  const markdown = content?.trim().length ? content : EMPTY_CHANGELOG;
  const lastUpdatedLabel = useMemo(() => formatDate(lastUpdated), [lastUpdated]);

  return (
    <section className="changelog-panel">
      <header className="changelog-panel__header">
        <div>
          <p className="changelog-panel__eyebrow">Product updates</p>
          <h1 className="changelog-panel__title">TaskForceAI Changelog</h1>
          <p className="changelog-panel__subtitle">
            Track every release, improvement, and bug fix -- all without leaving your workspace.
          </p>
        </div>
        <div className="changelog-panel__actions">
          {lastUpdatedLabel ? (
            <span className="changelog-panel__meta">Last updated {lastUpdatedLabel}</span>
          ) : (
            <span className="changelog-panel__meta">Fresh updates arrive weekly</span>
          )}
          {onStartChat ? (
            <Button onClick={onStartChat} variant="outline">
              Back to chat
            </Button>
          ) : (
            <Button asChild variant="outline">
              <a href="https://www.taskforceai.chat/">Back to chat</a>
            </Button>
          )}
        </div>
      </header>
      <div className="changelog-panel__body">
        <div className="changelog-panel__timeline">
          <ChunkedMarkdown content={markdown} />
        </div>
      </div>
    </section>
  );
};

export default ChangelogPanel;
