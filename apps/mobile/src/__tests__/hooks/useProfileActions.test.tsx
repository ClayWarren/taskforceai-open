import { renderHook, act } from '@testing-library/react-native';
import { Alert, Linking, Platform } from 'react-native';
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
jest.mock('../../api/client', () => ({
    getMobileClient: () => ({
        createPortalSession: (...args: unknown[]) => mockCreatePortalSession(...args),
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
const mockCreatePortalSession = jest.fn(async () => ({
    ok: true,
    value: { url: 'https://billing.stripe.com/portal' },
}));

const onCloseMock = jest.fn();
const originalPlatformOS = Platform.OS;

beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', { value: originalPlatformOS, writable: true });
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
    it('returns expected action functions', async () => {
        const { result } = await renderHook(() => useProfileActions(onCloseMock));
        expect(result.current.handleLogout).toBeDefined();
        expect(result.current.handleDataExport).toBeDefined();
        expect(result.current.handleDeleteAccount).toBeDefined();
        expect(result.current.openBillingPortal).toBeDefined();
        expect(result.current.openPrivacyPolicy).toBeDefined();
        expect(result.current.openTermsOfService).toBeDefined();
        expect(result.current.openSupportContact).toBeDefined();
        expect(result.current.isAccountActionLoading).toBe(false);
    });

    it('handleLogout shows alert with logout option', async () => {
        const { result } = await renderHook(() => useProfileActions(onCloseMock));
        await act(() => { result.current.handleLogout(); });
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
        const { result } = await renderHook(() => useProfileActions(onCloseMock));
        await act(() => { result.current.handleLogout(); });

        const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
        const destructiveButton = alertCall[2].find((b: any) => b.style === 'destructive');
        await act(async () => { destructiveButton.onPress(); });

        expect(mockLogout).toHaveBeenCalled();
    });

    it('handleDataExport exports and shares data', async () => {
        const { result } = await renderHook(() => useProfileActions(onCloseMock));
        await act(async () => { await result.current.handleDataExport(); });

        expect(mockExportMutateAsync).toHaveBeenCalled();
        expect(FileSystem.writeAsStringAsync).toHaveBeenCalled();
        expect(Sharing.shareAsync).toHaveBeenCalled();
    });

    it('handleDataExport shows alert when sharing not available', async () => {
        (Sharing.isAvailableAsync as jest.Mock).mockResolvedValueOnce(false);
        const { result } = await renderHook(() => useProfileActions(onCloseMock));
        await act(async () => { await result.current.handleDataExport(); });

        expect(Alert.alert).toHaveBeenCalledWith(
            expect.any(String),
            expect.stringContaining('')
        );
    });

    it('handleDataExport shows error alert on failure', async () => {
        mockExportMutateAsync.mockRejectedValueOnce(new Error('export fail'));
        const { result } = await renderHook(() => useProfileActions(onCloseMock));
        await act(async () => { await result.current.handleDataExport(); });

        expect(Alert.alert).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(String)
        );
    });

    it('handleDataExport is a no-op when user is null', async () => {
        mockUseAuth.mockReturnValue({ user: null, logout: mockLogout } as any);
        const { result } = await renderHook(() => useProfileActions(onCloseMock));
        await act(async () => { await result.current.handleDataExport(); });

        expect(mockExportMutateAsync).not.toHaveBeenCalled();
    });

    it('handleDeleteAccount shows confirmation alert', async () => {
        const { result } = await renderHook(() => useProfileActions(onCloseMock));
        await act(() => { result.current.handleDeleteAccount(); });

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
        const { result } = await renderHook(() => useProfileActions(onCloseMock));
        await act(() => { result.current.handleDeleteAccount(); });

        const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
        const destructiveButton = alertCall[2].find((b: any) => b.style === 'destructive');
        await act(async () => { destructiveButton.onPress(); await new Promise(r => setTimeout(r, 10)); });

        expect(mockDeleteMutateAsync).toHaveBeenCalledWith('test@example.com');
    });

    it('handleDeleteAccount is a no-op when user is null', async () => {
        mockUseAuth.mockReturnValue({ user: null, logout: mockLogout } as any);
        const { result } = await renderHook(() => useProfileActions(onCloseMock));
        await act(() => { result.current.handleDeleteAccount(); });
        expect(Alert.alert).not.toHaveBeenCalled();
    });

    it('openBillingPortal opens App Store subscriptions for store-managed accounts by default', async () => {
        const { result } = await renderHook(() => useProfileActions(onCloseMock));
        await act(async () => { await result.current.openBillingPortal(); });
        expect(Linking.openURL).toHaveBeenCalledWith('https://apps.apple.com/account/subscriptions');
        expect(mockCreatePortalSession).not.toHaveBeenCalled();
    });

    it('openBillingPortal opens Stripe portal for Stripe-managed accounts', async () => {
        mockUseAuth.mockReturnValue({
            user: {
                email: 'test@example.com',
                id: '1',
                name: 'Test',
                subscription_source: 'stripe',
            },
            logout: mockLogout,
        } as any);

        const { result } = await renderHook(() => useProfileActions(onCloseMock));
        await act(async () => { await result.current.openBillingPortal(); });

        expect(mockCreatePortalSession).toHaveBeenCalledTimes(1);
        expect(Linking.openURL).toHaveBeenCalledWith('https://billing.stripe.com/portal');
    });

    it('openBillingPortal opens Google Play subscriptions for Android store-managed accounts', async () => {
        Object.defineProperty(Platform, 'OS', { value: 'android', writable: true });

        const { result } = await renderHook(() => useProfileActions(onCloseMock));
        await act(async () => { await result.current.openBillingPortal(); });

        expect(Linking.openURL).toHaveBeenCalledWith('https://play.google.com/store/account/subscriptions');
        expect(mockCreatePortalSession).not.toHaveBeenCalled();
    });

    it('openBillingPortal opens App Store subscriptions for App Store-managed accounts on Android', async () => {
        Object.defineProperty(Platform, 'OS', { value: 'android', writable: true });
        mockUseAuth.mockReturnValue({
            user: {
                email: 'test@example.com',
                id: '1',
                name: 'Test',
                subscription_source: 'app_store',
            },
            logout: mockLogout,
        } as any);

        const { result } = await renderHook(() => useProfileActions(onCloseMock));
        await act(async () => { await result.current.openBillingPortal(); });

        expect(Linking.openURL).toHaveBeenCalledWith('https://apps.apple.com/account/subscriptions');
        expect(mockCreatePortalSession).not.toHaveBeenCalled();
    });

    it('openBillingPortal opens Google Play subscriptions for Play Store-managed accounts on iOS', async () => {
        mockUseAuth.mockReturnValue({
            user: {
                email: 'test@example.com',
                id: '1',
                name: 'Test',
                subscription_source: 'play_store',
            },
            logout: mockLogout,
        } as any);

        const { result } = await renderHook(() => useProfileActions(onCloseMock));
        await act(async () => { await result.current.openBillingPortal(); });

        expect(Linking.openURL).toHaveBeenCalledWith('https://play.google.com/store/account/subscriptions');
        expect(mockCreatePortalSession).not.toHaveBeenCalled();
    });

    it('openBillingPortal shows fallback alert when Stripe portal creation fails', async () => {
        mockUseAuth.mockReturnValue({
            user: {
                email: 'test@example.com',
                id: '1',
                name: 'Test',
                subscription_source: 'stripe',
            },
            logout: mockLogout,
        } as any);
        mockCreatePortalSession.mockResolvedValueOnce({
            ok: false,
            error: { message: 'portal unavailable' },
        });

        const { result } = await renderHook(() => useProfileActions(onCloseMock));
        await act(async () => { await result.current.openBillingPortal(); });

        expect(mockCreatePortalSession).toHaveBeenCalledTimes(1);
        expect(Linking.openURL).not.toHaveBeenCalled();
        expect(Alert.alert).toHaveBeenCalledWith(
            'Billing portal unavailable',
            'Please contact support for billing help.'
        );
    });

});
