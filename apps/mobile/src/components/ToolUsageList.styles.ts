import { spacingTokens } from '@taskforceai/design-tokens';
import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  defaultContainer: {
    borderTopWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.25)',
    paddingTop: spacingTokens.sm,
    marginTop: spacingTokens.sm,
  },
  embeddedContainer: {
    marginTop: spacingTokens.md,
  },
  heading: {
    fontSize: 12,
    fontWeight: '600',
    color: '#d1d5db',
    marginBottom: spacingTokens.sm,
  },
  cardStack: {
    gap: spacingTokens.sm,
  },
  card: {
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.2)',
    borderRadius: 20,
    padding: spacingTokens.md,
    backgroundColor: 'rgba(13, 16, 24, 0.82)',
  },
  embeddedCard: {
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(13, 16, 24, 0.6)',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacingTokens.xs,
  },
  toolTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#f3f4f6',
    paddingRight: spacingTokens.sm,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: spacingTokens.sm,
    paddingVertical: spacingTokens.xs / 2,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#0f172a',
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacingTokens.sm,
    marginBottom: spacingTokens.sm,
  },
  metaText: {
    fontSize: 11,
    color: '#94a3b8',
  },
  section: {
    gap: spacingTokens.xs,
  },
  sectionHeading: {
    fontSize: 12,
    fontWeight: '600',
    color: '#c7d2fe',
  },
  sectionText: {
    fontSize: 12,
    color: '#e5e7eb',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacingTokens.xs,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: spacingTokens.sm,
    paddingVertical: spacingTokens.xs / 1.2,
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
  },
  chipText: {
    fontSize: 11,
    color: '#bfdbfe',
    fontWeight: '500',
  },
  codeBlock: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.3)',
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    padding: spacingTokens.sm,
  },
  codeText: {
    fontFamily: 'Courier',
    fontSize: 12,
    color: '#f3f4f6',
  },
  logBlock: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.2)',
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    padding: spacingTokens.sm,
  },
  logText: {
    fontFamily: 'Courier',
    fontSize: 12,
    color: '#e5e7eb',
  },
  errorText: {
    marginTop: spacingTokens.sm,
    fontSize: 12,
    color: '#f87171',
    fontWeight: '600',
  },
});

