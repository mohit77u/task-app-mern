import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, DASHBOARD, EMPLOYEE, EMPTY_PAGE, json, renderApp, stubApi } from '@/test/utils';

vi.mock('@/lib/notify', () => ({ notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), dismiss: vi.fn() } }));

const signedIn = (user: typeof ADMIN) =>
  stubApi({
    'GET /api/v1/auth/me': () => json(200, user),
    'GET /api/v1/dashboard': () => json(200, DASHBOARD),
    'GET /api/v1/tasks': () => json(200, EMPTY_PAGE),
  });

describe('routes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('redirects an Employee from /users to /dashboard', async () => {
    signedIn(EMPLOYEE);
    const { router } = renderApp('/users');
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/dashboard');
  });

  it('lets an Admin open /users', async () => {
    signedIn(ADMIN);
    renderApp('/users');
    expect(await screen.findByTestId('users-page')).toBeInTheDocument();
  });

  it('redirects / to /dashboard and resolves task routes', async () => {
    signedIn(ADMIN);
    const { router } = renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/dashboard');
    await router.navigate('/tasks/65f1a2b3c4d5e6f708192307');
    expect(await screen.findByTestId('task-detail-page')).toBeInTheDocument();
    await router.navigate('/tasks');
    expect(await screen.findByTestId('tasks-page')).toBeInTheDocument();
  });

  it('renders NotFoundPage for an unknown route', async () => {
    signedIn(ADMIN);
    renderApp('/nope/nothing');
    expect(await screen.findByTestId('not-found-page')).toBeInTheDocument();
  });
});
