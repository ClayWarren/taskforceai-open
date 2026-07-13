import { spacingTokens } from '@taskforceai/design-tokens';
import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacingTokens.md,
    paddingVertical: spacingTokens.md,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  headerButton: {
    alignItems: 'center',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  listContent: {
    paddingHorizontal: spacingTokens.lg,
    paddingBottom: spacingTokens.xl,
  },
  emptyListContent: {
    flexGrow: 1,
    paddingHorizontal: spacingTokens.lg,
  },
  projectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacingTokens.md,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: spacingTokens.sm,
  },
  projectInfo: {
    flex: 1,
    marginRight: spacingTokens.sm,
  },
  projectName: {
    fontSize: 16,
    fontWeight: '600',
  },
  projectDescription: {
    fontSize: 13,
    marginTop: 2,
  },
  projectActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacingTokens.sm,
  },
  emptyState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingBottom: spacingTokens.xl,
    paddingHorizontal: spacingTokens.md,
  },
  emptyIcon: {
    alignItems: 'center',
    borderRadius: 12,
    height: 48,
    justifyContent: 'center',
    marginBottom: spacingTokens.lg,
    width: 48,
  },
  emptyText: {
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 15,
    lineHeight: 21,
    marginTop: spacingTokens.sm,
    maxWidth: 300,
    textAlign: 'center',
  },
  emptyCreateButton: {
    borderRadius: 24,
    marginTop: spacingTokens.lg,
    paddingHorizontal: spacingTokens.xl,
    paddingVertical: 12,
  },
  emptyCreateButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  searchBar: {
    alignItems: 'center',
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacingTokens.sm,
    marginBottom: spacingTokens.md,
    marginHorizontal: spacingTokens.lg,
    paddingHorizontal: spacingTokens.md,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    minHeight: 50,
    paddingVertical: spacingTokens.sm,
  },
  modalOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacingTokens.lg,
  },
  createModal: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 16,
    padding: spacingTokens.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacingTokens.lg,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: spacingTokens.md,
    fontSize: 16,
    color: '#ffffff',
    marginBottom: spacingTokens.md,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacingTokens.sm,
    marginTop: spacingTokens.sm,
  },
  cancelButton: {
    paddingVertical: spacingTokens.sm,
    paddingHorizontal: spacingTokens.lg,
  },
  cancelButtonText: {
    fontSize: 16,
  },
  submitButton: {
    paddingVertical: spacingTokens.sm,
    paddingHorizontal: spacingTokens.lg,
    borderRadius: 8,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
});
