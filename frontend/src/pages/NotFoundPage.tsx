import { Link } from 'react-router';

export default function NotFoundPage(): React.JSX.Element {
  return (
    <main data-testid="not-found-page" className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-sm text-muted-foreground">The page you are looking for does not exist.</p>
      <Link to="/dashboard" className="text-sm font-medium text-primary hover:underline">
        Back to the dashboard
      </Link>
    </main>
  );
}
