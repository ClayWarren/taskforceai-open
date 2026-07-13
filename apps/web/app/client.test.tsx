import { describe, expect, it, vi } from 'bun:test';
import '../../../tests/setup/dom';

const hydrateRoot = vi.fn();

vi.mock('@tanstack/react-start/client', () => ({
  StartClient: () => null,
}));

vi.mock('react-dom/client', () => ({
  hydrateRoot,
}));

const importClient = () => import(`./client?test=${Date.now()}-${Math.random()}`);

describe('web client bootstrap', () => {
  it('hydrates the Start client', async () => {
    hydrateRoot.mockClear();

    await importClient();

    expect(hydrateRoot).toHaveBeenCalledWith(document, expect.any(Object));
  });
});
