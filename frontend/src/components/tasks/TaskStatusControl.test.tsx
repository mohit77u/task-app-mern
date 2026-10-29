import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@/types/api';
import { TaskStatusControl } from './TaskStatusControl';

const transition = vi.fn();
const confirm = vi.fn();

vi.mock('@/services/api/tasksApi', () => ({
  useTransitionTaskMutation: () => [(arg: unknown) => ({ unwrap: () => transition(arg) })],
}));
vi.mock('@/hooks/useConfirm', () => ({ useConfirm: () => confirm }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { role: { code: 'EMPLOYEE' } } }) }));
// Radix Select needs pointer APIs jsdom lacks; a native <select> exercises the same onValueChange contract.
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, disabled, children }: { value: string; onValueChange: (v: string) => void; disabled?: boolean; children: React.ReactNode }) => (
    <select aria-label="Status" value={value} disabled={disabled} onChange={(event) => onValueChange(event.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, disabled, children }: { value: string; disabled?: boolean; children: React.ReactNode }) => (
    <option value={value} disabled={disabled}>
      {children}
    </option>
  ),
}));

const person = { id: '65f1a2b3c4d5e6f708192a01', name: 'Priya Sharma', email: 'p@x.dev' };
const task: Task = {
  id: '65f1a2b3c4d5e6f708192a3b',
  title: 'T',
  description: 'D',
  priority: 'MEDIUM',
  status: 'PENDING',
  dueDate: '2030-01-05',
  assignee: person,
  createdBy: person,
  allowedTransitions: ['IN_PROGRESS'],
  createdAt: '2030-01-01T00:00:00.000Z',
  updatedAt: '2030-01-01T00:00:00.000Z',
};

describe('TaskStatusControl', () => {
  afterEach(cleanup);

  beforeEach(() => {
    transition.mockReset().mockResolvedValue(task);
    confirm.mockReset();
  });

  it('makes no request and keeps the old status when the confirmation is cancelled', async () => {
    confirm.mockResolvedValue({ confirmed: false, note: '' });
    render(<TaskStatusControl task={task} />);
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'IN_PROGRESS' } });
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(transition).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Status')).toHaveValue('PENDING');
  });

  it('sends the transition with the note once confirmed', async () => {
    confirm.mockResolvedValue({ confirmed: true, note: 'go' });
    render(<TaskStatusControl task={task} />);
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'IN_PROGRESS' } });
    await waitFor(() => expect(transition).toHaveBeenCalledWith({ id: '65f1a2b3c4d5e6f708192a3b', from: 'PENDING', to: 'IN_PROGRESS', note: 'go' }));
  });

  it('disables options the backend did not allow and the whole control when none are allowed', () => {
    const { rerender } = render(<TaskStatusControl task={task} />);
    expect(screen.getByRole('option', { name: 'Completed' })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'In Progress' })).toBeEnabled();
    rerender(<TaskStatusControl task={{ ...task, status: 'PENDING_APPROVAL', allowedTransitions: [] }} />);
    expect(screen.getByLabelText('Status')).toBeDisabled();
    expect(screen.getByText(/Waiting for an admin/)).toBeInTheDocument();
  });

  it('keeps the value and re-enables the control after a rejected transition', async () => {
    confirm.mockResolvedValue({ confirmed: true, note: '' });
    transition.mockRejectedValue(new Error('boom'));
    render(<TaskStatusControl task={task} />);
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'IN_PROGRESS' } });
    await waitFor(() => expect(transition).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText('Status')).toBeEnabled());
    expect(screen.getByLabelText('Status')).toHaveValue('PENDING');
  });

  it('enables exactly the statuses in allowedTransitions (plus the current one)', () => {
    render(<TaskStatusControl task={{ ...task, status: 'PENDING_APPROVAL', allowedTransitions: ['IN_PROGRESS', 'COMPLETED'] }} />);
    expect(screen.getByRole('option', { name: 'Pending' })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'In Progress' })).toBeEnabled();
    expect(screen.getByRole('option', { name: 'Completed' })).toBeEnabled();
    expect(screen.getByRole('option', { name: 'Pending Approval' })).toBeEnabled();
  });

  it('asks for a required note when rejecting (Pending Approval to In Progress)', async () => {
    confirm.mockResolvedValue({ confirmed: false, note: '' });
    render(<TaskStatusControl task={{ ...task, status: 'PENDING_APPROVAL', allowedTransitions: ['IN_PROGRESS', 'COMPLETED'] }} />);
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'IN_PROGRESS' } });
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0][0]).toMatchObject({ confirmLabel: 'Reject', note: { required: true } });
    expect(transition).not.toHaveBeenCalled();
  });

  it('is disabled while the task is refetching', () => {
    render(<TaskStatusControl task={task} isFetching />);
    expect(screen.getByLabelText('Status')).toBeDisabled();
  });
});
