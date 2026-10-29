import { fireEvent, screen, waitFor } from '@testing-library/react';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, DASHBOARD, EMPTY_PAGE, json, renderApp, stubApi } from '@/test/utils';
import { DEMO_ACCOUNTS } from '@/lib/demoAccounts';

vi.mock('@/lib/notify', () => ({ notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), dismiss: vi.fn() } }));

const unauth = () => json(401, { statusCode: 401, code: 'UNAUTHENTICATED', message: 'no', details: [] });

describe('LoginPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fills the form when a demo account is clicked', async () => {
    stubApi({ 'GET /api/v1/auth/me': unauth, 'POST /api/v1/auth/refresh': unauth });
    renderApp('/login');
    const account = DEMO_ACCOUNTS[2];
    fireEvent.click(screen.getByRole('button', { name: new RegExp(account.email) }));
    expect(screen.getByLabelText(/Email/)).toHaveValue(account.email);
    expect(screen.getByLabelText(/Password/)).toHaveValue(account.password);
    expect(screen.getByText(/incognito/)).toBeInTheDocument();
  });

  it('navigates to /dashboard after a successful login', async () => {
    stubApi({
      'GET /api/v1/auth/me': unauth,
      'POST /api/v1/auth/refresh': unauth,
      'POST /api/v1/auth/login': () => json(200, { user: ADMIN }),
      'GET /api/v1/dashboard': () => json(200, DASHBOARD),
      'GET /api/v1/tasks': () => json(200, EMPTY_PAGE),
    });
    const { router } = renderApp('/login');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(DEMO_ACCOUNTS[0].email) }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });

  it('returns to the originally requested location after login', async () => {
    stubApi({
      'GET /api/v1/auth/me': unauth,
      'POST /api/v1/auth/refresh': unauth,
      'POST /api/v1/auth/login': () => json(200, { user: ADMIN }),
    });
    const { router } = renderApp('/tasks');
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(DEMO_ACCOUNTS[0].email) }));
    expect(router.state.location.pathname).toBe('/login');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks'));
  });

  it('shows the error and stays on /login when login fails', async () => {
    stubApi({
      'GET /api/v1/auth/me': unauth,
      'POST /api/v1/auth/refresh': unauth,
      'POST /api/v1/auth/login': () =>
        json(401, { statusCode: 401, code: 'UNAUTHENTICATED', message: 'Invalid credentials', details: [{ field: 'password', message: 'Wrong email or password' }] }),
    });
    const { router } = renderApp('/login');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(DEMO_ACCOUNTS[0].email) }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Wrong email or password')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });
});
