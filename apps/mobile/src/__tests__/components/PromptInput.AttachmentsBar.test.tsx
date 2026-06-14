import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { TouchableOpacity } from 'react-native';

jest.mock('../../components/Icon', () => ({
    Icon: (props: any) => {
        const react = require('react');
        return react.createElement('Icon', props);
    },
}));

import { AttachmentsBar } from '../../components/PromptInput.AttachmentsBar';

describe('AttachmentsBar', () => {
    const mockAttachments = [
        { id: 'att-1', name: 'document.pdf', uri: 'file:///doc.pdf', size: 1024, mimeType: 'application/pdf', kind: 'file' as const },
        { id: 'att-2', name: 'photo.jpg', uri: 'file:///photo.jpg', size: 2048, mimeType: 'image/jpeg', kind: 'image' as const },
    ];

    it('renders nothing when no attachments', () => {
        let renderer: TestRenderer.ReactTestRenderer;
        act(() => {
            renderer = TestRenderer.create(
                <AttachmentsBar attachments={[]} onRemove={jest.fn()} errorColor="#ff0000" />
            );
        });

        expect(renderer!.toJSON()).toBeNull();
    });

    it('renders attachment names', () => {
        let renderer: TestRenderer.ReactTestRenderer;
        act(() => {
            renderer = TestRenderer.create(
                <AttachmentsBar attachments={mockAttachments} onRemove={jest.fn()} errorColor="#ff0000" />
            );
        });

        const json = JSON.stringify(renderer!.toJSON());
        expect(json).toContain('document.pdf');
        expect(json).toContain('photo.jpg');
    });

    it('calls onRemove with attachment id when remove pressed', () => {
        const onRemove = jest.fn();
        let renderer: TestRenderer.ReactTestRenderer;
        act(() => {
            renderer = TestRenderer.create(
                <AttachmentsBar attachments={mockAttachments} onRemove={onRemove} errorColor="#ff0000" />
            );
        });

        const buttons = renderer!.root.findAllByType(TouchableOpacity);
        const removeButton = buttons.find(b =>
            b.props.accessibilityLabel?.includes('Remove document.pdf')
        );
        expect(removeButton).toBeDefined();

        act(() => {
            removeButton!.props.onPress();
        });

        expect(onRemove).toHaveBeenCalledWith('att-1');
    });

    it('renders remove button for each attachment', () => {
        let renderer: TestRenderer.ReactTestRenderer;
        act(() => {
            renderer = TestRenderer.create(
                <AttachmentsBar attachments={mockAttachments} onRemove={jest.fn()} errorColor="#ff0000" />
            );
        });

        const buttons = renderer!.root.findAllByType(TouchableOpacity);
        const removeButtons = buttons.filter(b =>
            b.props.accessibilityRole === 'button' && b.props.accessibilityLabel?.includes('Remove')
        );

        expect(removeButtons).toHaveLength(2);
    });
});
