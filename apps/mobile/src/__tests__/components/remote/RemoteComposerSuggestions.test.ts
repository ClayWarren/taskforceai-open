import {
  applyRemoteComposerSuggestion,
  remoteComposerTrigger,
} from '../../../features/desktop-work/components/RemoteComposerSuggestions';

describe('Remote composer suggestions', () => {
  it('detects commands and workspace references at the cursor', () => {
    expect(remoteComposerTrigger('/rev')).toEqual({ kind: 'command', query: 'rev', start: 0 });
    expect(remoteComposerTrigger('Check @src/app')).toEqual({
      kind: 'reference',
      query: 'src/app',
      start: 6,
    });
    expect(remoteComposerTrigger('No active trigger here')).toBeNull();
    expect(remoteComposerTrigger('Use $security')).toEqual({
      kind: 'skill',
      query: 'security',
      start: 4,
    });
  });

  it('replaces only the active trigger', () => {
    const trigger = remoteComposerTrigger('Inspect @src/ap');
    expect(trigger).not.toBeNull();
    expect(
      applyRemoteComposerSuggestion('Inspect @src/ap', trigger!, '@src/app.ts ')
    ).toBe('Inspect @src/app.ts ');
  });
});
