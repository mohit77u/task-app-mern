import { screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, EMPLOYEE, json, pageOf, renderApp, stubApi } from '@/test/utils';

vi.mock('@/lib/notify', () => ({ notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), dismiss: vi.fn() } }));

const ordinaryAdmin = { ...ADMIN, id: '65f1a2b3c4d5e6f708192399', name: 'Second Admin', email: 'second@taskapp.dev', isDefault: false };

describe('UsersPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('disables Delete with a reason for the signed-in admin and for default accounts, but not for others', async () => {
    stubApi({
      'GET /api/v1/auth/me': () => json(200, ordinaryAdmin),
      'GET /api/v1/users': () => json(200, pageOf([ordinaryAdmin, { ...EMPLOYEE, isDefault: true }, { ...EMPLOYEE, id: '65f1a2b3c4d5e6f708192398', name: 'Temp Worker', isDefault: false }])),
    });
    renderApp('/users');
    expect(await screen.findByRole('button', { name: 'Delete Second Admin' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete Priya Sharma' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete Temp Worker' })).toBeEnabled();

    const wrappers = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="disabled-reason"]'));
    expect(wrappers).toHaveLength(2);
    act(() => wrappers[0].focus());
    expect((await screen.findAllByText("You can't delete your own account")).length).toBeGreaterThan(0);
    act(() => wrappers[1].focus());
    expect((await screen.findAllByText("Default accounts can't be deleted")).length).toBeGreaterThan(0);
  });

  it('opens the create form from New user', async () => {
    stubApi({
      'GET /api/v1/auth/me': () => json(200, ADMIN),
      'GET /api/v1/users': () => json(200, pageOf([ADMIN])),
      'GET /api/v1/roles': () => json(200, [ADMIN.role, EMPLOYEE.role]),
    });
    renderApp('/users');
    (await screen.findByRole('button', { name: /New user/ })).click();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});
