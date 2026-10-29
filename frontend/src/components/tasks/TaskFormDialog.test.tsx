import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPLOYEE, json, pageOf, renderWithProviders, stubApi } from '@/test/utils';
import { TaskFormDialog } from './TaskFormDialog';

vi.mock('@/lib/notify', () => ({ notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), dismiss: vi.fn() } }));
// Radix Select needs pointer APIs jsdom lacks; a native <select> exercises the same onValueChange contract.
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }) => (
    <select value={value} onChange={(event) => onValueChange(event.target.value)}>
      <option value="">Select an employee</option>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));

const fillValidForm = async (): Promise<void> => {
  fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Write report' } });
  fireEvent.change(screen.getByLabelText(/Description/), { target: { value: 'Quarterly numbers' } });
  fireEvent.change(screen.getByLabelText(/Due date/), { target: { value: '2099-01-31' } });
  await screen.findByRole('option', { name: 'Priya Sharma' });
  fireEvent.change(screen.getAllByRole('combobox').at(-1) as HTMLElement, { target: { value: EMPLOYEE.id } });
};

describe('TaskFormDialog', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('submits assigneeId as the ObjectId string', async () => {
    let body: unknown;
    stubApi({
      'GET /api/v1/users': () => json(200, pageOf([EMPLOYEE])),
      'POST /api/v1/tasks': async (request) => {
        body = await request.json();
        return json(201, { id: '65f1a2b3c4d5e6f708192a3b' });
      },
    });
    const onOpenChange = vi.fn();
    renderWithProviders(<TaskFormDialog open onOpenChange={onOpenChange} />);
    await fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(body).toEqual({ title: 'Write report', description: 'Quarterly numbers', priority: 'MEDIUM', dueDate: '2099-01-31', assigneeId: EMPLOYEE.id });
    expect(typeof (body as { assigneeId: unknown }).assigneeId).toBe('string');
  });

  it('shows API 422 field errors on the matching fields', async () => {
    stubApi({
      'GET /api/v1/users': () => json(200, pageOf([EMPLOYEE])),
      'POST /api/v1/tasks': () =>
        json(422, {
          statusCode: 422,
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: [
            { field: 'title', message: 'Title is already used' },
            { field: 'assigneeId', message: 'Assignee must be an employee' },
          ],
        }),
    });
    renderWithProviders(<TaskFormDialog open onOpenChange={vi.fn()} />);
    await fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(await screen.findByText('Title is already used')).toBeInTheDocument();
    expect(screen.getByText('Assignee must be an employee')).toBeInTheDocument();
  });
});
