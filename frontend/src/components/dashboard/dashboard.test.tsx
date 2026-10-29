import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AttentionList } from './AttentionList';
import { StatusCard } from './StatusCard';
import type { Task } from '@/types/api';

const task: Task = {
  id: '65f1a2b3c4d5e6f708192307',
  title: 'Audit vendors',
  description: '',
  priority: 'HIGH',
  status: 'PENDING_APPROVAL',
  dueDate: '2099-01-31',
  assignee: { id: '65f1a2b3c4d5e6f708192302', name: 'Priya Sharma', email: 'priya@taskapp.dev' },
  createdBy: { id: '65f1a2b3c4d5e6f708192301', name: 'Mohit Singh', email: 'admin@taskapp.dev' },
  allowedTransitions: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('StatusCard', () => {
  it('shows the count and links to the filtered list', () => {
    render(<MemoryRouter><StatusCard status="PENDING" count={7} /></MemoryRouter>);
    const link = screen.getByRole('link', { name: 'Pending: 7 tasks' });
    expect(link).toHaveAttribute('href', '/tasks?status=PENDING');
    expect(screen.getByText('7')).toBeInTheDocument();
  });
});

describe('AttentionList', () => {
  it('lists tasks with assignee and links to their detail page', () => {
    render(<MemoryRouter><AttentionList title="Awaiting" description="d" tasks={[task]} viewAllHref="/tasks" showAssignee /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /Audit vendors/ })).toHaveAttribute('href', `/tasks/${task.id}`);
    expect(screen.getByText(/Priya Sharma/)).toBeInTheDocument();
  });

  it('shows the empty message with no tasks', () => {
    render(<MemoryRouter><AttentionList title="Awaiting" description="d" tasks={[]} viewAllHref="/tasks" showAssignee={false} /></MemoryRouter>);
    expect(screen.getByText('Nothing needs your attention right now.')).toBeInTheDocument();
  });
});
