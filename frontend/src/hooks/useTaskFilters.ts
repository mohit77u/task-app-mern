import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseTaskFilters, toSearchString } from '@/lib/taskFilters';
import type { TaskFilters } from '@/services/api/tasksApi';
import { useDebouncedValue } from './useDebouncedValue';

type FilterKey = 'status' | 'priority' | 'assigneeId';

/**
 * Task-list filters, stored in the URL so refresh and shared links keep them. Changes use navigate(replace), so they do
 * not add history entries (back leaves the list rather than stepping through filters); the hook still follows an
 * external URL change into the search box. Search typing is debounced before it reaches the URL (and therefore before
 * it triggers a request).
 */
export function useTaskFilters(): {
  filters: TaskFilters & { page: number };
  searchInput: string;
  setSearchInput: (value: string) => void;
  setFilter: (key: FilterKey, value: string | undefined) => void;
  setPage: (page: number) => void;
  reset: () => void;
} {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const filters = useMemo(() => parseTaskFilters(searchParams), [searchParams]);

  const [searchInput, setSearchInput] = useState(filters.search ?? '');
  const debouncedSearch = useDebouncedValue(searchInput, 300);

  const update = useCallback(
    (changes: Partial<TaskFilters>) => {
      const next: TaskFilters = { ...parseTaskFilters(searchParams), ...changes };
      // Changing any filter starts again from the first page; only an explicit page change keeps it.
      if (!('page' in changes)) next.page = 1;
      const query = toSearchString(next);
      navigate(query ? `${pathname}?${query}` : pathname, { replace: true });
    },
    [navigate, pathname, searchParams],
  );

  // The debounce effect must not re-run just because `update` changed identity (it does on every URL change), or a stale
  // debounced value would overwrite a Reset. Keep the latest `update` in a ref and depend only on the debounced text.
  const updateRef = useRef(update);
  useEffect(() => {
    updateRef.current = update;
  }, [update]);

  // The last search text this hook knows the URL to have. Distinguishes our own URL writes from external changes.
  const appliedSearch = useRef(filters.search ?? '');

  // Runs once the input has settled (input === debounced value). It also watches the input itself: after a Reset the
  // input can go 'x' → '' → 'x' within one debounce window, leaving the debounced value unchanged at 'x'; keyed on the
  // debounced value alone, that retyped search would never reach the URL.
  useEffect(() => {
    if (debouncedSearch !== searchInput) return;
    const next = debouncedSearch.trim();
    if (next === appliedSearch.current) return;
    appliedSearch.current = next;
    updateRef.current({ search: next || undefined });
  }, [debouncedSearch, searchInput]);

  // External URL change (Reset button, browser back): mirror it into the input.
  useEffect(() => {
    const external = filters.search ?? '';
    if (external !== appliedSearch.current) {
      appliedSearch.current = external;
      setSearchInput(external);
    }
  }, [filters.search]);

  const setFilter = useCallback(
    (key: FilterKey, value: string | undefined) => update({ [key]: value } as Partial<TaskFilters>),
    [update],
  );
  const setPage = useCallback((page: number) => update({ page }), [update]);
  const reset = useCallback(() => {
    // Clear the input directly as well: when the URL is already filter-free (text still inside the debounce window) the
    // router call below changes nothing, so the external-change effect would never fire and the pending text would win.
    appliedSearch.current = '';
    setSearchInput('');
    navigate(pathname, { replace: true });
  }, [navigate, pathname]);

  return { filters, searchInput, setSearchInput, setFilter, setPage, reset };
}
