import { ThemeProvider } from 'next-themes';
import { useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmProvider } from '@/hooks/useConfirm';
import { appRoutes } from '@/routes';
import { StoreProvider } from '@/store/StoreProvider';

const THEME_SCRIPT_PROPS = { type: 'application/json' } as const;

export default function App(): React.JSX.Element {
  const [router] = useState(() => createBrowserRouter(appRoutes));
  return (
    // next-themes renders an inline anti-flash <script> meant for server rendering. In this client-only app it never runs
    // (the provider applies the theme itself), and React 19 logs a console error for every client-rendered script tag.
    // Marking it as a data block keeps it inert and silences that error.
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange scriptProps={THEME_SCRIPT_PROPS}>
      <StoreProvider>
        <TooltipProvider>
          <ConfirmProvider>
            <RouterProvider router={router} />
            <Toaster richColors closeButton position="top-right" />
          </ConfirmProvider>
        </TooltipProvider>
      </StoreProvider>
    </ThemeProvider>
  );
}
