import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { renderHook, act } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-document-picker', () => ({
    getDocumentAsync: jest.fn(),
}));

jest.mock('expo-image-picker', () => ({
    requestMediaLibraryPermissionsAsync: jest.fn(),
    launchImageLibraryAsync: jest.fn(),
    MediaTypeOptions: { Images: 'Images' },
}));

const DocumentPicker = require('expo-document-picker');
const ImagePicker = require('expo-image-picker');

// Mock prepareAttachment to avoid file system access
jest.mock('../../components/PromptInput.internal', () => {
    const actual = jest.requireActual('../../components/PromptInput.internal');
    return {
        ...actual,
        prepareAttachment: jest.fn(async (asset: any) => ({
            ok: true,
            value: {
                id: `attachment-${Date.now()}`,
                name: asset.name,
                uri: asset.uri,
                size: asset.size ?? 100,
                mimeType: asset.mimeType ?? 'application/octet-stream',
                kind: asset.kind,
            },
        })),
    };
});

import { usePromptAttachments } from '../../hooks/usePromptAttachments';

const createWrapper = () => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return ({ children }: any) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
};

describe('usePromptAttachments', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('starts with empty attachments', async () => {
        const { result } = await renderHook(() => usePromptAttachments(), { wrapper: createWrapper() });
        expect(result.current.attachments).toEqual([]);
        expect(result.current.remainingSlots).toBe(5);
    });

    it('picks documents and appends attachments', async () => {
        DocumentPicker.getDocumentAsync.mockResolvedValueOnce({
            canceled: false,
            assets: [{ name: 'test.pdf', uri: 'file:///test.pdf', size: 100, mimeType: 'application/pdf' }],
        });

        const { result } = await renderHook(() => usePromptAttachments(), { wrapper: createWrapper() });

        await act(async () => {
            await result.current.pickDocuments();
        });

        expect(result.current.attachments).toHaveLength(1);
        expect(result.current.attachments[0].name).toBe('test.pdf');
        expect(result.current.remainingSlots).toBe(4);
    });

    it('handles canceled document picker', async () => {
        DocumentPicker.getDocumentAsync.mockResolvedValueOnce({ canceled: true });

        const { result } = await renderHook(() => usePromptAttachments(), { wrapper: createWrapper() });

        await act(async () => {
            await result.current.pickDocuments();
        });

        expect(result.current.attachments).toHaveLength(0);
    });

    it('handles document picker error', async () => {
        DocumentPicker.getDocumentAsync.mockRejectedValueOnce(new Error('picker error'));
        const alertSpy = jest.spyOn(Alert, 'alert');

        const { result } = await renderHook(() => usePromptAttachments(), { wrapper: createWrapper() });

        await act(async () => {
            await result.current.pickDocuments();
        });

        expect(result.current.attachments).toHaveLength(0);
        expect(alertSpy).toHaveBeenCalled();
    });

    it('picks images with permission', async () => {
        ImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValueOnce({ granted: true });
        ImagePicker.launchImageLibraryAsync.mockResolvedValueOnce({
            canceled: false,
            assets: [{ fileName: 'photo.jpg', uri: 'file:///photo.jpg', fileSize: 200, mimeType: 'image/jpeg', type: 'image' }],
        });

        const { result } = await renderHook(() => usePromptAttachments(), { wrapper: createWrapper() });

        await act(async () => {
            await result.current.pickImages();
        });

        expect(result.current.attachments).toHaveLength(1);
        expect(result.current.attachments[0].name).toBe('photo.jpg');
    });

    it('shows alert when image permission denied', async () => {
        ImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValueOnce({ granted: false });
        const alertSpy = jest.spyOn(Alert, 'alert');

        const { result } = await renderHook(() => usePromptAttachments(), { wrapper: createWrapper() });

        await act(async () => {
            await result.current.pickImages();
        });

        expect(result.current.attachments).toHaveLength(0);
        expect(alertSpy).toHaveBeenCalledWith('Permission Needed', expect.any(String));
    });

    it('handles canceled image picker', async () => {
        ImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValueOnce({ granted: true });
        ImagePicker.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: true });

        const { result } = await renderHook(() => usePromptAttachments(), { wrapper: createWrapper() });

        await act(async () => {
            await result.current.pickImages();
        });

        expect(result.current.attachments).toHaveLength(0);
    });

    it('handles image picker error', async () => {
        ImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValueOnce({ granted: true });
        ImagePicker.launchImageLibraryAsync.mockRejectedValueOnce(new Error('picker error'));
        const alertSpy = jest.spyOn(Alert, 'alert');

        const { result } = await renderHook(() => usePromptAttachments(), { wrapper: createWrapper() });

        await act(async () => {
            await result.current.pickImages();
        });

        expect(result.current.attachments).toHaveLength(0);
        expect(alertSpy).toHaveBeenCalled();
    });

    it('removes an attachment by id', async () => {
        DocumentPicker.getDocumentAsync.mockResolvedValueOnce({
            canceled: false,
            assets: [{ name: 'test.pdf', uri: 'file:///test.pdf', size: 100, mimeType: 'application/pdf' }],
        });

        const { result } = await renderHook(() => usePromptAttachments(), { wrapper: createWrapper() });

        await act(async () => {
            await result.current.pickDocuments();
        });

        const attachmentId = result.current.attachments[0].id;

        await act(() => {
            result.current.removeAttachment(attachmentId);
        });

        expect(result.current.attachments).toHaveLength(0);
    });

    it('removes batched attachments by id against the latest attachment state', async () => {
        const { prepareAttachment } = require('../../components/PromptInput.internal');
        prepareAttachment
            .mockResolvedValueOnce({
                ok: true,
                value: {
                    id: 'attachment-a',
                    name: 'a.pdf',
                    uri: 'file:///a.pdf',
                    size: 100,
                    mimeType: 'application/pdf',
                    kind: 'file',
                },
            })
            .mockResolvedValueOnce({
                ok: true,
                value: {
                    id: 'attachment-b',
                    name: 'b.pdf',
                    uri: 'file:///b.pdf',
                    size: 100,
                    mimeType: 'application/pdf',
                    kind: 'file',
                },
            });
        DocumentPicker.getDocumentAsync.mockResolvedValueOnce({
            canceled: false,
            assets: [
                { name: 'a.pdf', uri: 'file:///a.pdf', size: 100, mimeType: 'application/pdf' },
                { name: 'b.pdf', uri: 'file:///b.pdf', size: 100, mimeType: 'application/pdf' },
            ],
        });

        const { result } = await renderHook(() => usePromptAttachments(), { wrapper: createWrapper() });

        await act(async () => {
            await result.current.pickDocuments();
        });

        await act(() => {
            result.current.removeAttachment('attachment-a');
            result.current.removeAttachment('attachment-b');
        });

        expect(result.current.attachments).toEqual([]);
    });

    it('clears all attachments', async () => {
        DocumentPicker.getDocumentAsync.mockResolvedValueOnce({
            canceled: false,
            assets: [
                { name: 'a.pdf', uri: 'file:///a.pdf', size: 100, mimeType: 'application/pdf' },
                { name: 'b.pdf', uri: 'file:///b.pdf', size: 200, mimeType: 'application/pdf' },
            ],
        });

        const { result } = await renderHook(() => usePromptAttachments(), { wrapper: createWrapper() });

        await act(async () => {
            await result.current.pickDocuments();
        });

        expect(result.current.attachments).toHaveLength(2);

        await act(() => {
            result.current.clearAttachments();
        });

        expect(result.current.attachments).toHaveLength(0);
        expect(result.current.remainingSlots).toBe(5);
    });

    it('handles prepareAttachment failures gracefully', async () => {
        const { prepareAttachment } = require('../../components/PromptInput.internal');
        prepareAttachment.mockResolvedValueOnce({
            ok: false,
            error: { message: 'File too large' },
        });
        const alertSpy = jest.spyOn(Alert, 'alert');

        DocumentPicker.getDocumentAsync.mockResolvedValueOnce({
            canceled: false,
            assets: [{ name: 'big.zip', uri: 'file:///big.zip', size: 999999999, mimeType: 'application/zip' }],
        });

        const { result } = await renderHook(() => usePromptAttachments(), { wrapper: createWrapper() });

        await act(async () => {
            await result.current.pickDocuments();
        });

        expect(result.current.attachments).toHaveLength(0);
        expect(alertSpy).toHaveBeenCalledWith('Attachment Errors', expect.any(String));
    });
});
