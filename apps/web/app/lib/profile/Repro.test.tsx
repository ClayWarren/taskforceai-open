import { render } from '@testing-library/react';
import { describe, expect, it } from 'bun:test';
import * as AlertDialog from '@radix-ui/react-alert-dialog';

describe('Repro', () => {
  it('renders AlertDialog', () => {
    render(
      <AlertDialog.Root open={true}>
        <AlertDialog.Portal>
          <AlertDialog.Content>
            <AlertDialog.Title>Test</AlertDialog.Title>
            <AlertDialog.Description>Test alert dialog description.</AlertDialog.Description>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    );
    expect(true).toBe(true);
  });
});
