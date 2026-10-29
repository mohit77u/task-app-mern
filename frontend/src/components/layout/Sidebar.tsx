import { CheckSquare, LayoutDashboard, Users } from 'lucide-react';
import { NavLink } from 'react-router';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, adminOnly: false },
  { href: '/tasks', label: 'Tasks', icon: CheckSquare, adminOnly: false },
  { href: '/users', label: 'Users', icon: Users, adminOnly: true },
] as const;

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }): React.JSX.Element {
  const { isAdmin } = useAuth();

  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin).map(({ href, label, icon: Icon }) => (
        // NavLink marks nested routes (/tasks/:id) active too, matching the old prefix check.
        <NavLink
          key={href}
          to={href}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-md px-3 py-2 max-md:min-h-10 text-sm font-medium transition-colors',
              isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )
          }
        >
          <Icon className="h-4 w-4" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
