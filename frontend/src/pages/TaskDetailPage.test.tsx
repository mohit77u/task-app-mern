import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, json, makeTask, renderApp, stubApi, TASK_ID } from '@/test/utils';

vi.mock('@/lib/notify', () => ({ notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), dismiss: vi.fn() } }));

describe('TaskDetailPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders the not-found state when the API answers 404', async () => {
    stubApi({
      'GET /api/v1/auth/me': () => json(200, ADMIN),
      'GET /api/v1/tasks/65f1a2b3c4d5e6f7081929ff': () => json(404, { statusCode: 404, code: 'NOT_FOUND', message: 'Task not found', details: [] }),
    });
    renderApp('/tasks/65f1a2b3c4d5e6f7081929ff');
    expect(await screen.findByText('Task not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to tasks/ })).toHaveAttribute('href', '/tasks');
  });

  it('renders the not-found state for a malformed id (API 422)', async () => {
    stubApi({
      'GET /api/v1/auth/me': () => json(200, ADMIN),
      'GET /api/v1/tasks/not-an-id': () => json(422, { statusCode: 422, code: 'VALIDATION_ERROR', message: 'Invalid id', details: [{ field: 'id', message: 'Invalid id' }] }),
    });
    renderApp('/tasks/not-an-id');
    expect(await screen.findByText('Task not found')).toBeInTheDocument();
  });

  it('shows the task with comments and history tabs', async () => {
    stubApi({
      'GET /api/v1/auth/me': () => json(200, ADMIN),
      [`GET /api/v1/tasks/${TASK_ID}`]: () => json(200, makeTask()),
      [`GET /api/v1/tasks/${TASK_ID}/comments`]: () => json(200, []),
      [`GET /api/v1/tasks/${TASK_ID}/history`]: () => json(200, []),
    });
    renderApp(`/tasks/${TASK_ID}`);
    expect(await screen.findByRole('heading', { name: 'Ship the thing' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Comments' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'History' })).toBeInTheDocument();
    expect(await screen.findByText('No comments yet')).toBeInTheDocument();
  });
});
