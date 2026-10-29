import { Navigate, RouteObject } from 'react-router';
import AdminRoute from '@/layouts/AdminRoute';
import AppLayout from '@/layouts/AppLayout';
import DashboardPage from '@/pages/DashboardPage';
import LoginPage from '@/pages/LoginPage';
import NotFoundPage from '@/pages/NotFoundPage';
import TaskDetailPage from '@/pages/TaskDetailPage';
import TasksPage from '@/pages/TasksPage';
import UsersPage from '@/pages/UsersPage';

export const appRoutes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/', element: <Navigate to="/dashboard" replace /> },
  {
    element: <AppLayout />,
    children: [
      { path: '/dashboard', element: <DashboardPage /> },
      { path: '/tasks', element: <TasksPage /> },
      { path: '/tasks/:id', element: <TaskDetailPage /> },
      { element: <AdminRoute />, children: [{ path: '/users', element: <UsersPage /> }] },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];
