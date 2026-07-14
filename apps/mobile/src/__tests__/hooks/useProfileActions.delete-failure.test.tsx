import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { useProfileActions } from '../../hooks/useProfileActions';

const mockDeleteAccount = jest.fn().mockRejectedValue(new Error('delete failed'));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { email: 'failure@example.com', id: '1', name: 'Failure' },
    logout: jest.fn(),
  }),
}));
jest.mock('../../hooks/api/compliance', () => ({
  useDeleteAccountMutation: () => ({ mutateAsync: mockDeleteAccount }),
  useExportDataMutation: () => ({ mutateAsync: jest.fn() }),
}));
jest.mock('../../api/client', () => ({
  getMobileClient: () => ({ createPortalSession: jest.fn() }),
}));
jest.mock('../../logger', () => ({
  createModuleLogger: () => ({ debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() }),
}));
jest.mock('../../utils/file-system', () => ({
  documentDirectory: 'file:///documents/',
  EncodingType: { UTF8: 'utf8' },
  writeAsStringAsync: jest.fn(),
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('react-i18next', () =>
  require('../helpers/mock-modules').createTranslationMockModule()
);

describe('useProfileActions account deletion failure', () => {
  it('reports a failed destructive account deletion', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { result } = await renderHook(() => useProfileActions(jest.fn()));

    act(() => result.current.handleDeleteAccount());
    const destructiveButton = (Alert.alert as jest.Mock).mock.calls[0]?.[2].find(
      (button: { style?: string }) => button.style === 'destructive'
    );
    act(() => destructiveButton.onPress());

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenLastCalledWith(
        'mobile.profile.deleteErrorTitle',
        'mobile.profile.deleteErrorMessage'
      )
    );
  });
});
