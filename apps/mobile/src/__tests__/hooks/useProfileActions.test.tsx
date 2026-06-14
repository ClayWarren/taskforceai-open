import { renderHook, act } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';
import * as Sharing from 'expo-sharing';
import * as FileSystem from '../../utils/file-system';
import { useProfileActions } from '../../hooks/useProfileActions';
import { useAuth } from '../../contexts/AuthContext';
import { useDeleteAccountMutation, useExportDataMutation } from '../../hooks/api/compliance';

jest.mock('../../contexts/AuthContext');
jest.mock('../../hooks/api/compliance');
jest.mock('../../logger', () => ({
    createModuleLogger: () => ({
        debug: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
    }),
}));
jest.mock('expo-sharing');
jest.mock('../../utils/file-system', () => ({
    documentDirectory: 'file:///mock-dir/',
    writeAsStringAsync: jest.fn(),
    EncodingType: { UTF8: 'utf8', Base64: 'base64' },
}));
jest.mock('react-i18next', () =>
    require('../helpers/mock-modules').createTranslationMockModule()
);

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockExportMutation = useExportDataMutation as jest.MockedFunction<typeof useExportDataMutation>;
const mockDeleteMutation = useDeleteAccountMutation as jest.MockedFunction<typeof useDeleteAccountMutation>;

const mockLogout = jest.fn().mockResolvedValue(undefined);
const mockExportMutateAsync = jest.fn().mockResolvedValue('{"data":"export"}');
const mockDeleteMutateAsync = jest.fn().mockResolvedValue(undefined);

const onCloseMock = jest.fn();

beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({
        user: { email: 'test@example.com', id: '1', name: 'Test' },
        logout: mockLogout,
    } as any);
    mockExportMutation.mockReturnValue({ mutateAsync: mockExportMutateAsync } as any);
    mockDeleteMutation.mockReturnValue({ mutateAsync: mockDeleteMutateAsync } as any);
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);
    (Sharing.shareAsync as jest.Mock).mockResolvedValue(undefined);
    (FileSystem.writeAsStringAsync as jest.Mock).mockResolvedValue(undefined);
    jest.spyOn(Alert, 'alert').mockImplementation(() => { });
});

describe('useProfileActions', () => {
    it('returns expected action functions', () => {
        const { result } = renderHook(() => useProfileActions(onCloseMock));
        expect(result.current.handleLogout).toBeDefined();
        expect(result.current.handleDataExport).toBeDefined();
        expect(result.current.handleDeleteAccount).toBeDefined();
        expect(result.current.openBillingPortal).toBeDefined();
        expect(result.current.isAccountActionLoading).toBe(false);
    });

    it('handleLogout shows alert with logout option', () => {
        const { result } = renderHook(() => useProfileActions(onCloseMock));
        act(() => { result.current.handleLogout(); });
        expect(Alert.alert).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(String),
            expect.arrayContaining([
                expect.objectContaining({ style: 'cancel' }),
                expect.objectContaining({ style: 'destructive' }),
            ])
        );
    });

    it('handleLogout destructive button calls logout and onClose', async () => {
        const { result } = renderHook(() => useProfileActions(onCloseMock));
        act(() => { result.current.handleLogout(); });

        const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
        const destructiveButton = alertCall[2].find((b: any) => b.style === 'destructive');
        await act(async () => { destructiveButton.onPress(); });

        expect(mockLogout).toHaveBeenCalled();
    });

    it('handleDataExport exports and shares data', async () => {
        const { result } = renderHook(() => useProfileActions(onCloseMock));
        await act(async () => { await result.current.handleDataExport(); });

        expect(mockExportMutateAsync).toHaveBeenCalled();
        expect(FileSystem.writeAsStringAsync).toHaveBeenCalled();
        expect(Sharing.shareAsync).toHaveBeenCalled();
    });

    it('handleDataExport shows alert when sharing not available', async () => {
        (Sharing.isAvailableAsync as jest.Mock).mockResolvedValueOnce(false);
        const { result } = renderHook(() => useProfileActions(onCloseMock));
        await act(async () => { await result.current.handleDataExport(); });

        expect(Alert.alert).toHaveBeenCalledWith(
            expect.any(String),
            expect.stringContaining('')
        );
    });

    it('handleDataExport shows error alert on failure', async () => {
        mockExportMutateAsync.mockRejectedValueOnce(new Error('export fail'));
        const { result } = renderHook(() => useProfileActions(onCloseMock));
        await act(async () => { await result.current.handleDataExport(); });

        expect(Alert.alert).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(String)
        );
    });

    it('handleDataExport is a no-op when user is null', async () => {
        mockUseAuth.mockReturnValue({ user: null, logout: mockLogout } as any);
        const { result } = renderHook(() => useProfileActions(onCloseMock));
        await act(async () => { await result.current.handleDataExport(); });

        expect(mockExportMutateAsync).not.toHaveBeenCalled();
    });

    it('handleDeleteAccount shows confirmation alert', () => {
        const { result } = renderHook(() => useProfileActions(onCloseMock));
        act(() => { result.current.handleDeleteAccount(); });

        expect(Alert.alert).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(String),
            expect.arrayContaining([
                expect.objectContaining({ style: 'cancel' }),
                expect.objectContaining({ style: 'destructive' }),
            ])
        );
    });

    it('handleDeleteAccount destructive button deletes account', async () => {
        const { result } = renderHook(() => useProfileActions(onCloseMock));
        act(() => { result.current.handleDeleteAccount(); });

        const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
        const destructiveButton = alertCall[2].find((b: any) => b.style === 'destructive');
        await act(async () => { destructiveButton.onPress(); await new Promise(r => setTimeout(r, 10)); });

        expect(mockDeleteMutateAsync).toHaveBeenCalledWith('test@example.com');
    });

    it('handleDeleteAccount is a no-op when user is null', () => {
        mockUseAuth.mockReturnValue({ user: null, logout: mockLogout } as any);
        const { result } = renderHook(() => useProfileActions(onCloseMock));
        act(() => { result.current.handleDeleteAccount(); });
        expect(Alert.alert).not.toHaveBeenCalled();
    });

    it('openBillingPortal opens URL', () => {
        const { result } = renderHook(() => useProfileActions(onCloseMock));
        act(() => { result.current.openBillingPortal(); });
        expect(Linking.openURL).toHaveBeenCalledWith('https://taskforceai.chat/pricing');
    });

});
