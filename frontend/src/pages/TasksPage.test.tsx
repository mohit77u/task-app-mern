import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, EMPLOYEE, json, makeTask, pageOf, renderApp, stubApi } from '@/test/utils';

vi.mock('@/lib/notify', () => ({ notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), dismiss: vi.fn() } }));

const manyPages = { items: [makeTask()], meta: { page: 3, limit: 10, total: 50, totalPages: 5 } };

const taskCalls = (fetchMock: ReturnType<typeof stubApi>): URL[] =>
  fetchMock.mock.calls.map(([request]) => new URL((request as Request).url)).filter((url) => url.pathname === '/api/v1/tasks');

describe('TasksPage', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('debounces search, then writes it to the URL and requests it from page 1', async () => {
    const fetchMock = stubApi({
      'GET /api/v1/auth/me': () => json(200, ADMIN),
      'GET /api/v1/users': () => json(200, pageOf([EMPLOYEE])),
      'GET /api/v1/tasks': () => json(200, manyPages),
    });
    const { router } = renderApp('/tasks?page=3');
    const input = await screen.findByLabelText('Search tasks');
    await screen.findByText('Ship the thing');

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.change(input, { target: { value: 'repo' } });
    act(() => void vi.advanceTimersByTime(299));
    expect(router.state.location.search).toBe('?page=3');
    act(() => void vi.advanceTimersByTime(1));
    vi.useRealTimers();

    expect(router.state.location.search).toBe('?search=repo');
    await waitFor(() => expect(taskCalls(fetchMock).some((url) => url.searchParams.get('search') === 'repo' && url.searchParams.get('page') === '1')).toBe(true));
    // The empty search is never sent, and only known params are.
    for (const url of taskCalls(fetchMock)) {
      expect(url.search).not.toMatch(/search=(&|$)/);
      for (const key of url.searchParams.keys()) expect(['status', 'priority', 'assigneeId', 'search', 'page', 'limit']).toContain(key);
    }
  });

  it('resets to page 1 when a filter changes', async () => {
    stubApi({
      'GET /api/v1/auth/me': () => json(200, ADMIN),
      'GET /api/v1/users': () => json(200, pageOf([EMPLOYEE])),
      'GET /api/v1/tasks': () => json(200, manyPages),
    });
    const { router } = renderApp('/tasks?page=3');
    await screen.findByText('Ship the thing');

    const trigger = screen.getByRole('combobox', { name: 'Status' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: 'In Progress' }));

    await waitFor(() => expect(router.state.location.search).toBe('?status=IN_PROGRESS'));
  });

  it('shows the employee filter and New task button to an Admin', async () => {
    stubApi({
      'GET /api/v1/auth/me': () => json(200, ADMIN),
      'GET /api/v1/users': () => json(200, pageOf([EMPLOYEE])),
      'GET /api/v1/tasks': () => json(200, pageOf([makeTask()])),
    });
    renderApp('/tasks');
    expect(await screen.findByRole('combobox', { name: 'Employee' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New task/ })).toBeInTheDocument();
  });

  it('hides the employee filter and New task button from an Employee', async () => {
    const fetchMock = stubApi({
      'GET /api/v1/auth/me': () => json(200, EMPLOYEE),
      'GET /api/v1/tasks': () => json(200, pageOf([makeTask()])),
    });
    renderApp('/tasks');
    await screen.findByText('Ship the thing');
    expect(screen.queryByRole('combobox', { name: 'Employee' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New task/ })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([request]) => new URL((request as Request).url).pathname === '/api/v1/users')).toBe(false);
  });

  it('shows an error state with a retry', async () => {
    let calls = 0;
    stubApi({
      'GET /api/v1/auth/me': () => json(200, EMPLOYEE),
      'GET /api/v1/tasks': () => (++calls === 1 ? json(500, { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Boom', details: [] }) : json(200, pageOf([makeTask()]))),
    });
    renderApp('/tasks');
    fireEvent.click(await screen.findByRole('button', { name: /Try again|Retry/i }));
    expect(await screen.findByText('Ship the thing')).toBeInTheDocument();
  });
});
