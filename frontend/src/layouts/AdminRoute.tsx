import { Navigate, Outlet } from 'react-router';
import { useAuth } from '@/hooks/useAuth';

/** Admin-only section. Rendered inside AuthGate, so the user is known; an Employee is sent back to the dashboard. */
export default function AdminRoute(): React.JSX.Element {
  const { isAdmin } = useAuth();
  return isAdmin ? <Outlet /> : <Navigate to="/dashboard" replace />;
}
