import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConfirmProvider, useConfirm, type ConfirmResult } from './useConfirm';

let result: ConfirmResult | undefined;

function Trigger(): React.JSX.Element {
  const confirm = useConfirm();
  return (
    <button
      onClick={() =>
        void confirm({ title: 'Send back?', confirmLabel: 'Reject', note: { label: 'Reason for rejection', required: true } }).then((r) => {
          result = r;
        })
      }
    >
      open
    </button>
  );
}

describe('useConfirm required note', () => {
  it('keeps Confirm disabled until the note is non-empty, then returns the note', async () => {
    result = undefined;
    render(
      <ConfirmProvider>
        <Trigger />
      </ConfirmProvider>,
    );
    fireEvent.click(screen.getByText('open'));
    const confirmButton = await screen.findByRole('button', { name: 'Reject' });
    expect(confirmButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reason for rejection/), { target: { value: '   ' } });
    expect(confirmButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reason for rejection/), { target: { value: ' needs work ' } });
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);
    await screen.findByText('open');
    await Promise.resolve();
    expect(result).toEqual({ confirmed: true, note: 'needs work' });
  });
});
