import { render } from '@testing-library/react';
import { ReactElement } from 'react';
import { Provider } from 'react-redux';
import { createMemoryRouter, RouteObject, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { appRoutes } from '@/routes';
import { makeStore } from '@/store';
import type { User } from '@/types/api';

export const json = (status: number, body: unknown): Response =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const ADMIN: User = {
  id: '65f1a2b3c4d5e6f708192301',
  name: 'Mohit Singh',
  email: 'admin@taskapp.dev',
  phone: null,
  isDefault: true,
  role: { id: '65f1a2b3c4d5e6f708192311', code: 'ADMIN', name: 'Administrator' },
};
export const EMPLOYEE: User = {
  ...ADMIN,
  id: '65f1a2b3c4d5e6f708192302',
  name: 'Priya Sharma',
  email: 'priya@taskapp.dev',
  role: { id: '65f1a2b3c4d5e6f708192312', code: 'EMPLOYEE', name: 'Employee' },
};

export const EMPTY_PAGE = { items: [], meta: { page: 1, limit: 5, total: 0, totalPages: 1 } };
export const DASHBOARD = { counts: { PENDING: 3, IN_PROGRESS: 2, PENDING_APPROVAL: 1, COMPLETED: 4 }, total: 10 };

export type Handler = (request: Request) => Response | Promise<Response>;

/** Stubs fetch: handlers are keyed by `METHOD /api/v1/path`; unknown requests answer 404 so a missing stub is visible. */
export function stubApi(handlers: Record<string, Handler>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (request: Request) => {
    const handler = handlers[`${request.method} ${new URL(request.url).pathname}`];
    return handler ? handler(request) : json(404, { statusCode: 404, code: 'NOT_FOUND', message: 'no stub', details: [] });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export function renderWithProviders(ui: ReactElement, store = makeStore()): ReturnType<typeof render> & { store: typeof store } {
  return { ...render(<Provider store={store}>{ui}</Provider>), store };
}

/** Renders the real route table at `path`. */
export function renderApp(path: string, routes: RouteObject[] = appRoutes): ReturnType<typeof renderWithProviders> & { router: ReturnType<typeof createMemoryRouter> } {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return { ...renderWithProviders(<RouterProvider router={router} />), router };
}
