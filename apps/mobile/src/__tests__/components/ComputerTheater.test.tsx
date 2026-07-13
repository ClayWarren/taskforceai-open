import React from 'react';
import { render } from '@testing-library/react-native';

import { ComputerTheater } from '../../components/ComputerTheater';

jest.mock('../../components/Icon', () => require('../helpers/mock-modules').createIconMockModule());

describe('ComputerTheater', () => {
  it('keeps the latest available screenshot even if newest event has no image', async () => {
    const { getByRole } = await render(
      <ComputerTheater
        isStreaming={true}
        toolEvents={[
          {
            toolName: 'computer_use',
            agentLabel: 'Agent 1',
            arguments: {},
            success: true,
            durationMs: 10,
            image_base64: 'abc123',
          } as any,
          {
            toolName: 'computer_use',
            agentLabel: 'Agent 1',
            arguments: { action: 'click' },
            success: true,
            durationMs: 12,
          } as any,
        ]}
      />
    );

    const screenshot = getByRole('image', { name: 'Live computer screenshot' });
    expect(screenshot.props.source).toEqual({ uri: 'data:image/png;base64,abc123' });
  });

  it('renders the latest pointer over the screenshot', async () => {
    const { getByRole, getByTestId } = await render(
      <ComputerTheater
        isStreaming={true}
        toolEvents={[
          {
            toolName: 'computer_use',
            agentLabel: 'Agent 1',
            arguments: { action: 'click', coordinate_x: 120, coordinate_y: 80 },
            success: true,
            durationMs: 10,
            image_base64: 'abc123',
          } as any,
        ]}
      />
    );

    expect(getByRole('image', { name: 'Live computer screenshot' })).toBeTruthy();
    expect(getByTestId('computer-cursor').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ left: expect.anything(), top: expect.anything() })])
    );
  });

  it('shows waiting status before first computer event', async () => {
    const { getByText } = await render(
      <ComputerTheater isStreaming={true} showWhenEmpty={true} toolEvents={[]} />
    );

    expect(getByText(/Waiting for first action/i)).toBeTruthy();
    expect(getByText('COMPUTER USE MODE')).toBeTruthy();
  });

  it('shows agent progress before first computer event', async () => {
    const { getByText, queryByText } = await render(
      <ComputerTheater
        isStreaming={true}
        showWhenEmpty={true}
        toolEvents={[]}
        preScreenStatus="Synthesizing findings and checking the answer..."
      />
    );

    expect(getByText('Synthesizing findings and checking the answer...')).toBeTruthy();
    expect(queryByText('Connecting to desktop environment...')).toBeNull();
  });

  it('shows computer-use failure details when no screenshot is available', async () => {
    const { getByText, queryByText } = await render(
      <ComputerTheater
        isStreaming={true}
        toolEvents={[
          {
            toolName: 'computer_use',
            agentLabel: 'Agent 1',
            arguments: {},
            success: false,
            status: 'failed',
            durationMs: 10,
            error: 'failed to start computer use',
          } as any,
        ]}
      />
    );

    expect(getByText('failed to start computer use')).toBeTruthy();
    expect(queryByText('Waiting for screen update...')).toBeNull();
  });
});
