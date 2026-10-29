import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthGate } from './AuthGate';
import { ADMIN, json, renderWithProviders, stubApi } from '@/test/utils';

vi.mock('@/lib/notify', () => ({ notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), dismiss: vi.fn() } }));

const ui = (
  <MemoryRouter initialEntries={['/secret']}>
    <Routes>
      <Route path="/login" element={<p>login screen</p>} />
      <Route path="/secret" element={<AuthGate><p>secret content</p></AuthGate>} />
    </Routes>
  </MemoryRouter>
);

describe('AuthGate', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows a skeleton while /auth/me is pending', () => {
    stubApi({ 'GET /api/v1/auth/me': () => new Promise<Response>(() => undefined) });
    renderWithProviders(ui);
    expect(screen.getByLabelText('Loading your session')).toBeInTheDocument();
    expect(screen.queryByText('secret content')).not.toBeInTheDocument();
  });

  it('redirects to /login on 401', async () => {
    stubApi({
      'GET /api/v1/auth/me': () => json(401, { statusCode: 401, code: 'UNAUTHENTICATED', message: 'no', details: [] }),
      'POST /api/v1/auth/refresh': () => json(401, { statusCode: 401, code: 'UNAUTHENTICATED', message: 'no', details: [] }),
    });
    renderWithProviders(ui);
    expect(await screen.findByText('login screen')).toBeInTheDocument();
    expect(screen.queryByText('secret content')).not.toBeInTheDocument();
  });

  it('renders children when authenticated', async () => {
    stubApi({ 'GET /api/v1/auth/me': () => json(200, ADMIN) });
    renderWithProviders(ui);
    await waitFor(() => expect(screen.getByText('secret content')).toBeInTheDocument());
  });
});
