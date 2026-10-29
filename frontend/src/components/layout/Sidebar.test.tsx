import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { SidebarNav } from './Sidebar';
import { ADMIN, EMPLOYEE, json, renderWithProviders, stubApi } from '@/test/utils';
import { makeStore } from '@/store';
import { authApi } from '@/services/api/authApi';
import type { User } from '@/types/api';

async function renderFor(user: User): Promise<void> {
  stubApi({ 'GET /api/v1/auth/me': () => json(200, user) });
  const store = makeStore();
  await store.dispatch(authApi.endpoints.me.initiate());
  renderWithProviders(<MemoryRouter initialEntries={['/tasks/abc']}><SidebarNav /></MemoryRouter>, store);
}

describe('SidebarNav', () => {
  it('hides Users for an Employee', async () => {
    await renderFor(EMPLOYEE);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('shows Users for an Admin', async () => {
    await renderFor(ADMIN);
    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('href', '/users');
    vi.unstubAllGlobals();
  });
});
