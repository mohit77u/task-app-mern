import { Outlet } from 'react-router';
import { AuthGate } from '@/components/auth/AuthGate';
import { AppShell } from '@/components/layout/AppShell';

export default function AppLayout(): React.JSX.Element {
  return (
    <AuthGate>
      <AppShell>
        <Outlet />
      </AppShell>
    </AuthGate>
  );
}
