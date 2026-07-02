import React from 'react';

export interface ModeBadge {
  id: string;
  label: string;
  icon: string;
  enabled: boolean;
  onClick: () => void;
  onDismiss?: () => void;
}

interface ModeBadgesProps {
  badges: ModeBadge[];
}

export const ModeBadges: React.FC<ModeBadgesProps> = ({ badges }) => {
  const activeBadges = badges.filter((b) => b.enabled);

  if (activeBadges.length === 0) return null;

  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {activeBadges.map((badge) => (
        <button
          key={badge.id}
          type="button"
          onClick={badge.onClick}
          className="flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-white/20"
        >
          <span>{badge.icon}</span>
          <span>{badge.label}</span>
          {badge.onDismiss && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                badge.onDismiss?.();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  badge.onDismiss?.();
                }
              }}
              className="ml-1 rounded-full p-0.5 transition-colors hover:bg-white/20"
              aria-label={`Disable ${badge.label}`}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </span>
          )}
        </button>
      ))}
    </div>
  );
};
