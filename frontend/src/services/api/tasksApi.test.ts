import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeStore } from '@/store';
import { tasksApi } from './tasksApi';

const emptyPage = { items: [], meta: { page: 1, limit: 10, total: 0, totalPages: 1 } };

async function requestedUrl(filters: Parameters<typeof tasksApi.endpoints.listTasks.initiate>[0]): Promise<URL> {
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify(emptyPage), { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  await makeStore().dispatch(tasksApi.endpoints.listTasks.initiate(filters));
  return new URL((fetchMock.mock.calls[0] as unknown as [Request])[0].url);
}

describe('listTasks request', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([['empty', ''], ['whitespace', '   ']])('omits the search param when it is %s (the backend rejects an empty search)', async (_name, search) => {
    const url = await requestedUrl({ page: 1, limit: 10, search });
    expect(url.pathname).toBe('/api/v1/tasks');
    expect(url.searchParams.has('search')).toBe(false);
  });

  it('sends a trimmed search when there is text', async () => {
    const url = await requestedUrl({ page: 1, limit: 10, search: '  budget ' });
    expect(url.searchParams.get('search')).toBe('budget');
  });
});
