import { act, renderHook, waitFor } from '@testing-library/react-native';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

import { useRealtimeAudioPlayback } from '../../hooks/useRealtimeAudioPlayback';
import { deleteAsync, writeBytesAsync } from '../../utils/file-system';

jest.mock('../../utils/file-system', () => ({
  cacheDirectory: 'file:///cache/',
  deleteAsync: jest.fn(),
  writeBytesAsync: jest.fn(),
}));

const mockCreatePlayer = createAudioPlayer as jest.MockedFunction<typeof createAudioPlayer>;
const mockSetAudioMode = setAudioModeAsync as jest.MockedFunction<typeof setAudioModeAsync>;
const mockDelete = deleteAsync as jest.MockedFunction<typeof deleteAsync>;
const mockWrite = writeBytesAsync as jest.MockedFunction<typeof writeBytesAsync>;

const player = () => ({
  addListener: jest.fn(() => ({ remove: jest.fn() })),
  pause: jest.fn(),
  play: jest.fn(),
  remove: jest.fn(),
}) as unknown as ReturnType<typeof createAudioPlayer>;

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

describe('useRealtimeAudioPlayback races', () => {
  it('discards stale work, flushes full buffers, and removes queued files', async () => {
    mockDelete.mockResolvedValue(undefined);
    mockWrite.mockResolvedValue(undefined);
    mockCreatePlayer.mockImplementation(() => player());
    mockSetAudioMode.mockResolvedValue(undefined);

    const audioMode = deferred();
    mockSetAudioMode.mockReturnValueOnce(audioMode.promise);
    const first = await renderHook(() => useRealtimeAudioPlayback());
    let firstFlush!: Promise<void>;
    await act(async () => {
      first.result.current.enqueuePcmDelta('AAA=');
      firstFlush = first.result.current.flushPcmDeltas();
      await Promise.resolve();
    });
    act(() => first.result.current.stopPlayback());
    await act(async () => { audioMode.resolve(); await firstFlush; });
    expect(mockDelete).toHaveBeenCalledWith(expect.stringContaining('realtime-voice-'), {
      idempotent: true,
    });
    const write = deferred();
    mockWrite.mockReturnValueOnce(write.promise);
    let secondFlush!: Promise<void>;
    await act(async () => {
      first.result.current.enqueuePcmDelta('AAA=');
      secondFlush = first.result.current.flushPcmDeltas();
      await Promise.resolve();
    });
    act(() => first.result.current.stopPlayback());
    await act(async () => { write.resolve(); await secondFlush; });
    expect(mockDelete).toHaveBeenCalledTimes(2);

    await act(async () => {
      first.result.current.enqueuePcmDelta('AAA=');
      await first.result.current.flushPcmDeltas();
      first.result.current.enqueuePcmDelta('AAA=');
      await first.result.current.flushPcmDeltas();
    });
    mockDelete.mockRejectedValueOnce(new Error('queued delete failed'));
    act(() => first.result.current.stopPlayback());
    await act(async () => { await Promise.resolve(); });

    act(() => first.result.current.enqueuePcmDelta('AAA='));
    act(() => first.result.current.enqueuePcmDelta('AAAA'.repeat(10_000)));
    await waitFor(() => expect(mockWrite).toHaveBeenCalled());
    act(() => first.result.current.stopPlayback());

    mockCreatePlayer.mockImplementationOnce(() => { throw new Error('player unavailable'); });
    mockDelete.mockRejectedValueOnce(new Error('skipped delete failed'));
    await act(async () => {
      first.result.current.enqueuePcmDelta('AAA=');
      await first.result.current.flushPcmDeltas();
      await Promise.resolve();
    });
  });
});
